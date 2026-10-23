import type { AnyPgColumn, AnyPgTable } from "drizzle-orm/pg-core";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";

import { users } from "@kan/db/schema";

import type { DbOrTx } from "../db";
import type { FormImageKind, HubRole } from "../schema";
import type { StoredAnswer } from "./form.model";
import {
  hubAccounts,
  hubFormImages,
  hubFormLikes,
  hubFormManagers,
  hubFormResponses,
  hubForms,
} from "../schema";

/** A person's name for display; their e-mail when they never set one. */
const userName = sql<string>`coalesce(${users.name}, ${users.email})`;

export type FormRow = typeof hubForms.$inferSelect;
export type ResponseRow = typeof hubFormResponses.$inferSelect;

/* ── forms ───────────────────────────────────────────────────────────── */

/**
 * A column with its table name, for subqueries that look at the outer row.
 * A select from one table leaves table names out, and inside a subquery a
 * bare "id" would then mean the inner table's own id.
 */
const qualified = (table: AnyPgTable, column: AnyPgColumn) =>
  sql`${table}.${sql.identifier(column.name)}`;

const formIdOuter = qualified(hubForms, hubForms.id);

const responseCount = sql<number>`(
  SELECT count(*)::int FROM ${hubFormResponses}
  WHERE ${qualified(hubFormResponses, hubFormResponses.formId)} = ${formIdOuter}
)`;

export type NewForm = Omit<FormRow, "id" | "createdAt" | "updatedAt">;

export async function insertForm(
  db: DbOrTx,
  row: NewForm & { now: Date },
): Promise<FormRow> {
  const { now, ...values } = row;
  const [created] = await db
    .insert(hubForms)
    .values({ ...values, createdAt: now, updatedAt: now })
    .returning();
  if (!created) throw new Error("insertForm: no row returned");
  return created;
}

export async function findForm(
  db: DbOrTx,
  publicId: string,
): Promise<FormRow | null> {
  const [row] = await db
    .select()
    .from(hubForms)
    .where(eq(hubForms.publicId, publicId))
    .limit(1);
  return row ?? null;
}

