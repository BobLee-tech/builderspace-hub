import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { users } from "@kan/db/schema";

import type {
  FormAccess,
  FormDefinition,
  FormSettings,
  FormStatus,
  StoredAnswer,
} from "../forms/form.model";

export type { FormAccess, FormStatus } from "../forms/form.model";
export { formAccessLevels, formStatuses } from "../forms/form.model";

export const formImageKinds = ["asset", "answer"] as const;
export type FormImageKind = (typeof formImageKinds)[number];

/**
 * A form people fill in. The questions and the settings are JSON checked by
 * `form.model.ts` on every write: they are always edited and read as a whole,
 * and keeping them in one row lets a save be refused when someone else saved
 * since (`updatedAt`).
 *
 * `status` is what a manager chose; whether the form takes answers right now
 * also depends on `closesAt` and `maxResponses` (see `formPhase`).
 */
export const hubForms = pgTable(
  "hub_form",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    publicId: varchar("publicId", { length: 12 }).notNull().unique(),
    title: varchar("title", { length: 120 }).notNull(),
    status: varchar("status", { length: 16 })
      .$type<FormStatus>()
      .notNull()
      .default("draft"),
    access: varchar("access", { length: 16 })
      .$type<FormAccess>()
      .notNull()
      .default("members"),
    definition: jsonb("definition").$type<FormDefinition>().notNull(),
    settings: jsonb("settings").$type<FormSettings>().notNull(),
    closesAt: timestamp("closesAt"),
    maxResponses: integer("maxResponses"),
    createdBy: uuid("createdBy").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => [
    check(
      "hub_form_status_check",
      sql`${table.status} IN ('draft', 'open', 'closed')`,
    ),
    check(
      "hub_form_access_check",
      sql`${table.access} IN ('public', 'members', 'projects')`,
    ),
    check(
      "hub_form_max_responses_check",
      sql`${table.maxResponses} IS NULL OR ${table.maxResponses} > 0`,
    ),
  ],
).enableRLS();

/** Someone who may change a form and read its answers, besides the owners. */
export const hubFormManagers = pgTable(
  "hub_form_manager",
  {
    formId: bigint("formId", { mode: "number" })
      .notNull()
      .references(() => hubForms.id, { onDelete: "cascade" }),
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    grantedBy: uuid("grantedBy").references(() => users.id, {
      onDelete: "set null",
    }),
    grantedAt: timestamp("grantedAt").defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.formId, table.userId] })],
).enableRLS();

/**
 * One filled-in form. `userId` is set when the person was signed in; an
 * anonymous answer can only be changed with the edit token handed out when it
 * was sent (only its hash is kept). `submissionKey` is chosen by the browser
 * and makes sending the same answer twice (a retry, a double click) a no-op.
 *
 * `respondentName` is copied in so the answer still says who sent it after the
 * account is renamed or deleted. Every answer carries its question's title for
 * the same reason (see `StoredAnswer`).
 */
export const hubFormResponses = pgTable(
  "hub_form_response",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    publicId: varchar("publicId", { length: 12 }).notNull().unique(),
    formId: bigint("formId", { mode: "number" })
      .notNull()
      .references(() => hubForms.id, { onDelete: "cascade" }),
    userId: uuid("userId").references(() => users.id, {
      onDelete: "set null",
    }),
    respondentName: varchar("respondentName", { length: 255 }),
    answers: jsonb("answers").$type<Record<string, StoredAnswer>>().notNull(),
    submissionKey: uuid("submissionKey").notNull(),
    editTokenHash: varchar("editTokenHash", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => [
    index("hub_form_response_form_idx").on(table.formId, table.createdAt),
    index("hub_form_response_user_idx").on(table.formId, table.userId),
    uniqueIndex("hub_form_response_submission_idx").on(
      table.formId,
      table.submissionKey,
    ),
  ],
).enableRLS();

/** Postgres `bytea` as a Node Buffer. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/**
 * A picture in a form: an `asset` the managers put in (cover, question and
 * option pictures) or an `answer` someone uploaded. Kept in the database,
 * like documents, so there is no bucket to run; the browser shrinks each
 * picture before sending it. An answer picture has no `responseId` until the
 * answer is sent; ones never sent are cleared out after a day.
 */
export const hubFormImages = pgTable(
  "hub_form_image",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    publicId: varchar("publicId", { length: 12 }).notNull().unique(),
    formId: bigint("formId", { mode: "number" })
      .notNull()
      .references(() => hubForms.id, { onDelete: "cascade" }),
    responseId: bigint("responseId", { mode: "number" }).references(
      () => hubFormResponses.id,
      { onDelete: "cascade" },
    ),
    /** For answer pictures: the question it was uploaded for. */
    fieldId: varchar("fieldId", { length: 16 }),
    kind: varchar("kind", { length: 16 }).$type<FormImageKind>().notNull(),
    uploadedBy: uuid("uploadedBy").references(() => users.id, {
      onDelete: "set null",
    }),
    contentType: varchar("contentType", { length: 32 }).notNull(),
    size: integer("size").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    body: bytea("body").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    index("hub_form_image_form_idx").on(table.formId, table.kind),
    index("hub_form_image_response_idx").on(table.responseId),
    check(
      "hub_form_image_kind_check",
      sql`${table.kind} IN ('asset', 'answer')`,
    ),
    check("hub_form_image_size_check", sql`${table.size} > 0`),
  ],
).enableRLS();

/**
 * A 👍 on an answer shown on the results wall. `voterKey` is `u:<user id>` for
 * a signed-in person and `b:<hash>` for a browser on a public form, so one
 * person (or browser) counts once.
 */
export const hubFormLikes = pgTable(
  "hub_form_like",
  {
    responseId: bigint("responseId", { mode: "number" })
      .notNull()
      .references(() => hubFormResponses.id, { onDelete: "cascade" }),
    voterKey: varchar("voterKey", { length: 80 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.responseId, table.voterKey] })],
).enableRLS();
