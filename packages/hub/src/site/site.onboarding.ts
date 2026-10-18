import { hubStructure } from "@kan/builderspace/structure";

import type { AuditActor } from "../audit";
import type { Db } from "../db";
import type { Mailer } from "../mail";
import type { HubRole } from "../schema";
import { grantState, issueGrant, revokeGrant } from "../access";
import { listGrantsByEmails } from "../access/grant.repo";
import { can } from "../accounts/roles";
import { recordAudit } from "../audit";
import { findProjectBySlug } from "../kan/projects.gateway";
import { findRegisteredEmails } from "../kan/users.gateway";
import { createResendMailer, mailConfig, MailError } from "../mail";
import { buildJoinLink } from "../public";
import { normalizeEmail } from "../shared/email";
import { isHubError } from "../shared/errors";
import { welcomeEmail } from "./welcome-email";

/**
 * Bringing an accepted core-member applicant into the Hub: a registration
 * link for the address they applied with, mailed to them. Accepting an
 * application in 官网 → 志愿者申请 does this on its own; the card's button does
 * it again on request.
 *
 * The link exists only inside the mail. If the mail service refuses the mail,
 * the link is revoked straight away, so no usable link is ever left that
 * nobody has. If no clear answer comes back (a timeout, a dropped
 * connection), the mail may have gone out, so the link is kept and the page
 * says to send a new one if it never arrived.
 */

/** What a new member gets: a member of the club's own project, nothing more. */
const ONBOARDING_PROJECT_KEY = "community";
const ONBOARDING_PROJECT_ROLE = "member";

export interface OnboardingDeps {
  /** Null while no mail service is set up; nothing is issued then. */
  mailer: Mailer | null;
  /** Where the Hub is served; the link in the mail points here. */
  baseUrl: string | null;
}

/** The deployment's settings: Resend from HUB_RESEND_API_KEY, the Hub's own address. */
export function onboardingDeps(
  env: Record<string, string | undefined> = process.env,
): OnboardingDeps {
  const config = mailConfig(env);
  return {
    mailer: config ? createResendMailer(config) : null,
    baseUrl: env.NEXT_PUBLIC_BASE_URL ?? env.BETTER_AUTH_URL ?? null,
  };
}

/** Who is acting: their back-office role decides whether they may issue links. */
export interface OnboardingActor extends AuditActor {
  hubRole: HubRole | null;
}

/** Where an applicant's address stands in the Hub. */
export type VolunteerHubAccess =
  | { state: "registered" }
  | { state: "linked"; issuedAt: Date; expiresAt: Date }
  | { state: "expired"; expiresAt: Date }
  | { state: "none" };

/** What one attempt to bring someone in came to; the page says it in words. */
export type OnboardingOutcome =
  | { kind: "sent"; email: string; expiresAt: Date }
  /** Already has an account: nothing to send. */
  | { kind: "registered" }
  /** A link from earlier still works; it is not replaced without asking. */
  | { kind: "linked"; expiresAt: Date }
  | { kind: "no_email" }
  /** The person acting may not issue registration links. */
  | { kind: "not_allowed" }
  /** No mail service or no Hub address configured. */
  | { kind: "mail_off" }
  /**
   * No clear answer from the mail service: the mail may have gone out, so
   * the link is kept rather than revoked under a delivered mail.
   */
  | { kind: "uncertain"; message: string; expiresAt: Date }
  | { kind: "failed"; message: string };

/** Each address's standing, keyed by the normalised address. */
export async function describeHubAccess(
  db: Db,
  rawEmails: (string | null)[],
  now: Date,
): Promise<Map<string, VolunteerHubAccess>> {
  const emails = [
    ...new Set(
      rawEmails.flatMap((raw) => {
        const email = normalizeEmail(raw);
        return email ? [email] : [];
      }),
    ),
  ];
  const [registered, grants] = await Promise.all([
    findRegisteredEmails(db, emails),
    listGrantsByEmails(db, emails),
  ]);

  const result = new Map<string, VolunteerHubAccess>();
  for (const email of emails) {
    if (registered.has(email)) {
      result.set(email, { state: "registered" });
      continue;
    }
    // Newest first, so the first match is the address's latest link.
    const latest = grants.find((grant) => grant.email === email);
    const state = latest ? grantState(latest, now) : null;
    if (latest && state === "pending") {
      result.set(email, {
        state: "linked",
        issuedAt: latest.createdAt,
        expiresAt: latest.expiresAt,
      });
    } else if (latest && state === "expired") {
      result.set(email, { state: "expired", expiresAt: latest.expiresAt });
    } else {
      result.set(email, { state: "none" });
    }
  }
  return result;
}

