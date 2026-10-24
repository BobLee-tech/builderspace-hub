import type { AuditActor } from "../audit";
import type { Db } from "../db";
import type { Mailer } from "../mail";
import type { MailTask } from "./nudge-email";
import type { AssignedTask, Stuck } from "./nudge.policy";
import { findAccounts } from "../accounts/account.repo";
import { withAudit } from "../audit";
import {
  lastActivityByCard,
  listTaskRows,
  listViewableProjects,
} from "../kan/tasks.gateway";
import { findUsersByIds } from "../kan/users.gateway";
import { createResendMailer, mailConfig, MailError } from "../mail";
import {
  consumeRateLimit,
  rateLimitWaits,
  resetRateLimit,
} from "../rate-limit";
import { HubError } from "../shared/errors";
import { dueStateOf, isOpen, stageOf } from "../tasks/task.policy";
import { nudgeEmail } from "./nudge-email";
import {
  mailOrder,
  NUDGE_LIMIT,
  NUDGE_MAIL_TASK_LIMIT,
  nudgeLimitKey,
  stuckPeople,
} from "./nudge.policy";
import { optedOutAmong, optIn, optOut } from "./nudge.repo";

/**
 * 催一下: anyone can send a teammate whose task has stalled one anonymous mail
 * listing what they still have to do.
 *
 * Anonymous by construction, not just on screen: nothing stores who asked.
 * The once-an-hour limit is counted per recipient, and sending a nudge writes
 * no audit entry (a deliberate exception to the rule that every change is
 * logged, as for the personal calendar: admins read the log).
 */

export interface NudgeDeps {
  /** Null while no mail service is set up; nobody can be nudged then. */
  mailer: Mailer | null;
  /** Where the Hub is served; the mail links here. */
  baseUrl: string | null;
}

/** The deployment's settings: Resend from HUB_RESEND_API_KEY, the Hub's own address. */
export function nudgeDeps(
  env: Record<string, string | undefined> = process.env,
): NudgeDeps {
  const config = mailConfig(env);
  return {
    mailer: config ? createResendMailer(config) : null,
    baseUrl: env.NEXT_PUBLIC_BASE_URL ?? env.BETTER_AUTH_URL ?? null,
  };
}

export interface NudgeablePerson {
  userId: string;
  name: string;
  /** Their open tasks that the viewer can see. */
  openCount: number;
  /** Their most stuck task among those. */
  headline: { title: string; stuck: Stuck };
  /** They turned 催一下 mail off: they cannot be nudged. */
  optedOut: boolean;
  /** Seconds until they can be nudged again, or null when they can be now. */
  waitSeconds: number | null;
}

export interface NudgeList {
  /** False while no mail service is set up. */
  canSend: boolean;
  /** Most stuck first. */
  people: NudgeablePerson[];
}

type LoadedTask = AssignedTask & MailTask;

/** The open tasks a person can see, with when each was last touched. */
async function loadOpenTasks(
  db: Db,
  userId: string,
  now: Date,
): Promise<LoadedTask[]> {
  const projects = await listViewableProjects(db, userId);
  const projectNames = new Map(projects.map((p) => [p.id, p.name]));
  const rows = (
    await listTaskRows(
      db,
      projects.map((p) => p.id),
      userId,
    )
  ).filter((row) => isOpen(stageOf(row.listName)));
  const activity = await lastActivityByCard(
    db,
    rows.map((row) => row.publicId),
  );

  return rows.map((row) => ({
    title: row.title,
    project: projectNames.get(row.projectId) ?? "",
    board: row.boardName,
    listName: row.listName,
    stage: stageOf(row.listName),
    dueState: dueStateOf(row.dueDate, now),
    dueDate: row.dueDate,
    lastTouchedAt: latest(
      row.createdAt,
      row.updatedAt,
      activity.get(row.publicId),
    ),
    assigneeIds: row.assignees.flatMap((a) => (a.userId ? [a.userId] : [])),
  }));
}

function latest(...dates: (Date | null | undefined)[]): Date {
  return new Date(Math.max(...dates.map((date) => date?.getTime() ?? 0)));
}

/** The viewer's list, plus each person's account details for the mail. */
async function findNudgeable(db: Db, input: { userId: string; now: Date }) {
  const people = stuckPeople(
    await loadOpenTasks(db, input.userId, input.now),
    input.userId,
    input.now,
  );
  const ids = people.map((person) => person.userId);
  const [users, accounts, optedOut, waits] = await Promise.all([
    findUsersByIds(db, ids),
    findAccounts(db, ids),
    optedOutAmong(db, ids),
    rateLimitWaits(
      db,
      ids.map(nudgeLimitKey),
      NUDGE_LIMIT,
      input.now.getTime(),
    ),
  ]);
  const usersById = new Map(users.map((user) => [user.id, user]));

  return people.flatMap((person) => {
    const user = usersById.get(person.userId);
    // A suspended account cannot sign in to do anything about it.
    if (!user || accounts.get(person.userId)?.status === "suspended") {
      return [];
    }
    return [
      {
        user,
        person: {
          userId: person.userId,
          name: user.name?.trim() ? user.name : user.email,
          openCount: person.openCount,
          headline: {
            title: person.headline.task.title,
            stuck: person.headline.stuck,
          },
          optedOut: optedOut.has(person.userId),
          waitSeconds: waits.get(nudgeLimitKey(person.userId)) ?? null,
        } satisfies NudgeablePerson,
      },
    ];
  });
}

