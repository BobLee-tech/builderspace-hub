import { beforeEach, describe, expect, it } from "vitest";

import type { AdminActor } from "../accounts/account.service";
import type { Db } from "../db";
import type { FormDefinitionInput, FormSettingsInput } from "./form.model";
import type { FormViewer } from "./form.policy";
import { listAudit } from "../audit";
import { PNG_1X1 } from "../testing/images";
import { createHubTestDb, seedHubAccount, seedUser } from "../testing/test-db";
import { formViewerFor } from "./form.guard";
import {
  addFormManager,
  createForm,
  getFormDetail,
  saveForm,
  setFormStatus,
} from "./form.service";
import { readFormImage, uploadFormImage } from "./image.service";
import {
  AnswerProblemsError,
  columnsFor,
  deleteFormResponse,
  exportResponses,
  getWall,
  likeResponse,
  listFormResponses,
  openForm,
  submitResponse,
  summarizeResponses,
  updateMyResponse,
} from "./response.service";

let db: Db;
let admin: AdminActor;
let mia: AdminActor;
let leo: AdminActor;
let anonymous: FormViewer;

const actorOf = (
  user: { id: string; email: string },
  role: AdminActor["role"],
): AdminActor => ({ userId: user.id, email: user.email, role });
const viewerOf = (actor: AdminActor): FormViewer => ({
  userId: actor.userId,
  role: actor.role,
  projectIds: [],
});

const now = new Date("2026-10-22T10:00:00Z");
const later = (ms: number) => new Date(now.getTime() + ms);
const key = () => crypto.randomUUID();

beforeEach(async () => {
  db = await createHubTestDb();
  const [a, m, l] = await Promise.all([
    seedUser(db, { name: "Adam" }),
    seedUser(db, { name: "Mia" }),
    seedUser(db, { name: "Leo" }),
  ]);
  await seedHubAccount(db, a.id, { role: "admin" });
  admin = actorOf(a, "admin");
  mia = actorOf(m, null);
  leo = actorOf(l, null);
  anonymous = { userId: null, role: null, projectIds: [] };
});

const QUESTIONS: FormDefinitionInput = {
  fields: [
    { id: "name01", type: "short_text", title: "称呼", required: true },
    {
      id: "phone1",
      type: "short_text",
      title: "电话",
      format: "phone",
      onWall: false,
    },
    {
      id: "role01",
      type: "single_choice",
      title: "角色",
      allowOther: true,
      options: [
        { id: "dev001", label: "开发" },
        { id: "des001", label: "设计" },
      ],
    },
    { id: "shot01", type: "image", title: "截图", maxImages: 2 },
  ],
};

async function makeForm(
  options: {
    access?: "public" | "members" | "projects";
    settings?: FormSettingsInput;
    maxResponses?: number | null;
    closesAt?: Date | null;
    status?: "draft" | "open" | "closed";
  } = {},
) {
  const { publicId } = await createForm(db, admin, { title: "个人网站" }, now);
  const detail = await getFormDetail(db, admin, publicId, now);
  await saveForm(
    db,
    admin,
    {
      formPublicId: publicId,
      title: detail.title,
      access: options.access ?? "public",
      definition: QUESTIONS,
      settings: options.settings ?? {},
      closesAt: options.closesAt?.toISOString() ?? null,
      maxResponses: options.maxResponses ?? null,
      expectedUpdatedAt: detail.updatedAt.toISOString(),
    },
    now,
  );
  if ((options.status ?? "open") !== "draft") {
    await setFormStatus(
      db,
      admin,
      { formPublicId: publicId, status: "open" },
      now,
    );
  }
  if (options.status === "closed") {
    await setFormStatus(
      db,
      admin,
      { formPublicId: publicId, status: "closed" },
      now,
    );
  }
  return publicId;
}

const send = (
  viewer: FormViewer,
  publicId: string,
  answers: Record<string, unknown>,
  submissionKey = key(),
  at = now,
) => submitResponse(db, viewer, publicId, { answers, submissionKey }, {}, at);

