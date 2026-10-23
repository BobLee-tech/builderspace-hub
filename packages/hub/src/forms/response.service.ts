import { createHash } from "node:crypto";
import { z } from "zod";

import { generateUID } from "@kan/shared/utils";

import type { AdminActor } from "../accounts/account.service";
import type { Db, DbOrTx } from "../db";
import type { FormAccess } from "../schema";
import type {
  AnswerInput,
  FormDefinition,
  FormPhase,
  FormSettings,
  LikeMode,
  StoredAnswer,
  WallMode,
} from "./form.model";
import type { FillDecision, FormViewer } from "./form.policy";
import type {
  FormRow,
  ImageMeta,
  ListedResponse,
  ResponseRow,
} from "./form.repo";
import { withAudit } from "../audit";
import { isUniqueViolation } from "../shared/db-errors";
import { HubError } from "../shared/errors";
import {
  generateGrantToken,
  hashGrantToken,
  isGrantTokenShape,
} from "../shared/token";
import { loadManaged, parse, viewerManages } from "./form.guard";
import {
  answerImages,
  answerText,
  answerToInput,
  checkAnswers,
  closedReasonText,
  formPhase,
  isQuestion,
} from "./form.model";
import { canFill, canLike, canSeeWall } from "./form.policy";
import {
  attachImages,
  countLikes,
  countResponses,
  deleteImages,
  deleteResponse,
  findBySubmissionKey,
  findByTokenHash,
  findForm,
  findLatestByUser,
  findResponse,
  findResponseById,
  findUserName,
  insertResponse,
  likedBy,
  listImagesOf,
  listResponseImages,
  listResponses,
  lockForm,
  setEditTokenHash,
  setLike,
  updateResponseAnswers,
} from "./form.repo";

/**
 * Answering a form, and what people see of each other's answers: the fill
 * page, sending and changing an answer, the results wall and its likes. These
 * are reached without signing in (for public forms), through plain API routes
 * rather than tRPC: answers can hold phone numbers and e-mail addresses, and
 * Kan's tRPC logging records every input.
 *
 * Sending an answer is deliberately not in the audit log: there are many,
 * they are content rather than administration, and the log is readable by
 * back-office admins who may not manage the form. Deleting one is logged.
 */

/** Secrets a browser holds for a form, sent in request headers. */
export interface BrowserSecrets {
  /** Handed out when an anonymous answer is sent; lets that browser change it. */
  editToken?: string | null;
  /** A random key the browser keeps, so an anonymous like counts once. */
  browserKey?: string | null;
}

/** Some answers are not acceptable; `fieldErrors` says which and why. */
export class AnswerProblemsError extends HubError {
  readonly fieldErrors: Record<string, string>;

  constructor(fieldErrors: Record<string, string>) {
    super("INVALID_INPUT", "有些题还没填好，请看标红的地方");
    this.fieldErrors = fieldErrors;
  }
}

const NOT_FOUND = "找不到这份表单，或者它还没有发布";
const BROWSER_KEY = /^[A-Za-z0-9_-]{20,100}$/;

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

/** What one person may do with one form right now. */
interface ViewerContext {
  form: FormRow;
  isManager: boolean;
  decision: FillDecision;
  /** Their answer (their latest, if they may send several), if any. */
  mine: ResponseRow | null;
  responseCount: number;
  phase: FormPhase;
}

async function contextFor(
  db: DbOrTx,
  viewer: FormViewer,
  publicId: string,
  secrets: BrowserSecrets,
  now: Date,
): Promise<ViewerContext> {
  const form = await findForm(db, publicId);
  if (!form) throw new HubError("NOT_FOUND", NOT_FOUND);
  const isManager = await viewerManages(db, viewer, form);
  if (form.status === "draft" && !isManager) {
    throw new HubError("NOT_FOUND", NOT_FOUND);
  }
  const decision: FillDecision = isManager
    ? { allowed: true }
    : canFill(form, viewer);
  const [mine, responseCount] = await Promise.all([
    findMine(db, form.id, viewer, secrets),
    countResponses(db, form.id),
  ]);
  return {
    form,
    isManager,
    decision,
    mine,
    responseCount,
    phase: formPhase(form, responseCount, now),
  };
}