/**
 * Who the viewer could nudge: teammates with a stuck task among the tasks the
 * viewer can see. Never the viewer, never a suspended account.
 */
export async function listNudgeable(
  db: Db,
  input: { userId: string; now: Date },
  deps: NudgeDeps = nudgeDeps(),
): Promise<NudgeList> {
  return {
    canSend: deps.mailer !== null && deps.baseUrl !== null,
    people: (await findNudgeable(db, input)).map(({ person }) => person),
  };
}

export type NudgeDelivery = "sent" | "unconfirmed";

const NOT_NUDGEABLE = "TA 现在没有卡住的任务";

/**
 * Mails one person their own unfinished tasks. They must be on the viewer's
 * list, so nobody can be nudged about work the viewer cannot see. The mail
 * itself lists everything of theirs, since only they read it.
 */
export async function nudgePerson(
  db: Db,
  input: { userId: string; recipientId: string; now: Date },
  deps: NudgeDeps = nudgeDeps(),
): Promise<{ delivery: NudgeDelivery }> {
  const { mailer, baseUrl } = deps;
  if (!mailer || !baseUrl) {
    throw new HubError("CONFLICT", "还没有配置发信服务，暂时不能提醒");
  }

  const found = (await findNudgeable(db, input)).find(
    ({ person }) => person.userId === input.recipientId,
  );
  if (!found) throw new HubError("NOT_FOUND", NOT_NUDGEABLE);
  const { user, person } = found;
  if (person.optedOut) {
    throw new HubError("CONFLICT", "TA 关掉了催一下邮件");
  }

  const key = nudgeLimitKey(user.id);
  const decision = await consumeRateLimit(
    db,
    key,
    NUDGE_LIMIT,
    input.now.getTime(),
  );
  if (!decision.allowed) {
    const minutes = Math.ceil(decision.retryAfterSeconds / 60);
    throw new HubError(
      "CONFLICT",
      `一小时内已经有人提醒过 TA 了，${minutes} 分钟后可以再提醒`,
    );
  }

  try {
    const theirs = (await loadOpenTasks(db, user.id, input.now)).filter(
      (task) => task.assigneeIds.includes(user.id),
    );
    // They are on the list because of a task assigned to them, so this only
    // happens if they lost access to that project in the meantime.
    if (theirs.length === 0) throw new HubError("NOT_FOUND", NOT_NUDGEABLE);

    const { subject, text } = nudgeEmail({
      name: user.name ?? "",
      tasks: mailOrder(theirs).slice(0, NUDGE_MAIL_TASK_LIMIT),
      total: theirs.length,
      baseUrl,
      now: input.now,
    });
    await mailer.send({
      to: user.email,
      subject,
      text,
      idempotencyKey: `hub-nudge-${user.id}-${input.now.getTime()}`,
    });
    return { delivery: "sent" };
  } catch (error) {
    // It may have arrived; another one within the hour would be a second.
    if (error instanceof MailError && error.uncertain) {
      return { delivery: "unconfirmed" };
    }
    // Nothing went out: the next person to ask should not have to wait.
    await resetRateLimit(db, key);
    if (error instanceof MailError) {
      throw new HubError("UNAVAILABLE", "发信服务没有发出这封邮件，稍后再试");
    }
    throw error;
  }
}

/** Whether this person gets 催一下 mail. Everyone does until they turn it off. */
export async function getNudgeMail(
  db: Db,
  userId: string,
): Promise<{ on: boolean }> {
  return { on: !(await optedOutAmong(db, [userId])).has(userId) };
}

export async function setNudgeMail(
  db: Db,
  actor: AuditActor & { userId: string },
  on: boolean,
  now: Date = new Date(),
): Promise<{ on: boolean }> {
  const current = await getNudgeMail(db, actor.userId);
  if (current.on === on) return current;

  await withAudit(
    db,
    (tx) => (on ? optIn(tx, actor.userId) : optOut(tx, actor.userId, now)),
    () => ({
      actor,
      action: on ? "nudge_mail.turned_on" : "nudge_mail.turned_off",
      entityType: "user",
      entityId: actor.userId,
      summary: on ? "打开了催一下邮件" : "关掉了催一下邮件",
    }),
  );
  return { on };
}
