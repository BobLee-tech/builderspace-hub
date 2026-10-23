import { beforeEach, describe, expect, it } from "vitest";

import type { AdminActor } from "../accounts/account.service";
import type { Db } from "../db";
import type { FormViewer } from "./form.policy";
import type { FormsRestRequest } from "./rest";
import { PNG_1X1 } from "../testing/images";
import { createHubTestDb, seedHubAccount, seedUser } from "../testing/test-db";
import {
  createForm,
  getFormDetail,
  saveForm,
  setFormStatus,
} from "./form.service";
import { handleFormsRest } from "./rest";

let db: Db;
let admin: AdminActor;
let formId: string;
const anonymous: FormViewer = { userId: null, role: null, projectIds: [] };
const now = new Date("2026-10-22T10:00:00Z");

beforeEach(async () => {
  db = await createHubTestDb();
  const a = await seedUser(db, { name: "Adam" });
  await seedHubAccount(db, a.id, { role: "admin" });
  admin = { userId: a.id, email: a.email, role: "admin" };
  const { publicId } = await createForm(db, admin, { title: "墙" }, now);
  const detail = await getFormDetail(db, admin, publicId, now);
  await saveForm(
    db,
    admin,
    {
      formPublicId: publicId,
      title: detail.title,
      access: "public",
      definition: {
        fields: [
          { id: "name01", type: "short_text", title: "称呼", required: true },
          { id: "shot01", type: "image", title: "截图" },
        ],
      },
      settings: { wall: "always", likes: "anyone", allowEdit: true },
      closesAt: null,
      maxResponses: null,
      expectedUpdatedAt: detail.updatedAt.toISOString(),
    },
    now,
  );
  await setFormStatus(
    db,
    admin,
    { formPublicId: publicId, status: "open" },
    now,
  );
  formId = publicId;
});

const call = (
  request: Partial<FormsRestRequest>,
  viewer: FormViewer = anonymous,
) =>
  handleFormsRest(
    db,
    viewer,
    {
      method: "GET",
      segments: [],
      query: {},
      body: null,
      secrets: {},
      ...request,
    },
    now,
  );

describe("handleFormsRest", () => {
  it("opens, answers, changes, shows the wall and likes", async () => {
    const opened = await call({ segments: [formId] });
    expect(opened).toMatchObject({
      status: 200,
      body: { title: "墙", canSubmit: true },
    });

    const sent = await call({
      method: "POST",
      segments: [formId, "responses"],
      body: { answers: { name01: "A" }, submissionKey: crypto.randomUUID() },
    });
    expect(sent.status).toBe(201);
    const { responsePublicId, editToken } = (
      sent as { body: { responsePublicId: string; editToken: string } }
    ).body;

    const changed = await call({
      method: "PUT",
      segments: [formId, "responses", "mine"],
      body: { answers: { name01: "B" } },
      secrets: { editToken },
    });
    expect(changed).toMatchObject({ status: 200, body: { responsePublicId } });

    const wall = await call({
      segments: [formId, "wall"],
      query: { page: "x", sort: "likes" },
    });
    expect(wall).toMatchObject({ status: 200, body: { total: 1 } });

    const liked = await call({
      method: "PUT",
      segments: [formId, "responses", responsePublicId, "like"],
      body: { like: true },
      secrets: { browserKey: "k".repeat(30) },
    });
    expect(liked).toMatchObject({
      status: 200,
      body: { liked: true, likes: 1 },
    });
  });

  it("uploads a picture and serves it back", async () => {
    const uploaded = await call(
      {
        method: "POST",
        segments: [formId, "images"],
        query: { purpose: "answer", field: "shot01" },
        bytes: PNG_1X1,
      },
      { userId: admin.userId, role: "admin", projectIds: [] },
    );
    expect(uploaded.status).toBe(201);
    const { publicId } = (uploaded as { body: { publicId: string } }).body;
    const file = await call(
      { segments: ["images", publicId] },
      {
        userId: admin.userId,
        role: "admin",
        projectIds: [],
      },
    );
    expect(file).toMatchObject({
      status: 200,
      file: { contentType: "image/png" },
    });
  });

  it("returns every problem with the answers, by question", async () => {
    const sent = await call({
      method: "POST",
      segments: [formId, "responses"],
      body: { answers: {}, submissionKey: crypto.randomUUID() },
    });
    expect(sent).toEqual({
      status: 400,
      body: {
        message: "有些题还没填好，请看标红的地方",
        fieldErrors: { name01: "这道题必须回答" },
      },
    });
  });

  it("maps refusals to statuses and rejects unknown routes and methods", async () => {
    expect(await call({ segments: ["missing"] })).toMatchObject({
      status: 404,
    });
    expect(await call({ segments: [] })).toMatchObject({ status: 404 });
    expect(await call({ segments: ["BAD!"] })).toMatchObject({ status: 404 });
    expect(await call({ segments: [formId, "nope"] })).toMatchObject({
      status: 404,
    });
    expect(
      await call({ segments: [formId, "responses", "a", "b", "c"] }),
    ).toMatchObject({ status: 404 });
    expect(await call({ segments: ["images"] })).toMatchObject({ status: 404 });
    for (const segments of [
      [formId],
      [formId, "responses"],
      [formId, "responses", "mine"],
      [formId, "responses", "abc", "like"],
      [formId, "wall"],
      [formId, "images"],
      ["images", "abcdefghijkl"],
    ]) {
      const method =
        segments.length === 2 && segments[1] === "wall" ? "POST" : "DELETE";
      expect(await call({ method, segments })).toMatchObject({ status: 405 });
    }
    expect(
      await call({
        method: "PUT",
        segments: [formId, "responses", "mine"],
        body: { answers: {} },
      }),
    ).toMatchObject({ status: 404, body: { message: "找不到你之前的回答" } });
  });

  it("lets bugs through instead of hiding them", async () => {
    const broken = {
      transaction: () => Promise.reject(new Error("boom")),
    } as unknown as Db;
    await expect(
      handleFormsRest(broken, anonymous, {
        method: "GET",
        segments: [formId],
        query: {},
        body: null,
        secrets: {},
      }),
    ).rejects.toThrow();
  });
});
