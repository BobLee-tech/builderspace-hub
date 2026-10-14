import { beforeEach, describe, expect, it } from "vitest";

import type { Db } from "../db";
import { describeGrantForJoin } from "../access";
import { listAudit } from "../audit";
import {
  createHubTestDb,
  createKanOnlyTestDb,
  seedProject,
  seedUser,
} from "../testing/test-db";
import { runCommand } from "./commands";

const now = new Date("2026-10-13T12:00:00Z");
const env = { baseUrl: "https://hub.example.test/", now };

let db: Db;

beforeEach(async () => {
  db = await createHubTestDb();
});

describe("grant", () => {
  const grant = {
    name: "grant" as const,
    email: "Owner@Example.test",
    hubRole: "owner" as const,
    note: null,
    projects: [],
  };

  it("prints a working registration link", async () => {
    const lines = await runCommand(db, grant, env);

    const link = lines.find((line) => line.startsWith("https://"));
    expect(link).toMatch(
      /^https:\/\/hub\.example\.test\/join#[A-Za-z0-9_-]{43}$/,
    );

    const token = link?.split("#")[1];
    expect(await describeGrantForJoin(db, token, now)).toMatchObject({
      state: "valid",
      email: "owner@example.test",
    });
  });

  it("is logged as done from the command line", async () => {
    await runCommand(db, grant, env);

    const [entry] = await listAudit(db, { limit: 5, offset: 0 });
    expect(entry).toMatchObject({
      action: "grant.issued",
      actorEmail: "cli",
      detail: { hubRole: "owner", source: "cli" },
    });
  });

  it.each([null, "", "hub.example.test", "ftp://hub.example.test"])(
    "refuses to build a link from base URL %j",
    async (baseUrl) => {
      await expect(
        runCommand(db, grant, { baseUrl, now }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      expect(await listAudit(db, { limit: 5, offset: 0 })).toEqual([]);
    },
  );
});

describe("setup-projects", () => {
  it("builds the BuilderSpace projects and says what it did", async () => {
    await seedUser(db, { email: "owner@example.test" });

    const first = await runCommand(
      db,
      { name: "setup-projects", ownerEmail: "owner@example.test" },
      env,
    );
    expect(first[0]).toBe("新建项目 3 个：社群、CourseMate、EchoAgent");
    expect(first[1]).toBe("新建看板 9 块");

    const second = await runCommand(
      db,
      { name: "setup-projects", ownerEmail: "owner@example.test" },
      env,
    );
    expect(second).toEqual([
      "项目和看板都已存在（3 个项目、9 块看板），无需改动。",
    ]);
  });
});

describe("provision", () => {
  it("finishes adding a registered account to its projects", async () => {
    const admin = await seedUser(db);
    const project = await seedProject(db, admin, { name: "社群" });
    await runCommand(
      db,
      {
        name: "grant",
        email: "new@example.test",
        hubRole: null,
        note: null,
        projects: [{ projectPublicId: project.publicId, role: "member" }],
      },
      env,
    );
    // Registered, but the step that adds projects never ran.
    await seedUser(db, { email: "new@example.test" });

    expect(
      await runCommand(
        db,
        { name: "provision", email: "New@Example.test" },
        env,
      ),
    ).toEqual(["已为 new@example.test 补齐 1 个项目。"]);

    expect(
      await runCommand(
        db,
        { name: "provision", email: "new@example.test" },
        env,
      ),
    ).toEqual(["new@example.test 没有待处理的注册许可，无需补齐。"]);
  });

  it("reports an address that has not registered", async () => {
    await expect(
      runCommand(db, { name: "provision", email: "ghost@example.test" }, env),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("projects", () => {
  it("lists each project's id and name", async () => {
    const owner = await seedUser(db);
    const project = await seedProject(db, owner, { name: "社群" });

    expect(await runCommand(db, { name: "projects" }, env)).toEqual([
      `${project.publicId}  社群`,
    ]);
  });

  it("says so when there are none", async () => {
    expect(await runCommand(db, { name: "projects" }, env)).toEqual([
      "还没有任何项目。",
    ]);
  });
});

describe("doctor", () => {
  it("reports an up-to-date database", async () => {
    const lines = await runCommand(db, { name: "doctor" }, env);

    expect(lines[0]).toMatch(/^✓ Hub 迁移已是最新（\d+ \/ \d+）$/);
  });

  it("tells the operator what to run when Hub migrations are missing", async () => {
    const kanOnly = await createKanOnlyTestDb();

    const lines = await runCommand(kanOnly, { name: "doctor" }, env);

    expect(lines[0]).toMatch(/^✗ Hub 迁移还没跑完（0 \/ \d+）/);
    expect(lines.join("\n")).toContain("pnpm --filter @kan/hub migrate");
  });
});

describe("help", () => {
  it("lists the commands", async () => {
    const text = (await runCommand(db, { name: "help" }, env)).join("\n");

    for (const command of [
      "grant",
      "provision",
      "setup-projects",
      "projects",
      "doctor",
    ]) {
      expect(text).toContain(command);
    }
  });
});
