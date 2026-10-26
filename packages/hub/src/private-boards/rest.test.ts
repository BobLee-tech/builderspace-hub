import { beforeEach, describe, expect, it } from "vitest";

import * as kanSchema from "@kan/db/schema";

import type { AdminActor } from "../accounts/account.service";
import type { Db } from "../db";
import type { RestRequest } from "../shared/rest";
import { ensureProjectMember } from "../kan/members.gateway";
import { createHubTestDb, seedProject, seedUser } from "../testing/test-db";
import { handleBoardsRest } from "./rest";

let db: Db;
let admin: AdminActor;
let member: AdminActor;
let board: string;

beforeEach(async () => {
  db = await createHubTestDb();
  const [a, m] = await Promise.all([
    seedUser(db, { email: "admin@example.test" }),
    seedUser(db, { email: "member@example.test" }),
  ]);
  admin = { userId: a.id, email: a.email, role: null };
  member = { userId: m.id, email: m.email, role: null };
  const project = await seedProject(db, a, { name: "BuilderSpace" });
  await ensureProjectMember(db, {
    userId: m.id,
    email: m.email,
    workspaceId: project.id,
    role: "member",
    addedBy: a.id,
  });
  board = "brd000000001";
  await db.insert(kanSchema.boards).values({
    publicId: board,
    name: "核心",
    slug: board,
    workspaceId: project.id,
    createdBy: a.id,
    visibility: "public",
  });
});

const call = (
  actor: AdminActor,
  method: string,
  path: string,
  body?: unknown,
) =>
  handleBoardsRest(db, actor, {
    method,
    segments: path.split("/").filter(Boolean),
    query: {},
    body,
  } satisfies RestRequest);

describe("who can see a board", () => {
  it("lets a project admin make it 仅管理员可见, hiding it from members", async () => {
    expect((await call(admin, "GET", `/${board}/audience`)).body).toMatchObject(
      { audience: null, canSwitchTo: { admins: true, owner: true } },
    );

    const hidden = await call(admin, "PUT", `/${board}/audience`, {
      audience: "admins",
    });
    expect(hidden).toMatchObject({
      status: 200,
      body: { audience: "admins", canSwitchTo: { members: true } },
    });
    // A member gets the same answer as for a board that does not exist.
    await expect(
      call(member, "GET", `/${board}/audience`),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const back = await call(admin, "PUT", `/${board}/audience`, {
      audience: null,
    });
    expect(back.body).toMatchObject({ audience: null });
    expect(
      (await call(member, "GET", `/${board}/audience`)).body,
    ).toMatchObject({ audience: null });
  });

  it("follows the board page's rules: a member cannot hide a board from the project", async () => {
    await expect(
      call(member, "PUT", `/${board}/audience`, { audience: "admins" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses an audience it does not know", async () => {
    await expect(
      call(admin, "PUT", `/${board}/audience`, { audience: "everyone" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      call(admin, "PUT", `/${board}/audience`, {}),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("answers anything else with 404, and a wrong method with 405", async () => {
    expect((await call(admin, "GET", `/${board}`)).status).toBe(404);
    expect((await call(admin, "GET", `/${board}/cards`)).status).toBe(404);
    expect((await call(admin, "GET", "/")).status).toBe(404);
    expect((await call(admin, "DELETE", `/${board}/audience`)).status).toBe(
      405,
    );
  });
});
