import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { users } from "@kan/db/schema";

/**
 * MCP sign-in: an AI app (Claude Code, Cursor…) signs a person in with OAuth
 * and then calls the Hub's MCP endpoint as them. See `mcp/` and the 「MCP」
 * section of docs/hub/ARCHITECTURE.md.
 *
 * Codes and tokens are bearer secrets, so like registration links only their
 * SHA-256 is stored.
 */

/**
 * An AI app that registered itself (RFC 7591 dynamic client registration).
 * Anyone may register one; it can do nothing until a signed-in person approves
 * it on the consent page. Every client is public: no secret, PKCE instead.
 *
 * `name` is what the app said it is called, so the consent page shows it as
 * such and leads with where the person will be sent back to.
 */
export const hubOauthClients = pgTable("hub_oauth_client", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  clientId: varchar("clientId", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 80 }).notNull(),
  redirectUris: jsonb("redirectUris").$type<string[]>().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}).enableRLS();

/**
 * A one-time authorization code, issued when a person clicks 允许 and traded
 * for tokens moments later. Deleted when it is used.
 */
export const hubOauthCodes = pgTable(
  "hub_oauth_code",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    codeHash: varchar("codeHash", { length: 64 }).notNull().unique(),
    clientId: bigint("clientId", { mode: "number" })
      .notNull()
      .references(() => hubOauthClients.id, { onDelete: "cascade" }),
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    redirectUri: text("redirectUri").notNull(),
    codeChallenge: varchar("codeChallenge", { length: 128 }).notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [index("hub_oauth_code_expires_idx").on(table.expiresAt)],
).enableRLS();

/**
 * One AI app connected to one person's account: a row on the MCP page, and
 * what 断开 deletes. Two kinds:
 *
 * - signed in with OAuth (`clientId` set): holds the current access and
 *   refresh token; a refresh replaces both, so a refresh token works once.
 * - a token the person generated on the MCP page, for apps that cannot do
 *   OAuth (`clientId` null, `name` is their label): one access token that
 *   lives until `accessExpiresAt`, no refresh token.
 */
export const hubMcpConnections = pgTable(
  "hub_mcp_connection",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    publicId: varchar("publicId", { length: 12 }).notNull().unique(),
    clientId: bigint("clientId", { mode: "number" }).references(
      () => hubOauthClients.id,
      { onDelete: "cascade" },
    ),
    name: varchar("name", { length: 80 }),
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessTokenHash: varchar("accessTokenHash", { length: 64 })
      .notNull()
      .unique(),
    accessExpiresAt: timestamp("accessExpiresAt").notNull(),
    refreshTokenHash: varchar("refreshTokenHash", { length: 64 }).unique(),
    refreshExpiresAt: timestamp("refreshExpiresAt"),
    lastUsedAt: timestamp("lastUsedAt").defaultNow().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    index("hub_mcp_connection_user_idx").on(table.userId),
    check(
      "hub_mcp_connection_kind_check",
      sql`(${table.clientId} IS NOT NULL AND ${table.refreshTokenHash} IS NOT NULL AND ${table.refreshExpiresAt} IS NOT NULL) OR (${table.clientId} IS NULL AND ${table.name} IS NOT NULL AND ${table.refreshTokenHash} IS NULL)`,
    ),
  ],
).enableRLS();
