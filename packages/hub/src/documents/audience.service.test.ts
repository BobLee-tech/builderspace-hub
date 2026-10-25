import { beforeEach, describe, expect, it } from "vitest";

import type { AdminActor } from "../accounts/account.service";
import type { Db } from "../db";
import type { AudienceChoice } from "./audience.service";
import { listAudit } from "../audit";
import {
  createDepartment,
  getDepartmentDirectory,
  setDepartmentMember,
} from "../departments/department.service";
import { setMembershipRole } from "../kan/accounts.gateway";
import { ensureProjectMember } from "../kan/members.gateway";
import { MemoryDocumentStorage } from "../testing/memory-storage";
import {
  createHubTestDb,
  seedHubAccount,
  seedProject,
  seedUser,
} from "../testing/test-db";
import { getAudienceOptions } from "./audience.service";
import { updateDocument } from "./document.service";
import { getDocumentDetail, getLibrary } from "./library.service";
import { createTextDocument, readTextContent } from "./text.service";

let db: Db;
let storage: MemoryDocumentStorage;
let owner: AdminActor;
let admin: AdminActor;
/** In CourseMate, and in its 技术 department. */
let dev: AdminActor;
/** In CourseMate, in no department. */
let plain: AdminActor;
/** In EchoAgent only. */
let echo: AdminActor;
let courseMate: { id: number; publicId: string };
let echoAgent: { id: number; publicId: string };
let techPublicId: string;

const actorOf = (
  user: { id: string; email: string },
  role: AdminActor["role"],
): AdminActor => ({ userId: user.id, email: user.email, role });

const join = (actor: AdminActor, project: { id: number }) =>
  ensureProjectMember(db, {
    workspaceId: project.id,
    userId: actor.userId,
    email: actor.email,
    role: "member",
    addedBy: admin.userId,
  });

beforeEach(async () => {
  db = await createHubTestDb();
  storage = new MemoryDocumentStorage();
  const [o, a, d, p, e] = await Promise.all([
    seedUser(db, { name: "Olivia" }),
    seedUser(db, { name: "Adam" }),
    seedUser(db, { name: "Dev" }),
    seedUser(db, { name: "Pat" }),
    seedUser(db, { name: "Echo" }),
  ]);
  await seedHubAccount(db, o.id, { role: "owner" });
  await seedHubAccount(db, a.id, { role: "admin" });
  owner = actorOf(o, "owner");
  admin = actorOf(a, "admin");
  dev = actorOf(d, null);
  plain = actorOf(p, null);
  echo = actorOf(e, null);

  courseMate = await seedProject(db, a, { name: "CourseMate" });
  echoAgent = await seedProject(db, a, { name: "EchoAgent" });
  await join(dev, courseMate);
  await join(plain, courseMate);
  await join(echo, echoAgent);

  const directory = await getDepartmentDirectory(db, admin);
  const tech = directory.departments.find((d) => d.name === "技术");
  if (!tech) throw new Error("no 技术 department");
  techPublicId = tech.publicId;
  await setDepartmentMember(db, admin, {
    departmentPublicId: techPublicId,
    projectPublicId: courseMate.publicId,
    userId: dev.userId,
    member: true,
  });
});

const make = (audience?: AudienceChoice) =>
  createTextDocument(db, storage, admin, {
    title: "方案",
    filename: "plan.md",
    content: "# 方案",
    audience,
  });

const selected = (
  input: Partial<Extract<AudienceChoice, { kind: "selected" }>>,
): AudienceChoice => ({ kind: "selected", userIds: [], groups: [], ...input });

/** Who of the five can see the document, in the library and when opening it. */
async function whoSees(publicId: string): Promise<string[]> {
  const people = { owner, admin, dev, plain, echo };
  const seeing: string[] = [];
  for (const [name, actor] of Object.entries(people)) {
    const listed = (await getLibrary(db, storage, actor, {})).documents.some(
      (d) => d.publicId === publicId,
    );
    const opened = await readTextContent(db, storage, actor, publicId).then(
      () => true,
      (error: { code?: string }) => {
        expect(error.code).toBe("NOT_FOUND");
        return false;
      },
    );
    expect(opened).toBe(listed);
    if (listed) seeing.push(name);
  }
  return seeing;
}