/** One's own answer: by account, or by the token this browser kept. */
export async function findMine(
  db: DbOrTx,
  formId: number,
  viewer: FormViewer,
  secrets: BrowserSecrets,
): Promise<ResponseRow | null> {
  if (viewer.userId) {
    const byAccount = await findLatestByUser(db, formId, viewer.userId);
    if (byAccount) return byAccount;
  }
  // Also for someone who answered before signing in, in this browser.
  if (isGrantTokenShape(secrets.editToken)) {
    return findByTokenHash(db, formId, hashGrantToken(secrets.editToken));
  }
  return null;
}

const blockedMessage = (decision: FillDecision) =>
  !decision.allowed && decision.reason === "sign_in"
    ? "这份表单只对 BuilderSpace Hub 的成员开放，请先登录"
    : "这份表单只对指定项目的成员开放";

/* ── the fill page ───────────────────────────────────────────────────── */

export interface FillView {
  publicId: string;
  title: string;
  phase: FormPhase;
  /** Why this person cannot answer; then `form` is null so the questions stay hidden. */
  blocked: "sign_in" | "not_in_project" | null;
  form: {
    access: FormAccess;
    description: string;
    coverImage: string | null;
    fields: FormDefinition["fields"];
  } | null;
  settings: Pick<
    FormSettings,
    "limitOne" | "allowEdit" | "wall" | "likes" | "confirmation"
  >;
  closesAt: Date | null;
  /** Places left, when the form has a limit. */
  remaining: number | null;
  isManager: boolean;
  /** The name answers will be sent under, or null when not signed in. */
  signedInAs: string | null;
  mine: {
    publicId: string;
    answers: Record<string, AnswerInput>;
    updatedAt: Date;
  } | null;
  canSubmit: boolean;
  canEdit: boolean;
  canSeeWall: boolean;
}

export async function openForm(
  db: Db,
  viewer: FormViewer,
  publicId: string,
  secrets: BrowserSecrets = {},
  now: Date = new Date(),
): Promise<FillView> {
  const context = await contextFor(db, viewer, publicId, secrets, now);
  const { form, decision, mine, phase, isManager } = context;
  const open = phase.phase === "open" && decision.allowed;

  return {
    publicId: form.publicId,
    title: form.title,
    phase,
    blocked: decision.allowed ? null : decision.reason,
    form: decision.allowed
      ? {
          access: form.access,
          description: form.definition.description,
          coverImage: form.definition.coverImage,
          fields: form.definition.fields,
        }
      : null,
    settings: {
      limitOne: form.settings.limitOne,
      allowEdit: form.settings.allowEdit,
      wall: form.settings.wall,
      likes: form.settings.likes,
      confirmation: form.settings.confirmation,
    },
    closesAt: form.closesAt,
    remaining:
      form.maxResponses === null
        ? null
        : Math.max(0, form.maxResponses - context.responseCount),
    isManager,
    signedInAs: viewer.userId ? await findUserName(db, viewer.userId) : null,
    mine:
      mine && decision.allowed
        ? {
            publicId: mine.publicId,
            answers: Object.fromEntries(
              Object.entries(mine.answers).map(([id, answer]) => [
                id,
                answerToInput(answer),
              ]),
            ),
            updatedAt: mine.updatedAt,
          }
        : null,
    canSubmit:
      open && form.status === "open" && !(form.settings.limitOne && mine),
    canEdit: open && form.settings.allowEdit && mine !== null,
    canSeeWall: canSeeWall({
      wall: form.settings.wall,
      isManager,
      mayFill: decision.allowed,
      hasAnswered: mine !== null,
    }),
  };
}

/* ── sending and changing an answer ──────────────────────────────────── */

const submitSchema = z.object({
  answers: z.unknown(),
  /** Chosen by the browser for this attempt; sending it again returns the first result. */
  submissionKey: z.string().uuid("提交编号格式不对"),
});

/**
 * The pictures an answer points at, checked: each must belong to this form
 * and to the question it is given for, and be either an upload of this
 * person's not yet used, or already part of `current` (when changing an
 * answer). Returns the ones to attach.
 */
