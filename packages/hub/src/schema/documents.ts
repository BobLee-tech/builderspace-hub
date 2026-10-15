import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  customType,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { users } from "@kan/db/schema";

export const editRequestStatuses = ["pending", "approved", "denied"] as const;
export type EditRequestStatus = (typeof editRequestStatuses)[number];

/**
 * A folder in the document library. Folders nest (the depth is limited by the
 * documents policy) and are removed only when empty, hence `restrict`.
 * Two folders with the same name cannot sit side by side.
 */
export const hubDocumentFolders = pgTable(
  "hub_document_folder",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    publicId: varchar("publicId", { length: 12 }).notNull().unique(),
    name: varchar("name", { length: 80 }).notNull(),
    parentId: bigint("parentId", { mode: "number" }).references(
      (): AnyPgColumn => hubDocumentFolders.id,
      { onDelete: "restrict" },
    ),
    createdBy: uuid("createdBy").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("hub_document_folder_name_idx").on(
      sql`coalesce(${table.parentId}, 0)`,
      sql`lower(${table.name})`,
    ),
  ],
).enableRLS();

/**
 * A stored file with its details. The bytes live in object storage under
 * `storageKey`; the database holds only the metadata and who may do what.
 *
 * `readable` is the per-document read switch. Every document is readable for
 * now; one switched off is shown only to the people who can edit it.
 * `sha256` is set when the server saw the bytes (the import command) and is
 * what makes importing the same file twice a no-op.
 */
export const hubDocuments = pgTable(
  "hub_document",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    publicId: varchar("publicId", { length: 12 }).notNull().unique(),
    folderId: bigint("folderId", { mode: "number" }).references(
      () => hubDocumentFolders.id,
      { onDelete: "restrict" },
    ),
    title: varchar("title", { length: 120 }).notNull(),
    description: varchar("description", { length: 500 }),
    filename: varchar("filename", { length: 200 }).notNull(),
    ext: varchar("ext", { length: 8 }).notNull(),
    contentType: varchar("contentType", { length: 120 }).notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    sha256: varchar("sha256", { length: 64 }),
    storageKey: varchar("storageKey", { length: 200 }).notNull().unique(),
    readable: boolean("readable").notNull().default(true),
    uploadedBy: uuid("uploadedBy").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => [
    index("hub_document_folder_idx").on(table.folderId),
    check("hub_document_size_check", sql`${table.size} > 0`),
  ],
).enableRLS();

/** Someone a document was assigned to: they may change it. */
export const hubDocumentEditors = pgTable(
  "hub_document_editor",
  {
    documentId: bigint("documentId", { mode: "number" })
      .notNull()
      .references(() => hubDocuments.id, { onDelete: "cascade" }),
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    grantedBy: uuid("grantedBy").references(() => users.id, {
      onDelete: "set null",
    }),
    grantedAt: timestamp("grantedAt").defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.documentId, table.userId] })],
).enableRLS();

/**
 * An ordinary member asking for the right to change a document. At most one
 * request per person and document is pending at a time.
 */
export const hubDocumentEditRequests = pgTable(
  "hub_document_edit_request",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    publicId: varchar("publicId", { length: 12 }).notNull().unique(),
    documentId: bigint("documentId", { mode: "number" })
      .notNull()
      .references(() => hubDocuments.id, { onDelete: "cascade" }),
    requesterId: uuid("requesterId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    note: varchar("note", { length: 280 }),
    status: varchar("status", { length: 16 })
      .$type<EditRequestStatus>()
      .notNull()
      .default("pending"),
    decidedBy: uuid("decidedBy").references(() => users.id, {
      onDelete: "set null",
    }),
    decidedAt: timestamp("decidedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    index("hub_document_edit_request_document_idx").on(table.documentId),
    uniqueIndex("hub_document_edit_request_pending_idx")
      .on(table.documentId, table.requesterId)
      .where(sql`${table.status} = 'pending'`),
    check(
      "hub_document_edit_request_status_check",
      sql`${table.status} IN ('pending', 'approved', 'denied')`,
    ),
  ],
).enableRLS();

/**
 * An upload the server handed out a place for. The browser sends the bytes
 * straight to storage, then asks us to register them; only a key listed here,
 * for the same person and not yet used, can become a document. That is what
 * stops anyone from registering someone else's file by guessing its key.
 */
export const hubDocumentUploads = pgTable(
  "hub_document_upload",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    publicId: varchar("publicId", { length: 12 }).notNull().unique(),
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Set when the upload replaces the file of an existing document. */
    documentId: bigint("documentId", { mode: "number" }).references(
      () => hubDocuments.id,
      { onDelete: "cascade" },
    ),
    storageKey: varchar("storageKey", { length: 200 }).notNull().unique(),
    filename: varchar("filename", { length: 200 }).notNull(),
    ext: varchar("ext", { length: 8 }).notNull(),
    contentType: varchar("contentType", { length: 120 }).notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    consumedAt: timestamp("consumedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [index("hub_document_upload_user_idx").on(table.userId)],
).enableRLS();

/** Postgres `bytea` as a Node Buffer. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/**
 * Small files kept in the database itself, for when no object-storage bucket
 * is configured: text documents only, a megabyte at most. Keyed by the same
 * `storageKey` a document row points at, so a document does not care where its
 * bytes live. Once a bucket exists, new files go there and these stay readable.
 */
export const hubDocumentBlobs = pgTable("hub_document_blob", {
  storageKey: varchar("storageKey", { length: 200 }).primaryKey(),
  body: bytea("body").notNull(),
  contentType: varchar("contentType", { length: 120 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}).enableRLS();
