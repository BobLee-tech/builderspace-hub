import { beforeEach, describe, expect, it } from "vitest";

import type { AdminActor } from "../accounts/account.service";
import type { Db } from "../db";
import type { FormDefinitionInput, FormSettingsInput } from "./form.model";
import { listAudit } from "../audit";
import { ensureProjectMember } from "../kan/members.gateway";
import { PNG_1X1 } from "../testing/images";
import {
  createHubTestDb,
  seedHubAccount,
  seedProject,
  seedUser,
} from "../testing/test-db";
import {
  addFormManager,
  createForm,
  deleteForm,
  duplicateForm,
  findManagerCandidates,
  getFormDetail,
  listForms,
  removeFormManager,
  saveForm,
  setFormStatus,
} from "./form.service";
import { uploadFormImage } from "./image.service";
import { submitResponse } from "./response.service";

let db: Db;
let owner: AdminActor;
let admin: AdminActor;
let admin2: AdminActor;
let member: AdminActor;

const actorOf = (
  user: { id: string; email: string },
  role: AdminActor["role"],
): AdminActor => ({ userId: user.id, email: user.email, role });
const viewerOf = (actor: AdminActor) => ({
  userId: actor.userId,
  role: actor.role,
  projectIds: [],
});

const now = new Date("2026-10-22T10:00:00Z");
const later = (ms: number) => new Date(now.getTime() + ms);
const key = () => crypto.randomUUID();

beforeEach(async () => {
  db = await createHubTestDb();
  const [o, a, a2, m] = await Promise.all([
    seedUser(db, { name: "Olivia" }),
    seedUser(db, { name: "Adam" }),
    seedUser(db, { name: "Ada" }),
    seedUser(db, { name: "Mia" }),
  ]);
  await seedHubAccount(db, o.id, { role: "owner" });
  await seedHubAccount(db, a.id, { role: "admin" });
  await seedHubAccount(db, a2.id, { role: "admin" });
  owner = actorOf(o, "owner");
  admin = actorOf(a, "admin");
  admin2 = actorOf(a2, "admin");
  member = actorOf(m, null);
});

const QUESTIONS: FormDefinitionInput = {
  description: "请填写个人网站",
  fields: [
    { id: "name01", type: "short_text", title: "称呼", required: true },
    { id: "site01", type: "short_text", title: "网站", format: "url" },
  ],
};

async function save(
  actor: AdminActor,
  publicId: string,
  changes: {
    title?: string;
    access?: "public" | "members" | "projects";
    definition?: unknown;
    settings?: FormSettingsInput;
    closesAt?: string | null;
    maxResponses?: number | null;
  } = {},
  at: Date = now,
) {
  const detail = await getFormDetail(db, actor, publicId, at);
  return saveForm(
    db,
    actor,
    {
      formPublicId: publicId,
      title: changes.title ?? detail.title,
      access: changes.access ?? detail.access,
      definition: changes.definition ?? detail.definition,
      settings: changes.settings ?? detail.settings,
      closesAt:
        changes.closesAt === undefined
          ? (detail.closesAt?.toISOString() ?? null)
          : changes.closesAt,
      maxResponses:
        changes.maxResponses === undefined
          ? detail.maxResponses
          : changes.maxResponses,
      expectedUpdatedAt: detail.updatedAt.toISOString(),
    },
    at,
  );
}

async function openForm(actor = admin, definition: unknown = QUESTIONS) {
  const { publicId } = await createForm(db, actor, { title: "个人网站" }, now);
  await save(actor, publicId, { definition, access: "public" });
  await setFormStatus(
    db,
    actor,
    { formPublicId: publicId, status: "open" },
    now,
  );
  return publicId;
}