async function checkAnswerImages(
  db: DbOrTx,
  form: FormRow,
  answers: Record<string, StoredAnswer>,
  viewer: FormViewer,
  current: ResponseRow | null,
): Promise<ImageMeta[]> {
  const wanted = answerImages(answers);
  if (wanted.length === 0) return [];
  const found = new Map(
    (
      await listImagesOf(
        db,
        form.id,
        wanted.map((item) => item.imageId),
      )
    ).map((image) => [image.publicId, image]),
  );
  const toAttach: ImageMeta[] = [];
  for (const { fieldId, imageId } of wanted) {
    const image = found.get(imageId);
    const usable =
      image?.kind === "answer" &&
      image.fieldId === fieldId &&
      (image.responseId === null
        ? image.uploadedBy === viewer.userId
        : image.responseId === current?.id);
    if (!image || !usable) {
      throw new AnswerProblemsError({
        [fieldId]: "有图片已经失效了，请删掉后重新上传",
      });
    }
    if (image.responseId === null) toAttach.push(image);
  }
  return toAttach;
}

/**
 * A repeated attempt, answered like the first time. The first token may
 * never have reached the browser, so an anonymous answer gets a new one.
 */
async function replayed(
  db: DbOrTx,
  earlier: ResponseRow,
  viewer: FormViewer,
): Promise<SubmitResult> {
  if (earlier.userId !== viewer.userId) {
    throw new HubError("CONFLICT", "这次提交的编号已经被用过了，请刷新页面");
  }
  const editToken = viewer.userId ? null : generateGrantToken();
  if (editToken) {
    await setEditTokenHash(db, earlier.id, hashGrantToken(editToken));
  }
  return { responsePublicId: earlier.publicId, editToken };
}

/** An upload that another answer, sent at the same moment, took first. */
function imageTakenError(
  wanted: ImageMeta[],
  attached: number[],
): AnswerProblemsError {
  const taken = wanted.find((image) => !attached.includes(image.id));
  return new AnswerProblemsError({
    [taken?.fieldId ?? ""]: "有图片已经失效了，请删掉后重新上传",
  });
}

/**
 * Answers are checked against the form as it was read, before its row is
 * locked. If a manager saved it in between, the check no longer holds.
 */
const changedSince = (read: FormRow, locked: FormRow) =>
  read.updatedAt.getTime() !== locked.updatedAt.getTime();

const formChangedError = () =>
  new HubError("CONFLICT", "表单刚刚有改动，请刷新页面后再提交");

function closedError(phase: FormPhase): HubError {
  if (phase.phase === "closed") {
    return new HubError("CONFLICT", closedReasonText[phase.reason]);
  }
  return new HubError("CONFLICT", "表单还没有发布，发布后才能提交");
}

export interface SubmitResult {
  responsePublicId: string;
  /**
   * For an anonymous answer: the secret that lets this browser see and
   * change it later. Shown only now; only its hash is kept.
   */
  editToken: string | null;
}