describe("who can read a document", () => {
  it("is every member by default", async () => {
    const { publicId } = await make();
    expect(await whoSees(publicId)).toEqual([
      "owner",
      "admin",
      "dev",
      "plain",
      "echo",
    ]);
  });

  it("is only the editors when set so (the owner and the writer)", async () => {
    const { publicId } = await make({ kind: "editors" });
    expect(await whoSees(publicId)).toEqual(["owner", "admin"]);
    const library = await getLibrary(db, storage, admin, {});
    expect(library.documents[0]).toMatchObject({
      audience: "editors",
      readable: false,
    });
  });

  it("can be one person picked by name", async () => {
    const { publicId } = await make(selected({ userIds: [echo.userId] }));
    expect(await whoSees(publicId)).toEqual(["owner", "admin", "echo"]);
  });

  it("can be a whole project", async () => {
    const { publicId } = await make(
      selected({
        groups: [
          { projectPublicId: courseMate.publicId, departmentPublicId: null },
        ],
      }),
    );
    expect(await whoSees(publicId)).toEqual(["owner", "admin", "dev", "plain"]);
  });

  it("can be one department of a project", async () => {
    const { publicId } = await make(
      selected({
        groups: [
          {
            projectPublicId: courseMate.publicId,
            departmentPublicId: techPublicId,
          },
        ],
      }),
    );
    expect(await whoSees(publicId)).toEqual(["owner", "admin", "dev"]);
  });

  it("does not reach the same department of another project", async () => {
    const { publicId } = await make(
      selected({
        groups: [
          {
            projectPublicId: echoAgent.publicId,
            departmentPublicId: techPublicId,
          },
        ],
      }),
    );
    expect(await whoSees(publicId)).toEqual(["owner", "admin"]);
  });

  it("mixes people, projects and departments", async () => {
    const { publicId } = await make(
      selected({
        userIds: [plain.userId],
        groups: [
          { projectPublicId: echoAgent.publicId, departmentPublicId: null },
        ],
      }),
    );
    expect(await whoSees(publicId)).toEqual([
      "owner",
      "admin",
      "plain",
      "echo",
    ]);
  });

  it("stops reaching someone who leaves the project", async () => {
    const { publicId } = await make(
      selected({
        groups: [
          {
            projectPublicId: courseMate.publicId,
            departmentPublicId: techPublicId,
          },
        ],
      }),
    );
    await setMembershipRole(db, {
      userId: dev.userId,
      workspaceId: courseMate.id,
      role: null,
      actorUserId: admin.userId,
      now: new Date(),
    });
    expect(await whoSees(publicId)).toEqual(["owner", "admin"]);
  });

  it("follows a department's people as they change", async () => {
    const design = await createDepartment(db, admin, { name: "设计" });
    const { publicId } = await make(
      selected({
        groups: [
          {
            projectPublicId: courseMate.publicId,
            departmentPublicId: design.publicId,
          },
        ],
      }),
    );
    expect(await whoSees(publicId)).toEqual(["owner", "admin"]);
    await setDepartmentMember(db, admin, {
      departmentPublicId: design.publicId,
      projectPublicId: courseMate.publicId,
      userId: plain.userId,
      member: true,
    });
    expect(await whoSees(publicId)).toEqual(["owner", "admin", "plain"]);
  });
});