export async function findFormById(
  db: DbOrTx,
  id: number,
): Promise<FormRow | null> {
  const [row] = await db
    .select()
    .from(hubForms)
    .where(eq(hubForms.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * The form row, locked until the transaction ends. Answers to one form are
 * written one after another, so two people sending the last free place at
 * the same moment cannot both get it.
 */
export async function lockForm(
  db: DbOrTx,
  id: number,
): Promise<FormRow | null> {
  const [row] = await db
    .select()
    .from(hubForms)
    .where(eq(hubForms.id, id))
    .for("update")
    .limit(1);
  return row ?? null;
}

export type FormPatch = Partial<
  Pick<
    FormRow,
    | "title"
    | "status"
    | "access"
    | "definition"
    | "settings"
    | "closesAt"
    | "maxResponses"
  >
>;

/**
 * Writes the patch unless the form changed after `expected` (when given).
 * Returns false when it did change, so a save never silently overwrites
 * someone else's.
 */
export async function updateForm(
  db: DbOrTx,
  id: number,
  patch: FormPatch,
  now: Date,
  expected?: Date,
): Promise<boolean> {
  const written = await db
    .update(hubForms)
    .set({ ...patch, updatedAt: now })
    .where(
      expected
        ? and(eq(hubForms.id, id), eq(hubForms.updatedAt, expected))
        : eq(hubForms.id, id),
    )
    .returning({ id: hubForms.id });
  return written.length > 0;
}

export async function deleteForm(db: DbOrTx, id: number): Promise<void> {
  await db.delete(hubForms).where(eq(hubForms.id, id));
}

export type FormListRow = FormRow & { responseCount: number };

/** Every form (for an owner), or the ones this person manages. Newest first. */
export async function listManagedForms(
  db: DbOrTx,
  input: { userId: string; all: boolean },
): Promise<FormListRow[]> {
  const query = db
    .select({ form: hubForms, responseCount })
    .from(hubForms)
    .orderBy(desc(hubForms.updatedAt), desc(hubForms.id));
  const rows = input.all
    ? await query
    : await query.where(
        sql`EXISTS (
          SELECT 1 FROM ${hubFormManagers}
          WHERE ${qualified(hubFormManagers, hubFormManagers.formId)} = ${formIdOuter}
            AND ${qualified(hubFormManagers, hubFormManagers.userId)} = ${input.userId}
        )`,
      );
  return rows.map((row) => ({ ...row.form, responseCount: row.responseCount }));
}

/**
 * Forms one signed-in person may answer now, for the 待填写 list: open, before
 * the deadline, not full, and for all members or one of their projects, with
 * whether they have answered. Filtered here, before the cap, so other
 * people's forms cannot crowd theirs out.
 */
export async function listFormsToFill(
  db: DbOrTx,
  input: { userId: string; projectIds: string[]; now: Date },
): Promise<(FormListRow & { answered: boolean })[]> {
  const inTheirProjects =
    input.projectIds.length === 0
      ? undefined
      : and(
          eq(hubForms.access, "projects"),
          sql`EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(${qualified(hubForms, hubForms.settings)} -> 'projectIds') AS project(id)
            WHERE project.id IN (${sql.join(
              input.projectIds.map((id) => sql`${id}`),
              sql`, `,
            )})
          )`,
        );
  const rows = await db
    .select({
      form: hubForms,
      responseCount,
      answered: sql<boolean>`EXISTS (
        SELECT 1 FROM ${hubFormResponses}
        WHERE ${qualified(hubFormResponses, hubFormResponses.formId)} = ${formIdOuter}
          AND ${qualified(hubFormResponses, hubFormResponses.userId)} = ${input.userId}
      )`,
    })
    .from(hubForms)
    .where(
      and(
        eq(hubForms.status, "open"),
        or(isNull(hubForms.closesAt), gt(hubForms.closesAt, input.now)),
        or(
          isNull(hubForms.maxResponses),
          sql`${responseCount} < ${hubForms.maxResponses}`,
        ),
        or(eq(hubForms.access, "members"), inTheirProjects),
      ),
    )
    .orderBy(desc(hubForms.updatedAt))
    .limit(100);
  return rows.map((row) => ({
    ...row.form,
    responseCount: row.responseCount,
    answered: row.answered,
  }));
}

/* ── managers ────────────────────────────────────────────────────────── */

export async function isManager(
  db: DbOrTx,
  formId: number,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ userId: hubFormManagers.userId })
    .from(hubFormManagers)
    .where(
      and(
        eq(hubFormManagers.formId, formId),
        eq(hubFormManagers.userId, userId),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export async function addManager(
  db: DbOrTx,
  row: { formId: number; userId: string; grantedBy: string | null },
): Promise<boolean> {
  const added = await db
    .insert(hubFormManagers)
    .values(row)
    .onConflictDoNothing()
    .returning({ userId: hubFormManagers.userId });
  return added.length > 0;
}

export async function removeManager(
  db: DbOrTx,
  formId: number,
  userId: string,
): Promise<boolean> {
  const removed = await db
    .delete(hubFormManagers)
    .where(
      and(
        eq(hubFormManagers.formId, formId),
        eq(hubFormManagers.userId, userId),
      ),
    )
    .returning({ userId: hubFormManagers.userId });
  return removed.length > 0;
}

export interface ManagerRow {
  userId: string;
  name: string;
  email: string;
  grantedAt: Date;
}

export async function listManagers(
  db: DbOrTx,
  formId: number,
): Promise<ManagerRow[]> {
  return db
    .select({
      userId: hubFormManagers.userId,
      name: userName,
      email: users.email,
      grantedAt: hubFormManagers.grantedAt,
    })
    .from(hubFormManagers)
    .innerJoin(users, eq(users.id, hubFormManagers.userId))
    .where(eq(hubFormManagers.formId, formId))
    .orderBy(asc(hubFormManagers.grantedAt));
}

export interface CandidateRow {
  userId: string;
  name: string;
  email: string;
  hubRole: HubRole | null;
}

/** Active accounts matching the search that do not manage the form yet. */
export async function searchManagerCandidates(
  db: DbOrTx,
  input: { formId: number; search: string; limit: number },
): Promise<CandidateRow[]> {
  const pattern = `%${input.search.replace(/[\\%_]/g, "\\$&")}%`;
  return db
    .select({
      userId: users.id,
      name: userName,
      email: users.email,
      hubRole: hubAccounts.role,
    })
    .from(users)
    .leftJoin(hubAccounts, eq(hubAccounts.userId, users.id))
    .where(
      and(
        or(isNull(hubAccounts.status), eq(hubAccounts.status, "active")),
        or(ilike(users.name, pattern), ilike(users.email, pattern)),
        sql`NOT EXISTS (
          SELECT 1 FROM ${hubFormManagers}
          WHERE ${hubFormManagers.formId} = ${input.formId}
            AND ${hubFormManagers.userId} = ${users.id}
        )`,
      ),
    )
    .orderBy(asc(users.name))
    .limit(input.limit);
}

export async function findUserName(
  db: DbOrTx,
  userId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ name: userName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.name ?? null;
}

/* ── responses ───────────────────────────────────────────────────────── */

export async function countResponses(
  db: DbOrTx,
  formId: number,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(hubFormResponses)
    .where(eq(hubFormResponses.formId, formId));
  return row?.n ?? 0;
}

export async function insertResponse(
  db: DbOrTx,
  row: Omit<ResponseRow, "id" | "createdAt" | "updatedAt"> & { now: Date },
): Promise<ResponseRow> {
  const { now, ...values } = row;
  const [created] = await db
    .insert(hubFormResponses)
    .values({ ...values, createdAt: now, updatedAt: now })
    .returning();
  if (!created) throw new Error("insertResponse: no row returned");
  return created;
}

export async function updateResponseAnswers(
  db: DbOrTx,
  id: number,
  answers: Record<string, StoredAnswer>,
  now: Date,
): Promise<void> {
  await db
    .update(hubFormResponses)
    .set({ answers, updatedAt: now })
    .where(eq(hubFormResponses.id, id));
}

export async function setEditTokenHash(
  db: DbOrTx,
  id: number,
  editTokenHash: string,
): Promise<void> {
  await db
    .update(hubFormResponses)
    .set({ editTokenHash })
    .where(eq(hubFormResponses.id, id));
}

export async function deleteResponse(db: DbOrTx, id: number): Promise<void> {
  await db.delete(hubFormResponses).where(eq(hubFormResponses.id, id));
}

export async function findResponse(
  db: DbOrTx,
  formId: number,
  publicId: string,
): Promise<ResponseRow | null> {
  const [row] = await db
    .select()
    .from(hubFormResponses)
    .where(
      and(
        eq(hubFormResponses.formId, formId),
        eq(hubFormResponses.publicId, publicId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function findResponseById(
  db: DbOrTx,
  id: number,
): Promise<ResponseRow | null> {
  const [row] = await db
    .select()
    .from(hubFormResponses)
    .where(eq(hubFormResponses.id, id))
    .limit(1);
  return row ?? null;
}

/** The answer a browser already sent under this key (a retry), if any. */
export async function findBySubmissionKey(
  db: DbOrTx,
  formId: number,
  submissionKey: string,
): Promise<ResponseRow | null> {
  const [row] = await db
    .select()
    .from(hubFormResponses)
    .where(
      and(
        eq(hubFormResponses.formId, formId),
        eq(hubFormResponses.submissionKey, submissionKey),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** This person's latest answer to the form. */
export async function findLatestByUser(
  db: DbOrTx,
  formId: number,
  userId: string,
): Promise<ResponseRow | null> {
  const [row] = await db
    .select()
    .from(hubFormResponses)
    .where(
      and(
        eq(hubFormResponses.formId, formId),
        eq(hubFormResponses.userId, userId),
      ),
    )
    .orderBy(desc(hubFormResponses.createdAt), desc(hubFormResponses.id))
    .limit(1);
  return row ?? null;
}

export async function findByTokenHash(
  db: DbOrTx,
  formId: number,
  tokenHash: string,
): Promise<ResponseRow | null> {
  const [row] = await db
    .select()
    .from(hubFormResponses)
    .where(
      and(
        eq(hubFormResponses.formId, formId),
        eq(hubFormResponses.editTokenHash, tokenHash),
      ),
    )
    .limit(1);
  return row ?? null;
}

export interface ListedResponse {
  id: number;
  publicId: string;
  userId: string | null;
  /** The account's current name, else the name copied in when it was sent. */
  respondent: string | null;
  respondentEmail: string | null;
  answers: Record<string, StoredAnswer>;
  likes: number;
  createdAt: Date;
  updatedAt: Date;
}

const likeCount = sql<number>`(
  SELECT count(*)::int FROM ${hubFormLikes}
  WHERE ${qualified(hubFormLikes, hubFormLikes.responseId)} = ${qualified(hubFormResponses, hubFormResponses.id)}
)`;

const listedColumns = {
  id: hubFormResponses.id,
  publicId: hubFormResponses.publicId,
  userId: hubFormResponses.userId,
  respondent: sql<
    string | null
  >`coalesce(${users.name}, ${users.email}, ${hubFormResponses.respondentName})`,
  respondentEmail: users.email,
  answers: hubFormResponses.answers,
  likes: likeCount,
  createdAt: hubFormResponses.createdAt,
  updatedAt: hubFormResponses.updatedAt,
};

/** One page of a form's answers, newest first, or most liked first. */
export async function listResponses(
  db: DbOrTx,
  formId: number,
  page: { limit: number; offset: number; sort?: "newest" | "likes" },
): Promise<ListedResponse[]> {
  return db
    .select(listedColumns)
    .from(hubFormResponses)
    .leftJoin(users, eq(users.id, hubFormResponses.userId))
    .where(eq(hubFormResponses.formId, formId))
    .orderBy(
      ...(page.sort === "likes" ? [desc(likeCount)] : []),
      desc(hubFormResponses.createdAt),
      desc(hubFormResponses.id),
    )
    .limit(page.limit)
    .offset(page.offset);
}

/** Which of these answers the voter has liked. */
export async function likedBy(
  db: DbOrTx,
  responseIds: number[],
  voterKey: string,
): Promise<Set<number>> {
  if (responseIds.length === 0) return new Set();
  const rows = await db
    .select({ responseId: hubFormLikes.responseId })
    .from(hubFormLikes)
    .where(
      and(
        inArray(hubFormLikes.responseId, responseIds),
        eq(hubFormLikes.voterKey, voterKey),
      ),
    );
  return new Set(rows.map((row) => row.responseId));
}

/* ── likes ───────────────────────────────────────────────────────────── */

/** Adds or removes the voter's like; doing either twice is harmless. */
export async function setLike(
  db: DbOrTx,
  responseId: number,
  voterKey: string,
  like: boolean,
): Promise<void> {
  if (like) {
    await db
      .insert(hubFormLikes)
      .values({ responseId, voterKey })
      .onConflictDoNothing();
  } else {
    await db
      .delete(hubFormLikes)
      .where(
        and(
          eq(hubFormLikes.responseId, responseId),
          eq(hubFormLikes.voterKey, voterKey),
        ),
      );
  }
}

export async function countLikes(
  db: DbOrTx,
  responseId: number,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(hubFormLikes)
    .where(eq(hubFormLikes.responseId, responseId));
  return row?.n ?? 0;
}

/* ── images ──────────────────────────────────────────────────────────── */

export type ImageRow = typeof hubFormImages.$inferSelect;
export type ImageMeta = Omit<ImageRow, "body">;

/** Every column but the bytes, so listing pictures never loads them. */
const imageMeta = {
  id: hubFormImages.id,
  publicId: hubFormImages.publicId,
  formId: hubFormImages.formId,
  responseId: hubFormImages.responseId,
  fieldId: hubFormImages.fieldId,
  kind: hubFormImages.kind,
  uploadedBy: hubFormImages.uploadedBy,
  contentType: hubFormImages.contentType,
  size: hubFormImages.size,
  width: hubFormImages.width,
  height: hubFormImages.height,
  createdAt: hubFormImages.createdAt,
};

export async function insertImage(
  db: DbOrTx,
  row: Omit<ImageRow, "id" | "createdAt"> & { now: Date },
): Promise<ImageMeta> {
  const { now, ...values } = row;
  const [created] = await db
    .insert(hubFormImages)
    .values({ ...values, createdAt: now })
    .returning(imageMeta);
  if (!created) throw new Error("insertImage: no row returned");
  return created;
}

export async function findImageMeta(
  db: DbOrTx,
  publicId: string,
): Promise<ImageMeta | null> {
  const [row] = await db
    .select(imageMeta)
    .from(hubFormImages)
    .where(eq(hubFormImages.publicId, publicId))
    .limit(1);
  return row ?? null;
}

export async function readImageBody(db: DbOrTx, id: number): Promise<Buffer> {
  const [row] = await db
    .select({ body: hubFormImages.body })
    .from(hubFormImages)
    .where(eq(hubFormImages.id, id))
    .limit(1);
  if (!row) throw new Error("readImageBody: image vanished");
  // PGlite hands back a Uint8Array, node-postgres a Buffer.
  return Buffer.from(row.body);
}

export async function listImagesOf(
  db: DbOrTx,
  formId: number,
  publicIds: string[],
): Promise<ImageMeta[]> {
  if (publicIds.length === 0) return [];
  return db
    .select(imageMeta)
    .from(hubFormImages)
    .where(
      and(
        eq(hubFormImages.formId, formId),
        inArray(hubFormImages.publicId, publicIds),
      ),
    );
}

export async function listImagesOfKind(
  db: DbOrTx,
  formId: number,
  kind: FormImageKind,
): Promise<ImageMeta[]> {
  return db
    .select(imageMeta)
    .from(hubFormImages)
    .where(and(eq(hubFormImages.formId, formId), eq(hubFormImages.kind, kind)));
}

export async function listResponseImages(
  db: DbOrTx,
  responseId: number,
): Promise<ImageMeta[]> {
  return db
    .select(imageMeta)
    .from(hubFormImages)
    .where(eq(hubFormImages.responseId, responseId));
}

/**
 * Makes uploads part of an answer. Only ones still unattached: another
 * answer sent at the same moment may have taken one. Returns the ids attached.
 */
export async function attachImages(
  db: DbOrTx,
  ids: number[],
  responseId: number,
): Promise<number[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .update(hubFormImages)
    .set({ responseId })
    .where(
      and(inArray(hubFormImages.id, ids), isNull(hubFormImages.responseId)),
    )
    .returning({ id: hubFormImages.id });
  return rows.map((row) => row.id);
}

export async function deleteImages(db: DbOrTx, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await db.delete(hubFormImages).where(inArray(hubFormImages.id, ids));
}

/** Answer pictures uploaded before `before` that never became part of an answer. */
export async function deleteAbandonedUploads(
  db: DbOrTx,
  formId: number,
  before: Date,
): Promise<void> {
  await db
    .delete(hubFormImages)
    .where(
      and(
        eq(hubFormImages.formId, formId),
        eq(hubFormImages.kind, "answer"),
        isNull(hubFormImages.responseId),
        lt(hubFormImages.createdAt, before),
      ),
    );
}

export async function imageUsage(
  db: DbOrTx,
  formId: number,
  pendingSince: Date,
): Promise<{ bytes: number; pending: number }> {
  const [row] = await db
    .select({
      bytes: sql<number>`coalesce(sum(${hubFormImages.size}), 0)::bigint`,
      pending: sql<number>`count(*) FILTER (
        WHERE ${hubFormImages.responseId} IS NULL
          AND ${hubFormImages.kind} = 'answer'
          AND ${hubFormImages.createdAt} >= ${pendingSince}
      )::int`,
    })
    .from(hubFormImages)
    .where(eq(hubFormImages.formId, formId));
  return { bytes: Number(row?.bytes ?? 0), pending: row?.pending ?? 0 };
}

/** Copies pictures (bytes and all) into another form, for duplicating a form. */
export async function copyImages(
  db: DbOrTx,
  input: {
    fromFormId: number;
    toFormId: number;
    publicIds: Map<string, string>;
    uploadedBy: string | null;
    now: Date;
  },
): Promise<void> {
  const ids = [...input.publicIds.keys()];
  if (ids.length === 0) return;
  const rows = await db
    .select()
    .from(hubFormImages)
    .where(
      and(
        eq(hubFormImages.formId, input.fromFormId),
        inArray(hubFormImages.publicId, ids),
      ),
    );
  if (rows.length === 0) return;
  await db.insert(hubFormImages).values(
    rows.map((row) => ({
      publicId: input.publicIds.get(row.publicId) ?? row.publicId,
      formId: input.toFormId,
      responseId: null,
      fieldId: null,
      kind: "asset" as const,
      uploadedBy: input.uploadedBy,
      contentType: row.contentType,
      size: row.size,
      width: row.width,
      height: row.height,
      body: row.body,
      createdAt: input.now,
    })),
  );
}