export async function submitResponse(
  db: Db,
  viewer: FormViewer,
  publicId: string,
  rawInput: z.input<typeof submitSchema>,
  secrets: BrowserSecrets = {},
  now: Date = new Date(),
): Promise<SubmitResult> {
  const input = parse(submitSchema, rawInput);
  const context = await contextFor(db, viewer, publicId, secrets, now);
  const { form, decision } = context;

  // A retry of an attempt that already went through gets the first answer
  // back, even if the form has changed since: nothing is checked again.
  const earlier = await findBySubmissionKey(db, form.id, input.submissionKey);
  if (earlier) return replayed(db, earlier, viewer);

  if (!decision.allowed)
    throw new HubError("FORBIDDEN", blockedMessage(decision));
  if (form.status === "draft") throw closedError(context.phase);

  const checked = checkAnswers(form.definition, input.answers);
  if (!checked.ok) throw new AnswerProblemsError(checked.errors);
  const toAttach = await checkAnswerImages(
    db,
    form,
    checked.answers,
    viewer,
    null,
  );
  const respondentName = viewer.userId
    ? await findUserName(db, viewer.userId)
    : null;

  // An anonymous answer gets a secret so this browser can find it again.
  const editToken = viewer.userId ? null : generateGrantToken();
  const editTokenHash = editToken ? hashGrantToken(editToken) : null;

  const run = () =>
    db.transaction(async (tx) => {
      const locked = await lockForm(tx, form.id);
      if (!locked) throw new HubError("NOT_FOUND", NOT_FOUND);
      if (changedSince(form, locked)) throw formChangedError();

      // The same attempt arriving again (a retry after a dropped connection):
      // answer as the first time did. The first token may never have reached
      // the browser, so an anonymous answer gets the new one instead.
      const replay = await findBySubmissionKey(
        tx,
        form.id,
        input.submissionKey,
      );
      if (replay) {
        if (replay.userId !== viewer.userId) {
          throw new HubError(
            "CONFLICT",
            "这次提交的编号已经被用过了，请刷新页面",
          );
        }
        if (editTokenHash) await setEditTokenHash(tx, replay.id, editTokenHash);
        return replay;
      }

      const phase = formPhase(locked, await countResponses(tx, form.id), now);
      if (phase.phase !== "open") throw closedError(phase);

      // Anonymous people are known by the token this browser kept.
      if (locked.settings.limitOne) {
        if (await findMine(tx, form.id, viewer, secrets)) {
          throw new HubError(
            "CONFLICT",
            locked.settings.allowEdit
              ? "你已经提交过了，可以在页面上修改之前的回答"
              : "你已经提交过了，每人只能提交一次",
          );
        }
      }

      const response = await insertResponse(tx, {
        publicId: generateUID(),
        formId: form.id,
        userId: viewer.userId,
        respondentName,
        answers: checked.answers,
        submissionKey: input.submissionKey,
        editTokenHash,
        now,
      });
      const attached = await attachImages(
        tx,
        toAttach.map((image) => image.id),
        response.id,
      );
      if (attached.length < toAttach.length) {
        throw imageTakenError(toAttach, attached);
      }
      return response;
    });

  let response: ResponseRow;
  try {
    response = await run();
  } catch (error) {
    // Two copies of one attempt raced past the replay check; the second
    // run finds the first one's answer.
    if (!isUniqueViolation(error)) throw error;
    response = await run();
  }
  return { responsePublicId: response.publicId, editToken };
}

const updateSchema = z.object({ answers: z.unknown() });

/** Changes one's own answer, while the form is open and allows it. */
export async function updateMyResponse(
  db: Db,
  viewer: FormViewer,
  publicId: string,
  rawInput: z.input<typeof updateSchema>,
  secrets: BrowserSecrets = {},
  now: Date = new Date(),
): Promise<{ responsePublicId: string }> {
  const input = parse(updateSchema, rawInput);
  const context = await contextFor(db, viewer, publicId, secrets, now);
  const { form, decision, mine } = context;
  if (!decision.allowed)
    throw new HubError("FORBIDDEN", blockedMessage(decision));
  if (!mine) throw new HubError("NOT_FOUND", "找不到你之前的回答");
  if (!form.settings.allowEdit) {
    throw new HubError("FORBIDDEN", "这份表单提交后不能修改");
  }

  const checked = checkAnswers(form.definition, input.answers);
  if (!checked.ok) throw new AnswerProblemsError(checked.errors);
  const toAttach = await checkAnswerImages(
    db,
    form,
    checked.answers,
    viewer,
    mine,
  );
  const kept = new Set(
    answerImages(checked.answers).map((item) => item.imageId),
  );

  await db.transaction(async (tx) => {
    const locked = await lockForm(tx, form.id);
    if (!locked) throw new HubError("NOT_FOUND", NOT_FOUND);
    if (changedSince(form, locked)) throw formChangedError();
    // Changes to answers take the form lock too, so this sees any change
    // another tab made to the same answer after it was read.
    const current = await findResponseById(tx, mine.id);
    if (current?.updatedAt.getTime() !== mine.updatedAt.getTime()) {
      throw new HubError(
        "CONFLICT",
        "这份回答刚刚在别处改过，请刷新页面后再改",
      );
    }
    // A full form still lets people fix what they sent; a closed one does not.
    const phase = formPhase(locked, 0, now);
    if (phase.phase !== "open") throw closedError(phase);

    await updateResponseAnswers(tx, mine.id, checked.answers, now);
    const attached = await attachImages(
      tx,
      toAttach.map((image) => image.id),
      mine.id,
    );
    if (attached.length < toAttach.length) {
      throw imageTakenError(toAttach, attached);
    }
    const dropped = (await listResponseImages(tx, mine.id)).filter(
      (image) => !kept.has(image.publicId),
    );
    await deleteImages(
      tx,
      dropped.map((image) => image.id),
    );
  });
  return { responsePublicId: mine.publicId };
}