describe("creating", () => {
  it("makes a draft with one starter question, managed by its creator, and logs it", async () => {
    const { publicId } = await createForm(
      db,
      admin,
      { title: "  报名  " },
      now,
    );
    const detail = await getFormDetail(db, admin, publicId, now);
    expect(detail).toMatchObject({
      title: "报名",
      status: "draft",
      access: "members",
      phase: { phase: "draft" },
      responseCount: 0,
      canShare: true,
      managers: [{ userId: admin.userId, name: "Adam" }],
    });
    expect(detail.definition.fields).toHaveLength(1);
    const [entry] = await listAudit(db, { limit: 1, offset: 0 });
    expect(entry).toMatchObject({ action: "form.created", entityId: publicId });
  });

  it("is only for owners and admins, and needs a title", async () => {
    await expect(createForm(db, member, { title: "x" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(createForm(db, admin, { title: "   " })).rejects.toMatchObject(
      {
        code: "INVALID_INPUT",
        message: "标题要填写",
      },
    );
  });
});

describe("who can see a form", () => {
  it("hides it from admins who do not manage it, but not from owners", async () => {
    const { publicId } = await createForm(db, admin, { title: "x" }, now);
    await expect(getFormDetail(db, admin2, publicId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(getFormDetail(db, member, publicId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(getFormDetail(db, owner, publicId)).resolves.toMatchObject({
      canShare: true,
    });
    await expect(getFormDetail(db, admin, "nope")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("saving", () => {
  it("saves questions and settings, reconciling what cannot go together", async () => {
    const { publicId } = await createForm(db, admin, { title: "x" }, now);
    await save(admin, publicId, {
      title: "新标题",
      definition: QUESTIONS,
      settings: {
        limitOne: false,
        allowEdit: true,
        wall: "always",
        likes: "anyone",
      },
      maxResponses: 50,
      closesAt: later(86_400_000).toISOString(),
    });
    const detail = await getFormDetail(db, admin, publicId, now);
    expect(detail).toMatchObject({
      title: "新标题",
      maxResponses: 50,
      settings: {
        limitOne: false,
        allowEdit: false,
        wall: "always",
        likes: "signed_in",
      },
    });
    expect(detail.definition.fields.map((f) => f.id)).toEqual([
      "name01",
      "site01",
    ]);
    const [entry] = await listAudit(db, { limit: 1, offset: 0 });
    expect(entry).toMatchObject({ action: "form.updated" });
  });

  it("refuses a save made on a stale copy", async () => {
    const { publicId } = await createForm(db, admin, { title: "x" }, now);
    const stale = await getFormDetail(db, admin, publicId, now);
    await save(admin, publicId, { title: "first" }, later(1000));
    await expect(
      saveForm(db, admin, {
        formPublicId: publicId,
        title: "second",
        access: stale.access,
        definition: stale.definition,
        settings: stale.settings,
        closesAt: null,
        maxResponses: null,
        expectedUpdatedAt: stale.updatedAt.toISOString(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("refuses broken questions, a past deadline and unknown projects", async () => {
    const { publicId } = await createForm(db, admin, { title: "x" }, now);
    await expect(
      save(admin, publicId, {
        definition: {
          fields: [{ id: "q00001", type: "short_text", title: "" }],
        },
      }),
    ).rejects.toMatchObject({ message: "第 1 题：还没写题目" });
    await expect(
      save(admin, publicId, { closesAt: later(-1000).toISOString() }),
    ).rejects.toMatchObject({ message: "截止时间要晚于现在" });
    await expect(
      save(admin, publicId, {
        access: "projects",
        settings: { projectIds: [] },
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      save(admin, publicId, {
        access: "projects",
        settings: { projectIds: ["gone"] },
      }),
    ).rejects.toMatchObject({ message: "选的项目有的已经不存在了，请重新选" });

    const project = await seedProject(db, {
      id: admin.userId,
      email: admin.email,
    });
    await save(admin, publicId, {
      access: "projects",
      settings: { projectIds: [project.publicId] },
    });
    const detail = await getFormDetail(db, admin, publicId, now);
    expect(detail.settings.projectIds).toEqual([project.publicId]);
    expect(detail.projects.map((p) => p.publicId)).toContain(project.publicId);
  });

  it("keeps a passed deadline that was not changed", async () => {
    const { publicId } = await createForm(db, admin, { title: "x" }, now);
    await save(admin, publicId, { closesAt: later(1000).toISOString() });
    await expect(
      save(admin, publicId, { title: "renamed" }, later(5000)),
    ).resolves.toBeDefined();
  });

  it("only accepts this form's own pictures", async () => {
    const { publicId } = await createForm(db, admin, { title: "x" }, now);
    const other = await createForm(db, admin, { title: "y" }, now);
    const foreign = await uploadFormImage(db, viewerOf(admin), {
      formPublicId: other.publicId,
      purpose: "asset",
      bytes: PNG_1X1,
    });
    await expect(
      save(admin, publicId, {
        definition: { ...QUESTIONS, coverImage: foreign.publicId },
      }),
    ).rejects.toMatchObject({ message: "有图片已经失效了，请重新上传" });

    const own = await uploadFormImage(db, viewerOf(admin), {
      formPublicId: publicId,
      purpose: "asset",
      bytes: PNG_1X1,
    });
    await save(admin, publicId, {
      definition: { ...QUESTIONS, coverImage: own.publicId },
    });
    expect(
      (await getFormDetail(db, admin, publicId)).definition.coverImage,
    ).toBe(own.publicId);
  });

  it("clears out pictures that were uploaded but not kept, after a day", async () => {
    const { publicId } = await createForm(db, admin, { title: "x" }, now);
    const kept = await uploadFormImage(
      db,
      viewerOf(admin),
      {
        formPublicId: publicId,
        purpose: "asset",
        bytes: PNG_1X1,
      },
      now,
    );
    const dropped = await uploadFormImage(
      db,
      viewerOf(admin),
      {
        formPublicId: publicId,
        purpose: "asset",
        bytes: PNG_1X1,
      },
      now,
    );
    await save(
      admin,
      publicId,
      { definition: { ...QUESTIONS, coverImage: kept.publicId } },
      later(1000),
    );
    // Not yet: someone may still be about to save it.
    await expect(
      save(
        admin,
        publicId,
        { definition: { ...QUESTIONS, coverImage: dropped.publicId } },
        later(2000),
      ),
    ).resolves.toBeDefined();
    await save(
      admin,
      publicId,
      { definition: { ...QUESTIONS, coverImage: kept.publicId } },
      later(2 * 86_400_000),
    );
    await expect(
      save(
        admin,
        publicId,
        { definition: { ...QUESTIONS, coverImage: dropped.publicId } },
        later(2 * 86_400_000 + 1),
      ),
    ).rejects.toMatchObject({ message: "有图片已经失效了，请重新上传" });
  });

  it("keeps question types fixed once there are answers, but allows deleting", async () => {
    const publicId = await openForm();
    await submitResponse(
      db,
      viewerOf(member),
      publicId,
      {
        answers: { name01: "Mia" },
        submissionKey: key(),
      },
      now,
    );
    await expect(
      save(admin, publicId, {
        definition: {
          fields: [
            { id: "name01", type: "long_text", title: "称呼" },
            { id: "site01", type: "short_text", title: "网站" },
          ],
        },
      }),
    ).rejects.toThrow("类型不能再改");
    await expect(
      save(admin, publicId, {
        definition: {
          fields: [{ id: "site01", type: "short_text", title: "网站" }],
        },
      }),
    ).resolves.toBeDefined();
    await expect(
      save(admin, publicId, { definition: { fields: [] } }),
    ).rejects.toMatchObject({ message: "已发布的表单至少要有一道题" });
  });
});

describe("opening and closing", () => {
  it("opens a form with questions and logs each change", async () => {
    const { publicId } = await createForm(db, admin, { title: "x" }, now);
    await expect(
      setFormStatus(db, admin, { formPublicId: publicId, status: "open" }, now),
    ).resolves.toEqual({ phase: { phase: "open" } });
    await expect(
      setFormStatus(
        db,
        admin,
        { formPublicId: publicId, status: "closed" },
        now,
      ),
    ).resolves.toEqual({ phase: { phase: "closed", reason: "manual" } });
    const entries = await listAudit(db, { limit: 2, offset: 0 });
    expect(entries.map((e) => e.action)).toEqual([
      "form.closed",
      "form.opened",
    ]);
  });

  it("refuses to open a form without questions, past its deadline, or full", async () => {
    const { publicId } = await createForm(db, admin, { title: "x" }, now);
    await save(admin, publicId, {
      definition: {
        fields: [{ id: "s00001", type: "section", title: "说明" }],
      },
    });
    await expect(
      setFormStatus(db, admin, { formPublicId: publicId, status: "open" }, now),
    ).rejects.toMatchObject({ message: "表单还没有题目，加一道题再发布" });

    await save(admin, publicId, {
      definition: QUESTIONS,
      closesAt: later(1000).toISOString(),
    });
    await expect(
      setFormStatus(
        db,
        admin,
        { formPublicId: publicId, status: "open" },
        later(2000),
      ),
    ).rejects.toMatchObject({
      message: "截止时间已经过了，先改截止时间再发布",
    });

    await save(admin, publicId, {
      closesAt: null,
      maxResponses: 1,
      access: "public",
    });
    await setFormStatus(
      db,
      admin,
      { formPublicId: publicId, status: "open" },
      now,
    );
    await submitResponse(
      db,
      viewerOf(member),
      publicId,
      {
        answers: { name01: "Mia" },
        submissionKey: key(),
      },
      now,
    );
    await setFormStatus(
      db,
      admin,
      { formPublicId: publicId, status: "closed" },
      now,
    );
    await expect(
      setFormStatus(db, admin, { formPublicId: publicId, status: "open" }, now),
    ).rejects.toMatchObject({ message: "已经收满 1 份，先调高名额上限再发布" });
    await expect(
      setFormStatus(
        db,
        admin,
        { formPublicId: publicId, status: "draft" },
        now,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("does nothing, and logs nothing, when the status does not change", async () => {
    const { publicId } = await createForm(db, admin, { title: "x" }, now);
    await setFormStatus(
      db,
      admin,
      { formPublicId: publicId, status: "draft" },
      now,
    );
    const [entry] = await listAudit(db, { limit: 1, offset: 0 });
    expect(entry?.action).toBe("form.created");
  });
});

describe("duplicating", () => {
  it("copies questions, settings and pictures into a fresh draft", async () => {
    const { publicId } = await createForm(
      db,
      admin,
      { title: "x".repeat(120) },
      now,
    );
    const cover = await uploadFormImage(db, viewerOf(admin), {
      formPublicId: publicId,
      purpose: "asset",
      bytes: PNG_1X1,
    });
    const option = await uploadFormImage(db, viewerOf(admin), {
      formPublicId: publicId,
      purpose: "asset",
      bytes: PNG_1X1,
    });
    await save(admin, publicId, {
      access: "public",
      definition: {
        coverImage: cover.publicId,
        fields: [
          {
            id: "pick01",
            type: "single_choice",
            title: "选",
            images: [cover.publicId],
            options: [{ id: "opt001", label: "", image: option.publicId }],
          },
        ],
      },
      settings: { wall: "always", likes: "anyone" },
      closesAt: later(86_400_000).toISOString(),
    });
    await setFormStatus(
      db,
      admin,
      { formPublicId: publicId, status: "open" },
      now,
    );

    const copy = await duplicateForm(db, admin, publicId, now);
    const [entry] = await listAudit(db, { limit: 1, offset: 0 });
    expect(entry).toMatchObject({
      action: "form.duplicated",
      entityId: copy.publicId,
    });
    const detail = await getFormDetail(db, admin, copy.publicId, now);
    expect(detail).toMatchObject({
      status: "draft",
      access: "public",
      closesAt: null,
      responseCount: 0,
      settings: { wall: "always", likes: "anyone" },
    });
    expect(detail.title.endsWith("（副本）")).toBe(true);
    expect(detail.title.length).toBeLessThanOrEqual(120);
    const newCover = detail.definition.coverImage;
    expect(newCover).not.toBe(cover.publicId);
    const field = detail.definition.fields[0];
    expect(field?.images).toEqual([newCover]);
    expect(field?.type === "single_choice" && field.options[0]?.image).not.toBe(
      option.publicId,
    );
    // The copy's pictures are its own: saving it as it is works.
    await expect(save(admin, copy.publicId)).resolves.toBeDefined();
  });

  it("is for people who may create forms and manage the original", async () => {
    const { publicId } = await createForm(db, admin, { title: "x" }, now);
    await addFormManager(db, admin, {
      formPublicId: publicId,
      userId: member.userId,
    });
    await expect(duplicateForm(db, member, publicId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(duplicateForm(db, admin2, publicId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("managers", () => {
  it("lets a form's admin hand it to a member, who can manage but not share or delete", async () => {
    const { publicId } = await createForm(db, admin, { title: "x" }, now);
    const candidates = await findManagerCandidates(db, admin, {
      formPublicId: publicId,
      search: "mi",
    });
    expect(candidates.map((c) => c.name)).toEqual(["Mia"]);
    expect(
      await findManagerCandidates(db, admin, {
        formPublicId: publicId,
        search: "  ",
      }),
    ).toEqual([]);

    await addFormManager(db, admin, {
      formPublicId: publicId,
      userId: member.userId,
    });
    await expect(
      addFormManager(db, admin, {
        formPublicId: publicId,
        userId: member.userId,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(getFormDetail(db, member, publicId)).resolves.toMatchObject({
      canShare: false,
    });
    await expect(
      addFormManager(db, member, {
        formPublicId: publicId,
        userId: admin2.userId,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(deleteForm(db, member, publicId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    await removeFormManager(db, admin, {
      formPublicId: publicId,
      userId: member.userId,
    });
    await expect(getFormDetail(db, member, publicId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      removeFormManager(db, admin, {
        formPublicId: publicId,
        userId: member.userId,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      addFormManager(db, admin, {
        formPublicId: publicId,
        userId: "00000000-0000-4000-8000-000000000000",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const actions = (await listAudit(db, { limit: 2, offset: 0 })).map(
      (e) => e.action,
    );
    expect(actions).toEqual(["form.manager_removed", "form.manager_added"]);
  });
});

describe("deleting", () => {
  it("removes the form and its answers, and logs how many", async () => {
    const publicId = await openForm();
    await submitResponse(
      db,
      viewerOf(member),
      publicId,
      {
        answers: { name01: "Mia" },
        submissionKey: key(),
      },
      now,
    );
    await deleteForm(db, admin, publicId);
    await expect(getFormDetail(db, owner, publicId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const [entry] = await listAudit(db, { limit: 1, offset: 0 });
    expect(entry).toMatchObject({
      action: "form.deleted",
      summary: "删除了表单「个人网站」和它的 1 份回答",
    });
  });
});

describe("listForms", () => {
  it("lists what each person manages and what they may still answer", async () => {
    const project = await seedProject(db, {
      id: admin.userId,
      email: admin.email,
    });
    await ensureProjectMember(db, {
      workspaceId: project.id,
      userId: member.userId,
      email: member.email,
      role: "member",
      addedBy: admin.userId,
    });

    const forMembers = await openForm();
    await save(admin, forMembers, { access: "members" });
    const forProject = await openForm();
    await save(admin, forProject, {
      access: "projects",
      settings: { projectIds: [project.publicId] },
    });
    const otherProject = await seedProject(db, {
      id: admin.userId,
      email: admin.email,
    });
    const notMine = await openForm();
    await save(admin, notMine, {
      access: "projects",
      settings: { projectIds: [otherProject.publicId] },
    });
    const isPublic = await openForm();
    const draft = await createForm(db, admin, { title: "draft" }, now);

    await submitResponse(
      db,
      viewerOf(member),
      forMembers,
      {
        answers: { name01: "Mia" },
        submissionKey: key(),
      },
      now,
    );

    const forMember = await listForms(db, member, now);
    expect(forMember.canCreate).toBe(false);
    expect(forMember.managed).toEqual([]);
    const toFill = new Map(
      forMember.toFill.map((f) => [f.publicId, f.answered]),
    );
    expect(toFill.get(forMembers)).toBe(true);
    expect(toFill.get(forProject)).toBe(false);
    expect(toFill.has(isPublic)).toBe(false);
    expect(toFill.has(notMine)).toBe(false);
    expect(toFill.has(draft.publicId)).toBe(false);

    const forAdmin = await listForms(db, admin, now);
    expect(forAdmin.canCreate).toBe(true);
    expect(forAdmin.managed).toHaveLength(5);
    const counts = new Map(
      forAdmin.managed.map((f) => [f.publicId, f.responseCount]),
    );
    expect(counts.get(forMembers)).toBe(1);
    expect(counts.get(forProject)).toBe(0);
    expect((await listForms(db, admin2, now)).managed).toEqual([]);
    expect((await listForms(db, owner, now)).managed).toHaveLength(5);

    // Full and past-deadline forms are left out by the query itself.
    const full = await openForm();
    await save(admin, full, { access: "members", maxResponses: 1 });
    await submitResponse(
      db,
      viewerOf(admin),
      full,
      { answers: { name01: "Ada" }, submissionKey: key() },
      now,
    );
    const ending = await openForm();
    await save(admin, ending, {
      access: "members",
      closesAt: new Date(now.getTime() + 60_000).toISOString(),
    });
    const later = new Date(now.getTime() + 120_000);
    const stillOpen = new Set(
      (await listForms(db, member, later)).toFill.map((f) => f.publicId),
    );
    expect(stillOpen.has(forMembers)).toBe(true);
    expect(stillOpen.has(full)).toBe(false);
    expect(stillOpen.has(ending)).toBe(false);
  });
});