describe("changing who can read", () => {
  it("switches between everyone, 指定的人 and the editors, and logs each", async () => {
    const { publicId } = await make();
    await updateDocument(db, admin, {
      documentPublicId: publicId,
      audience: selected({
        userIds: [echo.userId],
        groups: [
          {
            projectPublicId: courseMate.publicId,
            departmentPublicId: techPublicId,
          },
        ],
      }),
    });
    expect(await whoSees(publicId)).toEqual(["owner", "admin", "dev", "echo"]);
    const [shared] = await listAudit(db, { limit: 1, offset: 0 });
    expect(shared).toMatchObject({
      action: "document.readable_changed",
      summary: "「方案」设为指定的人可读：CourseMate · 技术、Echo",
    });

    await updateDocument(db, admin, {
      documentPublicId: publicId,
      audience: { kind: "editors" },
    });
    expect(await whoSees(publicId)).toEqual(["owner", "admin"]);

    await updateDocument(db, admin, {
      documentPublicId: publicId,
      audience: { kind: "all" },
    });
    expect(await whoSees(publicId)).toHaveLength(5);
    const detail = await getDocumentDetail(db, storage, admin, publicId);
    expect(detail.readers).toEqual({ users: [], groups: [] });
  });

  it("does not log or touch anything when the list is the same", async () => {
    const audience = selected({ userIds: [echo.userId] });
    const { publicId } = await make(audience);
    const before = await listAudit(db, { limit: 50, offset: 0 });
    await updateDocument(db, admin, {
      documentPublicId: publicId,
      audience: selected({ userIds: [echo.userId, echo.userId] }),
    });
    expect(await listAudit(db, { limit: 50, offset: 0 })).toHaveLength(
      before.length,
    );
  });

  it("keeps the command line's on/off switch working", async () => {
    const { publicId } = await make(selected({ userIds: [echo.userId] }));
    // Off is already off: the 指定的人 stay.
    await updateDocument(db, admin, {
      documentPublicId: publicId,
      readable: false,
    });
    expect(await whoSees(publicId)).toEqual(["owner", "admin", "echo"]);

    await updateDocument(db, admin, {
      documentPublicId: publicId,
      readable: true,
    });
    expect(await whoSees(publicId)).toHaveLength(5);
    await updateDocument(db, admin, {
      documentPublicId: publicId,
      readable: false,
    });
    // The old list was cleared when it opened up: now it is editors only.
    expect(await whoSees(publicId)).toEqual(["owner", "admin"]);
  });

  it("shows the list, named, to the people who can change it only", async () => {
    const { publicId } = await make(
      selected({
        userIds: [echo.userId],
        groups: [
          { projectPublicId: courseMate.publicId, departmentPublicId: null },
          {
            projectPublicId: echoAgent.publicId,
            departmentPublicId: techPublicId,
          },
        ],
      }),
    );
    const forEditor = await getDocumentDetail(db, storage, admin, publicId);
    expect(forEditor.audience).toBe("selected");
    expect(forEditor.readers).toEqual({
      users: [{ userId: echo.userId, name: "Echo" }],
      groups: [
        {
          projectPublicId: courseMate.publicId,
          departmentPublicId: null,
          label: "CourseMate",
        },
        {
          projectPublicId: echoAgent.publicId,
          departmentPublicId: techPublicId,
          label: "EchoAgent · 技术",
        },
      ],
    });
    const forReader = await getDocumentDetail(db, storage, echo, publicId);
    expect(forReader.readers).toBeNull();
  });

  it("drops departments of a project that is chosen whole", async () => {
    const { publicId } = await make(
      selected({
        groups: [
          {
            projectPublicId: courseMate.publicId,
            departmentPublicId: techPublicId,
          },
          { projectPublicId: courseMate.publicId, departmentPublicId: null },
        ],
      }),
    );
    const detail = await getDocumentDetail(db, storage, admin, publicId);
    expect(detail.readers?.groups.map((g) => g.label)).toEqual(["CourseMate"]);
  });

  it("refuses 指定的人 with nobody, or with someone or something unknown", async () => {
    await expect(make(selected({}))).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(
      make(selected({ userIds: ["00000000-0000-4000-8000-000000000000"] })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      make(
        selected({
          groups: [{ projectPublicId: "nope", departmentPublicId: null }],
        }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      make(
        selected({
          groups: [
            { projectPublicId: courseMate.publicId, departmentPublicId: "x" },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await seedHubAccount(db, echo.userId, { status: "suspended" });
    await expect(
      make(selected({ userIds: [echo.userId] })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("is for the people who can edit the document", async () => {
    const { publicId } = await make();
    await expect(
      updateDocument(db, plain, {
        documentPublicId: publicId,
        audience: { kind: "editors" },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("the picker's options", () => {
  it("lists every project with its members and who is in each department", async () => {
    const options = await getAudienceOptions(db, admin);
    expect(options.departments.map((d) => d.name)).toEqual([
      "技术",
      "活动",
      "运营",
    ]);
    const course = options.projects.find(
      (p) => p.publicId === courseMate.publicId,
    );
    expect(course?.members.map((m) => m.name)).toEqual(["Adam", "Dev", "Pat"]);
    expect(
      course?.departments.find((d) => d.publicId === techPublicId)?.memberIds,
    ).toEqual([dev.userId]);
  });

  it("is only for people who can choose who reads something", async () => {
    await expect(getAudienceOptions(db, plain)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