/* ── the results wall ────────────────────────────────────────────────── */

export const WALL_PAGE_SIZE = 24;

export interface WallEntry {
  publicId: string;
  /** Who sent it, when the form shows names and they were signed in. */
  name: string | null;
  createdAt: Date;
  answers: { fieldId: string; title: string; answer: StoredAnswer }[];
  likes: number;
  liked: boolean;
  mine: boolean;
}

export interface Wall {
  title: string;
  entries: WallEntry[];
  total: number;
  pageSize: number;
  likes: LikeMode;
  /** Whether this viewer may like at all (they still cannot like their own). */
  canLike: boolean;
}

function voterKeyOf(
  viewer: FormViewer,
  secrets: BrowserSecrets,
): string | null {
  if (viewer.userId) return `u:${viewer.userId}`;
  if (
    typeof secrets.browserKey === "string" &&
    BROWSER_KEY.test(secrets.browserKey)
  ) {
    return `b:${sha256(secrets.browserKey)}`;
  }
  return null;
}

function requireWall(context: ViewerContext): void {
  const { form, decision, isManager, mine } = context;
  if (
    canSeeWall({
      wall: form.settings.wall,
      isManager,
      mayFill: decision.allowed,
      hasAnswered: mine !== null,
    })
  ) {
    return;
  }
  if (!decision.allowed)
    throw new HubError("FORBIDDEN", blockedMessage(decision));
  const why: Record<WallMode, string> = {
    off: "这份表单没有公开大家的回答",
    after_submit: "提交之后才能看到大家的回答",
    always: "",
  };
  throw new HubError("FORBIDDEN", why[form.settings.wall]);
}

const wallSchema = z.object({
  page: z.number().int().min(1).max(10_000).default(1),
  sort: z.enum(["newest", "likes"]).default("newest"),
});

export async function getWall(
  db: Db,
  viewer: FormViewer,
  publicId: string,
  rawInput: z.input<typeof wallSchema>,
  secrets: BrowserSecrets = {},
  now: Date = new Date(),
): Promise<Wall> {
  const input = parse(wallSchema, rawInput);
  const context = await contextFor(db, viewer, publicId, secrets, now);
  requireWall(context);
  const { form, mine } = context;

  const shown = form.definition.fields.filter(
    (field) => isQuestion(field) && field.onWall,
  );
  const rows = await listResponses(db, form.id, {
    limit: WALL_PAGE_SIZE,
    offset: (input.page - 1) * WALL_PAGE_SIZE,
    sort: input.sort,
  });
  const voterKey = voterKeyOf(viewer, secrets);
  const liked = voterKey
    ? await likedBy(
        db,
        rows.map((row) => row.id),
        voterKey,
      )
    : new Set<number>();

  return {
    title: form.title,
    entries: rows.map((row) => ({
      publicId: row.publicId,
      name: form.settings.wallShowNames && row.userId ? row.respondent : null,
      createdAt: row.createdAt,
      answers: shown.flatMap((field) => {
        const answer = row.answers[field.id];
        return answer
          ? [{ fieldId: field.id, title: field.title, answer }]
          : [];
      }),
      likes: row.likes,
      liked: liked.has(row.id),
      mine: isOwn(row, viewer, mine),
    })),
    total: context.responseCount,
    pageSize: WALL_PAGE_SIZE,
    likes: form.settings.likes,
    canLike:
      form.settings.likes !== "off" &&
      (viewer.userId !== null ||
        (form.settings.likes === "anyone" && voterKey !== null)),
  };
}

const isOwn = (
  row: { id: number; userId: string | null },
  viewer: FormViewer,
  mine: ResponseRow | null,
) =>
  (viewer.userId !== null && row.userId === viewer.userId) ||
  (mine !== null && mine.id === row.id);