function hubOrigin(baseUrl: string | null): string | null {
  try {
    const url = new URL(baseUrl ?? "");
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

/**
 * Issues a registration link for an applicant and mails it to them. With
 * `replace` false (accepting an application) an address that still has a
 * working link is left alone; with `replace` true (the button) that link is
 * replaced by a new one.
 */
export async function onboardApplicant(
  db: Db,
  actor: OnboardingActor,
  applicant: { nickname: string; email: string | null },
  deps: OnboardingDeps,
  options: { replace: boolean; now?: Date },
): Promise<OnboardingOutcome> {
  const now = options.now ?? new Date();
  const email = normalizeEmail(applicant.email);
  if (!email) return { kind: "no_email" };
  if (!can(actor.hubRole, "access.manage")) return { kind: "not_allowed" };
  const origin = hubOrigin(deps.baseUrl);
  if (!deps.mailer || !origin) return { kind: "mail_off" };

  const access = (await describeHubAccess(db, [email], now)).get(email);
  if (access?.state === "registered") return { kind: "registered" };
  if (access?.state === "linked" && !options.replace) {
    return { kind: "linked", expiresAt: access.expiresAt };
  }

  const slug = hubStructure.projects.find(
    (project) => project.key === ONBOARDING_PROJECT_KEY,
  )?.slug;
  const project = slug ? await findProjectBySlug(db, slug) : null;
  if (!project) {
    return { kind: "failed", message: "找不到「BuilderSpace 社团」项目" };
  }

  let issued;
  try {
    issued = await issueGrant(db, actor, {
      email,
      source: "application",
      note: `官网核心成员申请：${applicant.nickname}`.slice(0, 280),
      projects: [
        { projectPublicId: project.publicId, role: ONBOARDING_PROJECT_ROLE },
      ],
      now,
    });
  } catch (error) {
    // Registered between the check above and the insert.
    if (isHubError(error) && error.code === "CONFLICT") {
      return { kind: "registered" };
    }
    throw error;
  }

  const mail = welcomeEmail({
    nickname: applicant.nickname,
    email,
    link: buildJoinLink(origin, issued.token),
    expiresAt: issued.expiresAt,
    canReply: deps.mailer.acceptsReplies,
  });

  let mailId: string | null;
  try {
    ({ id: mailId } = await deps.mailer.send({
      to: email,
      ...mail,
      idempotencyKey: `hub-welcome-${issued.publicId}`,
    }));
  } catch (error) {
    if (error instanceof MailError && error.uncertain) {
      await recordAudit(db, {
        actor,
        action: "grant.mail_unconfirmed",
        entityType: "grant",
        entityId: issued.publicId,
        summary: `给 ${email} 发注册链接时发信服务没有给出结果，链接保留`,
      });
      return {
        kind: "uncertain",
        message: error.message,
        expiresAt: issued.expiresAt,
      };
    }
    await revokeGrant(db, actor, issued.publicId, now);
    if (!(error instanceof MailError)) {
      console.error("[hub/site] welcome mail failed unexpectedly", error);
    }
    const reason =
      error instanceof MailError ? error.message : "发信时出了意外";
    return { kind: "failed", message: `邮件没发出去（${reason}），链接已作废` };
  }

  await recordAudit(db, {
    actor,
    action: "grant.mailed",
    entityType: "grant",
    entityId: issued.publicId,
    summary: `把注册链接发到 ${email}（官网申请：${applicant.nickname}）`,
    detail: { mailId },
  });

  return { kind: "sent", email, expiresAt: issued.expiresAt };
}