describe("openForm", () => {
  it("hides drafts from everyone but managers", async () => {
    const publicId = await makeForm({ status: "draft" });
    await expect(openForm(db, anonymous, publicId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      openForm(db, viewerOf(admin), publicId, {}, now),
    ).resolves.toMatchObject({
      isManager: true,
      phase: { phase: "draft" },
      canSubmit: false,
      canSeeWall: true,
    });
    await expect(openForm(db, anonymous, "nope")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("does not show the questions to someone who may not answer", async () => {
    const publicId = await makeForm({ access: "members" });
    const view = await openForm(db, anonymous, publicId, {}, now);
    expect(view).toMatchObject({
      title: "个人网站",
      blocked: "sign_in",
      form: null,
      canSubmit: false,
      signedInAs: null,
    });
    const forMia = await openForm(db, viewerOf(mia), publicId, {}, now);
    expect(forMia).toMatchObject({
      blocked: null,
      signedInAs: "Mia",
      canSubmit: true,
    });
    expect(forMia.form?.fields).toHaveLength(4);
  });

  it("says how many places are left and when the form is closed", async () => {
    const publicId = await makeForm({ maxResponses: 1 });
    expect((await openForm(db, anonymous, publicId, {}, now)).remaining).toBe(
      1,
    );
    await send(anonymous, publicId, { name01: "A" });
    const view = await openForm(db, anonymous, publicId, {}, now);
    expect(view).toMatchObject({
      remaining: 0,
      phase: { phase: "closed", reason: "full" },
      canSubmit: false,
    });
  });
});

describe("submitResponse", () => {
  it("keeps a signed-in answer under the account, with titles and labels", async () => {
    const publicId = await makeForm();
    const result = await send(viewerOf(mia), publicId, {
      name01: "Mia",
      role01: { selected: [], other: "产品" },
    });
    expect(result.editToken).toBeNull();
    const view = await openForm(db, viewerOf(mia), publicId, {}, now);
    expect(view.mine).toMatchObject({
      publicId: result.responsePublicId,
      answers: { name01: "Mia", role01: { selected: [], other: "产品" } },
    });
    expect(view).toMatchObject({ canSubmit: false, canEdit: false });
  });

  it("gives an anonymous answer a token that finds it again", async () => {
    const publicId = await makeForm({ settings: { allowEdit: true } });
    const result = await send(anonymous, publicId, { name01: "Anon" });
    expect(result.editToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const view = await openForm(
      db,
      anonymous,
      publicId,
      { editToken: result.editToken },
      now,
    );
    expect(view).toMatchObject({
      mine: { publicId: result.responsePublicId },
      canEdit: true,
    });
    const stranger = await openForm(
      db,
      anonymous,
      publicId,
      { editToken: "x".repeat(43) },
      now,
    );
    expect(stranger.mine).toBeNull();
  });

  it("answers a repeated attempt like the first, without a second answer", async () => {
    const publicId = await makeForm({ settings: { limitOne: false } });
    const attempt = key();
    const first = await send(anonymous, publicId, { name01: "A" }, attempt);
    const again = await send(anonymous, publicId, { name01: "A" }, attempt);
    expect(again.responsePublicId).toBe(first.responsePublicId);
    // The first token may have been lost; the new one works instead.
    const view = await openForm(
      db,
      anonymous,
      publicId,
      { editToken: again.editToken },
      now,
    );
    expect(view.mine?.publicId).toBe(first.responsePublicId);
    const list = await listFormResponses(db, admin, { formPublicId: publicId });
    expect(list.total).toBe(1);

    await expect(
      send(viewerOf(mia), publicId, { name01: "M" }, attempt),
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("takes one answer per signed-in person, and says whether it can be changed", async () => {
    const publicId = await makeForm();
    await send(viewerOf(mia), publicId, { name01: "Mia" });
    await expect(
      send(viewerOf(mia), publicId, { name01: "Mia" }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "你已经提交过了，每人只能提交一次",
    });
    const editable = await makeForm({ settings: { allowEdit: true } });
    await send(viewerOf(mia), editable, { name01: "Mia" });
    await expect(
      send(viewerOf(mia), editable, { name01: "Mia" }),
    ).rejects.toMatchObject({
      message: "你已经提交过了，可以在页面上修改之前的回答",
    });
    const many = await makeForm({ settings: { limitOne: false } });
    await send(viewerOf(mia), many, { name01: "1" });
    await expect(
      send(viewerOf(mia), many, { name01: "2" }),
    ).resolves.toBeDefined();
  });

  it("answers a repeated attempt like the first even after the form changed", async () => {
    const publicId = await makeForm();
    const attempt = key();
    const first = await send(anonymous, publicId, { name01: "A" }, attempt);
    // Members only now: a new anonymous answer would be refused.
    const detail = await getFormDetail(db, admin, publicId, now);
    await saveForm(
      db,
      admin,
      {
        formPublicId: publicId,
        title: detail.title,
        access: "members",
        definition: detail.definition,
        settings: detail.settings,
        closesAt: null,
        maxResponses: null,
        expectedUpdatedAt: detail.updatedAt.toISOString(),
      },
      now,
    );
    const again = await send(anonymous, publicId, { name01: "A" }, attempt);
    expect(again.responsePublicId).toBe(first.responsePublicId);
    expect(again.editToken).not.toBeNull();
    await expect(
      send(anonymous, publicId, { name01: "B" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("takes one answer per browser on a public form, known by its token", async () => {
    const publicId = await makeForm();
    const first = await send(anonymous, publicId, { name01: "A" });
    // A second tab of the same browser sends the token the first one kept.
    await expect(
      submitResponse(
        db,
        anonymous,
        publicId,
        { answers: { name01: "B" }, submissionKey: key() },
        { editToken: first.editToken },
        now,
      ),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "你已经提交过了，每人只能提交一次",
    });
    // Another browser has no token and may answer.
    await expect(
      send(anonymous, publicId, { name01: "C" }),
    ).resolves.toBeDefined();
  });

  it("refuses answers to closed, full, past-deadline and draft forms", async () => {
    const closed = await makeForm({ status: "closed" });
    await expect(
      send(anonymous, closed, { name01: "A" }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "这份表单已经停止收集",
    });
    const deadline = await makeForm({ closesAt: later(1000) });
    await expect(
      send(anonymous, deadline, { name01: "A" }, key(), later(2000)),
    ).rejects.toMatchObject({
      message: "这份表单已经截止",
    });
    const draft = await makeForm({ status: "draft" });
    await expect(
      send(viewerOf(admin), draft, { name01: "A" }),
    ).rejects.toMatchObject({
      message: "表单还没有发布，发布后才能提交",
    });
  });

  it("never lets two people take the last place", async () => {
    const publicId = await makeForm({ maxResponses: 1 });
    const results = await Promise.allSettled([
      send(viewerOf(mia), publicId, { name01: "Mia" }),
      send(viewerOf(leo), publicId, { name01: "Leo" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toMatchObject({
      message: "名额已满，这份表单不再收集",
    });
  });

  it("reports every unanswered or wrong question", async () => {
    const publicId = await makeForm();
    const error = await send(anonymous, publicId, { phone1: "abc" }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AnswerProblemsError);
    expect((error as AnswerProblemsError).fieldErrors).toEqual({
      name01: "这道题必须回答",
      phone1: "电话号码格式不对",
    });
  });

  it("refuses people who may not answer", async () => {
    const publicId = await makeForm({ access: "members" });
    await expect(
      send(anonymous, publicId, { name01: "A" }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "这份表单只对 BuilderSpace Hub 的成员开放，请先登录",
    });
    const viewer = await formViewerFor(db, { id: mia.userId });
    const forProject = await makeForm({ access: "members" });
    await expect(
      send(viewer, forProject, { name01: "Mia" }),
    ).resolves.toBeDefined();
  });
});

describe("answer pictures", () => {
  const upload = (viewer: FormViewer, publicId: string, fieldId = "shot01") =>
    uploadFormImage(
      db,
      viewer,
      {
        formPublicId: publicId,
        purpose: "answer",
        fieldId,
        bytes: PNG_1X1,
      },
      now,
    );

  it("attaches one's own uploads, and only to the question they were for", async () => {
    const publicId = await makeForm();
    const mine = await upload(viewerOf(mia), publicId);
    const theirs = await upload(viewerOf(leo), publicId);
    await expect(
      send(viewerOf(mia), publicId, {
        name01: "Mia",
        shot01: [theirs.publicId],
      }),
    ).rejects.toBeInstanceOf(AnswerProblemsError);
    await send(viewerOf(mia), publicId, {
      name01: "Mia",
      shot01: [mine.publicId],
    });
    // Already part of Mia's answer: Leo cannot reuse it.
    await expect(
      send(viewerOf(leo), publicId, { name01: "Leo", shot01: [mine.publicId] }),
    ).rejects.toBeInstanceOf(AnswerProblemsError);
  });

  it("answers a repeated attempt with pictures like the first", async () => {
    const publicId = await makeForm();
    const shot = await upload(anonymous, publicId);
    const attempt = key();
    const answers = { name01: "A", shot01: [shot.publicId] };
    const first = await send(anonymous, publicId, answers, attempt);
    // The first reply was lost: the pictures are now part of that answer.
    const again = await send(anonymous, publicId, answers, attempt);
    expect(again.responsePublicId).toBe(first.responsePublicId);
    const view = await openForm(
      db,
      anonymous,
      publicId,
      { editToken: again.editToken },
      now,
    );
    expect(view.mine?.publicId).toBe(first.responsePublicId);
  });

  it("lets the sender, the managers and wall viewers see them, and nobody else", async () => {
    const publicId = await makeForm({ settings: { wall: "after_submit" } });
    const image = await upload(anonymous, publicId);
    const sent = await send(anonymous, publicId, {
      name01: "A",
      shot01: [image.publicId],
    });

    await expect(
      readFormImage(db, anonymous, image.publicId, {
        editToken: sent.editToken,
      }),
    ).resolves.toMatchObject({ contentType: "image/png", cacheable: false });
    await expect(
      readFormImage(db, viewerOf(admin), image.publicId),
    ).resolves.toBeDefined();
    await expect(
      readFormImage(db, viewerOf(mia), image.publicId),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await send(viewerOf(mia), publicId, { name01: "Mia" });
    await expect(
      readFormImage(db, viewerOf(mia), image.publicId),
    ).resolves.toBeDefined();
  });
});

describe("updateMyResponse", () => {
  it("changes one's answer and drops pictures no longer used", async () => {
    const publicId = await makeForm({ settings: { allowEdit: true } });
    const first = await uploadFormImage(db, viewerOf(mia), {
      formPublicId: publicId,
      purpose: "answer",
      fieldId: "shot01",
      bytes: PNG_1X1,
    });
    await send(viewerOf(mia), publicId, {
      name01: "Mia",
      shot01: [first.publicId],
    });
    const second = await uploadFormImage(db, viewerOf(mia), {
      formPublicId: publicId,
      purpose: "answer",
      fieldId: "shot01",
      bytes: PNG_1X1,
    });
    await updateMyResponse(
      db,
      viewerOf(mia),
      publicId,
      {
        answers: { name01: "Mia 2", shot01: [second.publicId] },
      },
      {},
      now,
    );
    const view = await openForm(db, viewerOf(mia), publicId, {}, now);
    expect(view.mine?.answers).toEqual({
      name01: "Mia 2",
      shot01: [second.publicId],
    });
    await expect(
      readFormImage(db, viewerOf(admin), first.publicId),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("works for an anonymous answer with its token, even once the form is full", async () => {
    const publicId = await makeForm({
      settings: { allowEdit: true },
      maxResponses: 1,
    });
    const sent = await send(anonymous, publicId, { name01: "A" });
    await updateMyResponse(
      db,
      anonymous,
      publicId,
      { answers: { name01: "B" } },
      {
        editToken: sent.editToken,
      },
      now,
    );
    const view = await openForm(
      db,
      anonymous,
      publicId,
      { editToken: sent.editToken },
      now,
    );
    expect(view.mine?.answers).toEqual({ name01: "B" });
  });

  it("is refused without an answer, when not allowed, or when closed", async () => {
    const locked = await makeForm();
    await send(viewerOf(mia), locked, { name01: "Mia" });
    await expect(
      updateMyResponse(db, viewerOf(mia), locked, { answers: { name01: "x" } }),
    ).rejects.toMatchObject({ message: "这份表单提交后不能修改" });
    await expect(
      updateMyResponse(db, viewerOf(leo), locked, { answers: { name01: "x" } }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const editable = await makeForm({
      settings: { allowEdit: true },
      closesAt: later(1000),
    });
    await send(viewerOf(mia), editable, { name01: "Mia" });
    await expect(
      updateMyResponse(
        db,
        viewerOf(mia),
        editable,
        { answers: { name01: "x" } },
        {},
        later(2000),
      ),
    ).rejects.toMatchObject({ message: "这份表单已经截止" });
    await expect(
      updateMyResponse(db, viewerOf(mia), editable, { answers: {} }, {}, now),
    ).rejects.toBeInstanceOf(AnswerProblemsError);
  });
});

describe("the results wall", () => {
  it("is shown according to the wall setting", async () => {
    const off = await makeForm();
    await expect(getWall(db, viewerOf(mia), off, {})).rejects.toMatchObject({
      message: "这份表单没有公开大家的回答",
    });
    await expect(
      getWall(db, viewerOf(admin), off, {}, {}, now),
    ).resolves.toBeDefined();

    const after = await makeForm({ settings: { wall: "after_submit" } });
    await expect(getWall(db, viewerOf(mia), after, {})).rejects.toMatchObject({
      message: "提交之后才能看到大家的回答",
    });
    await send(viewerOf(mia), after, { name01: "Mia" });
    await expect(getWall(db, viewerOf(mia), after, {})).resolves.toMatchObject({
      total: 1,
    });

    const members = await makeForm({
      access: "members",
      settings: { wall: "always" },
    });
    await expect(getWall(db, anonymous, members, {})).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("shows only the questions meant for the wall, and names only when asked", async () => {
    const publicId = await makeForm({
      settings: { wall: "always", wallShowNames: true },
    });
    await send(viewerOf(mia), publicId, {
      name01: "Mia",
      phone1: "13800000000",
    });
    await send(anonymous, publicId, { name01: "Anon" });
    const wall = await getWall(db, viewerOf(leo), publicId, {}, {}, now);
    expect(wall.entries.map((e) => e.name)).toEqual([null, "Mia"]);
    const miaEntry = wall.entries[1];
    expect(miaEntry?.answers.map((a) => a.fieldId)).toEqual(["name01"]);
    expect(JSON.stringify(wall)).not.toContain("13800000000");

    const hidden = await makeForm({
      settings: { wall: "always", wallShowNames: false },
    });
    await send(viewerOf(mia), hidden, { name01: "Mia" });
    expect(
      (await getWall(db, viewerOf(leo), hidden, {})).entries[0]?.name,
    ).toBeNull();
  });

  it("counts one like per person, sorts by likes, and refuses liking oneself", async () => {
    const publicId = await makeForm({
      settings: { wall: "always", likes: "anyone" },
    });
    const miaAnswer = await send(viewerOf(mia), publicId, { name01: "Mia" });
    const leoAnswer = await send(viewerOf(leo), publicId, { name01: "Leo" });

    const like = (
      viewer: FormViewer,
      id: string,
      value = true,
      browserKey?: string,
    ) =>
      likeResponse(
        db,
        viewer,
        publicId,
        { responsePublicId: id, like: value },
        { browserKey },
        now,
      );

    await expect(
      like(viewerOf(leo), miaAnswer.responsePublicId),
    ).resolves.toEqual({
      liked: true,
      likes: 1,
    });
    await expect(
      like(viewerOf(leo), miaAnswer.responsePublicId),
    ).resolves.toEqual({
      liked: true,
      likes: 1,
    });
    const browser = "b".repeat(32);
    await expect(
      like(anonymous, miaAnswer.responsePublicId, true, browser),
    ).resolves.toEqual({
      liked: true,
      likes: 2,
    });
    await expect(
      like(anonymous, miaAnswer.responsePublicId),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      like(viewerOf(mia), miaAnswer.responsePublicId),
    ).rejects.toMatchObject({
      message: "不能给自己点赞",
    });
    await expect(like(viewerOf(mia), "nope")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    const byLikes = await getWall(
      db,
      viewerOf(leo),
      publicId,
      { sort: "likes" },
      {},
      now,
    );
    expect(
      byLikes.entries.map((e) => [e.publicId, e.likes, e.liked, e.mine]),
    ).toEqual([
      [miaAnswer.responsePublicId, 2, true, false],
      [leoAnswer.responsePublicId, 0, false, true],
    ]);
    expect(byLikes.canLike).toBe(true);

    await expect(
      like(viewerOf(leo), miaAnswer.responsePublicId, false),
    ).resolves.toEqual({
      liked: false,
      likes: 1,
    });
  });

  it("refuses likes when they are off or need signing in", async () => {
    const off = await makeForm({ settings: { wall: "always" } });
    const answer = await send(viewerOf(mia), off, { name01: "Mia" });
    await expect(
      likeResponse(db, viewerOf(leo), off, {
        responsePublicId: answer.responsePublicId,
        like: true,
      }),
    ).rejects.toMatchObject({ message: "这份表单没有开点赞" });

    const signedIn = await makeForm({
      settings: { wall: "always", likes: "signed_in" },
    });
    const other = await send(viewerOf(mia), signedIn, { name01: "Mia" });
    await expect(
      likeResponse(
        db,
        anonymous,
        signedIn,
        { responsePublicId: other.responsePublicId, like: true },
        {
          browserKey: "c".repeat(32),
        },
      ),
    ).rejects.toMatchObject({ message: "登录后才能点赞" });
    expect((await getWall(db, anonymous, signedIn, {})).canLike).toBe(false);
  });
});

describe("answers for managers", () => {
  it("lists, exports and summarises answers, keeping deleted questions", async () => {
    const publicId = await makeForm({ settings: { limitOne: false } });
    await send(viewerOf(mia), publicId, {
      name01: "Mia",
      phone1: "13800000000",
      role01: { selected: ["dev001"] },
    });
    await send(anonymous, publicId, {
      name01: "Anon",
      role01: { selected: [], other: "PM" },
    });
    await send(viewerOf(mia), publicId, {
      name01: "Mia again",
      role01: { selected: ["dev001"] },
    });

    const page = await listFormResponses(db, admin, { formPublicId: publicId });
    expect(page.total).toBe(3);
    expect(page.items[2]).toMatchObject({
      respondent: "Mia",
      respondentEmail: mia.email,
      signedIn: true,
    });
    expect(page.items[1]).toMatchObject({ respondent: null, signedIn: false });

    // Delete the phone question and the 设计 option; old answers keep them.
    const detail = await getFormDetail(db, admin, publicId, now);
    await saveForm(
      db,
      admin,
      {
        formPublicId: publicId,
        title: detail.title,
        access: detail.access,
        definition: {
          fields: [
            { id: "name01", type: "short_text", title: "称呼", required: true },
            {
              id: "role01",
              type: "single_choice",
              title: "角色",
              options: [{ id: "des001", label: "设计" }],
            },
          ],
        },
        settings: detail.settings,
        closesAt: null,
        maxResponses: null,
        expectedUpdatedAt: detail.updatedAt.toISOString(),
      },
      now,
    );

    const exported = await exportResponses(db, admin, publicId);
    expect(exported.columns.map((c) => [c.title, c.removed])).toEqual([
      ["称呼", false],
      ["角色", false],
      ["电话", true],
    ]);
    expect(exported.truncated).toBe(false);

    const summary = await summarizeResponses(db, admin, publicId);
    expect(summary.total).toBe(3);
    const role = summary.questions.find((q) => q.fieldId === "role01");
    expect(role?.options).toEqual([
      { id: "des001", label: "设计", count: 0, removed: false },
      { id: "dev001", label: "开发", count: 2, removed: true },
    ]);
    expect(role?.other).toEqual({ count: 1, latest: ["PM"] });
    const name = summary.questions.find((q) => q.fieldId === "name01");
    expect(name).toMatchObject({
      answered: 3,
      latest: ["Mia again", "Anon", "Mia"],
    });

    await expect(
      listFormResponses(db, mia, { formPublicId: publicId }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("counts pictures and lets managers delete an answer, logged", async () => {
    const publicId = await makeForm();
    await addFormManager(db, admin, {
      formPublicId: publicId,
      userId: leo.userId,
    });
    const image = await uploadFormImage(db, viewerOf(mia), {
      formPublicId: publicId,
      purpose: "answer",
      fieldId: "shot01",
      bytes: PNG_1X1,
    });
    const sent = await send(viewerOf(mia), publicId, {
      name01: "Mia",
      shot01: [image.publicId],
    });
    const summary = await summarizeResponses(db, leo, publicId);
    expect(summary.questions.find((q) => q.fieldId === "shot01")?.images).toBe(
      1,
    );

    await deleteFormResponse(db, leo, {
      formPublicId: publicId,
      responsePublicId: sent.responsePublicId,
    });
    expect(
      (await listFormResponses(db, admin, { formPublicId: publicId })).total,
    ).toBe(0);
    await expect(
      readFormImage(db, viewerOf(admin), image.publicId),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const [entry] = await listAudit(db, { limit: 1, offset: 0 });
    expect(entry).toMatchObject({
      action: "form_response.deleted",
      summary: "删除了表单「个人网站」的一份回答（Mia）",
    });
    await expect(
      deleteFormResponse(db, leo, {
        formPublicId: publicId,
        responsePublicId: "nope",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("sends nothing to the audit log when people answer", async () => {
    const publicId = await makeForm();
    const before = (await listAudit(db, { limit: 100, offset: 0 })).length;
    await send(viewerOf(mia), publicId, { name01: "Mia" });
    expect((await listAudit(db, { limit: 100, offset: 0 })).length).toBe(
      before,
    );
  });
});

describe("columnsFor", () => {
  it("maps question types to column types", async () => {
    const publicId = await makeForm();
    const detail = await getFormDetail(db, admin, publicId);
    expect(columnsFor(detail.definition, []).map((c) => c.type)).toEqual([
      "text",
      "text",
      "choice",
      "images",
    ]);
  });
});