const likeSchema = z.object({
  responsePublicId: z.string().min(1).max(32),
  like: z.boolean(),
});

export async function likeResponse(
  db: Db,
  viewer: FormViewer,
  publicId: string,
  rawInput: z.input<typeof likeSchema>,
  secrets: BrowserSecrets = {},
  now: Date = new Date(),
): Promise<{ liked: boolean; likes: number }> {
  const input = parse(likeSchema, rawInput);
  const context = await contextFor(db, viewer, publicId, secrets, now);
  requireWall(context);
  const response = await findResponse(
    db,
    context.form.id,
    input.responsePublicId,
  );
  if (!response) throw new HubError("NOT_FOUND", "找不到这份回答");

  const voterKey = voterKeyOf(viewer, secrets);
  const decision = canLike({
    likes: context.form.settings.likes,
    signedIn: viewer.userId !== null,
    hasBrowserKey: voterKey !== null,
    isOwnAnswer: isOwn(response, viewer, context.mine),
  });
  if (!decision.allowed || !voterKey) {
    throw new HubError(
      "FORBIDDEN",
      decision.allowed ? "不能点赞" : decision.reason,
    );
  }
  await setLike(db, response.id, voterKey, input.like);
  return { liked: input.like, likes: await countLikes(db, response.id) };
}

/* ── answers, for managers ───────────────────────────────────────────── */

export const RESPONSES_PAGE_SIZE = 30;
/** The most answers read at once for the summary and the export. */
export const EXPORT_LIMIT = 5000;

export interface ManagedResponse {
  publicId: string;
  respondent: string | null;
  respondentEmail: string | null;
  signedIn: boolean;
  answers: Record<string, StoredAnswer>;
  likes: number;
  createdAt: Date;
  updatedAt: Date;
}

const managedOf = (row: ListedResponse): ManagedResponse => ({
  publicId: row.publicId,
  respondent: row.respondent,
  respondentEmail: row.respondentEmail,
  signedIn: row.userId !== null,
  answers: row.answers,
  likes: row.likes,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const listSchema = z.object({
  formPublicId: z.string().min(1).max(32),
  page: z.number().int().min(1).max(10_000).default(1),
  sort: z.enum(["newest", "likes"]).default("newest"),
});

export async function listFormResponses(
  db: Db,
  actor: AdminActor,
  rawInput: z.input<typeof listSchema>,
): Promise<{ items: ManagedResponse[]; total: number; pageSize: number }> {
  const input = parse(listSchema, rawInput);
  const { row } = await loadManaged(db, actor, input.formPublicId);
  const [rows, total] = await Promise.all([
    listResponses(db, row.id, {
      limit: RESPONSES_PAGE_SIZE,
      offset: (input.page - 1) * RESPONSES_PAGE_SIZE,
      sort: input.sort,
    }),
    countResponses(db, row.id),
  ]);
  return { items: rows.map(managedOf), total, pageSize: RESPONSES_PAGE_SIZE };
}

export interface ExportColumn {
  fieldId: string;
  title: string;
  /** The question was deleted after these answers came in. */
  removed: boolean;
  type: "text" | "choice" | "images";
}

/**
 * The columns for a set of answers: today's questions in order, then any
 * deleted question that still has answers, under the title it had.
 */
export function columnsFor(
  definition: FormDefinition,
  answers: Record<string, StoredAnswer>[],
): ExportColumn[] {
  const columns: ExportColumn[] = definition.fields
    .filter(isQuestion)
    .map((field) => ({
      fieldId: field.id,
      title: field.title,
      removed: false,
      type:
        field.type === "image"
          ? "images"
          : field.type === "single_choice" || field.type === "multi_choice"
            ? "choice"
            : "text",
    }));
  const known = new Set(columns.map((column) => column.fieldId));
  for (const set of answers) {
    for (const [fieldId, answer] of Object.entries(set)) {
      if (known.has(fieldId)) continue;
      known.add(fieldId);
      columns.push({
        fieldId,
        title: answer.title,
        removed: true,
        type: answer.type,
      });
    }
  }
  return columns;
}

export interface ResponseExport {
  title: string;
  columns: ExportColumn[];
  items: ManagedResponse[];
  /** More answers exist than were read. */
  truncated: boolean;
}

/** Every answer (up to EXPORT_LIMIT) and how many there are in all. */
async function readAll(db: Db, form: FormRow) {
  const [rows, total] = await Promise.all([
    listResponses(db, form.id, { limit: EXPORT_LIMIT, offset: 0 }),
    countResponses(db, form.id),
  ]);
  return { rows, total };
}

/** Every answer (up to EXPORT_LIMIT), for the CSV file. */
export async function exportResponses(
  db: Db,
  actor: AdminActor,
  formPublicId: string,
): Promise<ResponseExport> {
  const { row } = await loadManaged(db, actor, formPublicId);
  const { rows, total } = await readAll(db, row);
  return {
    title: row.title,
    columns: columnsFor(
      row.definition,
      rows.map((item) => item.answers),
    ),
    items: rows.map(managedOf),
    truncated: total > rows.length,
  };
}

export interface QuestionSummary {
  fieldId: string;
  title: string;
  type: "text" | "choice" | "images";
  removed: boolean;
  answered: number;
  /** For choices: each option with how many chose it, today's options first. */
  options: { id: string; label: string; count: number; removed: boolean }[];
  /** For choices: how many wrote something next to 其他, and the latest few. */
  other: { count: number; latest: string[] };
  /** For text: the latest few answers. */
  latest: string[];
  /** For pictures: how many in all. */
  images: number;
}

export interface ResponseSummary {
  total: number;
  truncated: boolean;
  questions: QuestionSummary[];
}

/** Counts per question and option over every answer, for the charts. */
export function summarize(
  definition: FormDefinition,
  items: { answers: Record<string, StoredAnswer> }[],
): QuestionSummary[] {
  const columns = columnsFor(
    definition,
    items.map((item) => item.answers),
  );
  return columns.map((column) => {
    const field = definition.fields.find((f) => f.id === column.fieldId);
    const options =
      field && (field.type === "single_choice" || field.type === "multi_choice")
        ? field.options.map((item) => ({
            id: item.id,
            label: item.label,
            count: 0,
            removed: false,
          }))
        : [];
    const summary: QuestionSummary = {
      ...column,
      answered: 0,
      options,
      other: { count: 0, latest: [] },
      latest: [],
      images: 0,
    };
    for (const { answers } of items) {
      const answer = answers[column.fieldId];
      if (!answer) continue;
      summary.answered += 1;
      if (answer.type === "choice") {
        for (const chosen of answer.selected) {
          let option = summary.options.find((item) => item.id === chosen.id);
          if (!option) {
            option = {
              id: chosen.id,
              label: chosen.label,
              count: 0,
              removed: true,
            };
            summary.options.push(option);
          }
          option.count += 1;
        }
        if (answer.other !== null) {
          summary.other.count += 1;
          if (summary.other.latest.length < 10)
            summary.other.latest.push(answer.other);
        }
      } else if (answer.type === "text") {
        if (summary.latest.length < 5) summary.latest.push(answerText(answer));
      } else {
        summary.images += answer.images.length;
      }
    }
    return summary;
  });
}

export async function summarizeResponses(
  db: Db,
  actor: AdminActor,
  formPublicId: string,
): Promise<ResponseSummary> {
  const { row } = await loadManaged(db, actor, formPublicId);
  const { rows, total } = await readAll(db, row);
  return {
    total,
    truncated: total > rows.length,
    questions: summarize(row.definition, rows),
  };
}

export async function deleteFormResponse(
  db: Db,
  actor: AdminActor,
  input: { formPublicId: string; responsePublicId: string },
): Promise<void> {
  const { row } = await loadManaged(db, actor, input.formPublicId);
  const response = await findResponse(db, row.id, input.responsePublicId);
  if (!response) throw new HubError("NOT_FOUND", "找不到这份回答");
  await withAudit(
    db,
    (tx) => deleteResponse(tx, response.id),
    () => ({
      actor,
      action: "form_response.deleted",
      entityType: "form",
      entityId: row.publicId,
      summary: `删除了表单「${row.title}」的一份回答${
        response.respondentName ? `（${response.respondentName}）` : "（匿名）"
      }`,
      detail: { responsePublicId: response.publicId },
    }),
  );
}
