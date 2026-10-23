import { beforeEach, describe, expect, it } from "vitest";

import type { AdminActor } from "../accounts/account.service";
import type { Db } from "../db";
import type { FormViewer } from "./form.policy";
import { GIF_1X1, jpegHeader, PNG_1X1 } from "../testing/images";
import {
  createHubTestDb,
  seedHubAccount,
  seedProject,
  seedUser,
} from "../testing/test-db";
import {
  createForm,
  getFormDetail,
  saveForm,
  setFormStatus,
} from "./form.service";
import { IMAGE_MAX_BYTES } from "./image.policy";
import { readFormImage, uploadFormImage } from "./image.service";
import { submitResponse } from "./response.service";

let db: Db;
let admin: AdminActor;
let mia: FormViewer;
let anonymous: FormViewer;

const now = new Date("2026-10-22T10:00:00Z");
const DAY = 86_400_000;

beforeEach(async () => {
  db = await createHubTestDb();
  const [a, m] = await Promise.all([
    seedUser(db, { name: "Adam" }),
    seedUser(db, { name: "Mia" }),
  ]);
  await seedHubAccount(db, a.id, { role: "admin" });
  admin = { userId: a.id, email: a.email, role: "admin" };
  mia = { userId: m.id, role: null, projectIds: [] };
  anonymous = { userId: null, role: null, projectIds: [] };
});

const adminViewer = (): FormViewer => ({
  userId: admin.userId,
  role: "admin",
  projectIds: [],
});

async function makeForm(
  access: "public" | "members" | "projects",
  open = true,
  projectIds: string[] = [],
) {
  const { publicId } = await createForm(db, admin, { title: "图" }, now);
  const detail = await getFormDetail(db, admin, publicId, now);
  const cover = await uploadFormImage(
    db,
    adminViewer(),
    {
      formPublicId: publicId,
      purpose: "asset",
      bytes: PNG_1X1,
    },
    now,
  );
  await saveForm(
    db,
    admin,
    {
      formPublicId: publicId,
      title: detail.title,
      access,
      definition: {
        coverImage: cover.publicId,
        fields: [
          { id: "name01", type: "short_text", title: "称呼" },
          { id: "shot01", type: "image", title: "截图" },
        ],
      },
      settings: { projectIds },
      closesAt: null,
      maxResponses: null,
      expectedUpdatedAt: detail.updatedAt.toISOString(),
    },
    now,
  );
  if (open)
    await setFormStatus(
      db,
      admin,
      { formPublicId: publicId, status: "open" },
      now,
    );
  return { publicId, cover: cover.publicId };
}

const answerUpload = (
  viewer: FormViewer,
  publicId: string,
  extra: object = {},
  at = now,
) =>
  uploadFormImage(
    db,
    viewer,
    {
      formPublicId: publicId,
      purpose: "answer",
      fieldId: "shot01",
      bytes: GIF_1X1,
      ...extra,
    },
    at,
  );

/** Saves a form again with some of its fields changed, as the builder would. */
async function resave(
  publicId: string,
  change: (
    detail: Awaited<ReturnType<typeof getFormDetail>>,
  ) => Partial<Parameters<typeof saveForm>[2]>,
) {
  const detail = await getFormDetail(db, admin, publicId, now);
  await saveForm(
    db,
    admin,
    {
      formPublicId: publicId,
      title: detail.title,
      access: detail.access,
      definition: detail.definition,
      settings: detail.settings,
      closesAt: null,
      maxResponses: detail.maxResponses,
      expectedUpdatedAt: detail.updatedAt.toISOString(),
      ...change(detail),
    },
    now,
  );
}

describe("uploading", () => {
  it("stores the picture's real type and size", async () => {
    const { publicId } = await makeForm("public");
    const uploaded = await answerUpload(anonymous, publicId, {
      bytes: jpegHeader(800, 600),
    });
    expect(uploaded).toMatchObject({ width: 800, height: 600 });
    expect(uploaded.publicId).toMatch(/^[a-z0-9]{12}$/);
  });

  it("refuses what is not a picture, and pictures that are too big", async () => {
    const { publicId } = await makeForm("public");
    await expect(
      answerUpload(anonymous, publicId, {
        bytes: Uint8Array.from(Buffer.from("<svg onload=alert(1)>".padEnd(40))),
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      answerUpload(anonymous, publicId, {
        bytes: new Uint8Array(IMAGE_MAX_BYTES + 1),
      }),
    ).rejects.toMatchObject({ message: "图片太大，上限 3 MB" });
    await expect(answerUpload(anonymous, "nope")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("takes form pictures from managers only", async () => {
    const { publicId } = await makeForm("public");
    await expect(
      uploadFormImage(db, mia, {
        formPublicId: publicId,
        purpose: "asset",
        bytes: PNG_1X1,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("takes answer pictures only for picture questions of forms one may answer", async () => {
    const { publicId } = await makeForm("members");
    await expect(answerUpload(anonymous, publicId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      answerUpload(mia, publicId, { fieldId: "name01" }),
    ).rejects.toMatchObject({
      message: "这道题不能传图片，请刷新页面",
    });
    await expect(answerUpload(mia, publicId)).resolves.toBeDefined();

    const draft = await makeForm("public", false);
    await expect(answerUpload(anonymous, draft.publicId)).rejects.toMatchObject(
      {
        code: "NOT_FOUND",
      },
    );
    const closed = await makeForm("public");
    await setFormStatus(
      db,
      admin,
      { formPublicId: closed.publicId, status: "closed" },
      now,
    );
    await expect(
      answerUpload(anonymous, closed.publicId),
    ).rejects.toMatchObject({
      message: "这份表单已经停止收集",
    });
  });

  it("takes pictures for a full form only from people changing their answer", async () => {
    const { publicId } = await makeForm("public");
    await resave(publicId, (detail) => ({
      settings: { ...detail.settings, allowEdit: true },
      maxResponses: 1,
    }));
    const sent = await submitResponse(
      db,
      anonymous,
      publicId,
      { answers: { name01: "A" }, submissionKey: crypto.randomUUID() },
      {},
      now,
    );
    await expect(answerUpload(anonymous, publicId)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(
      answerUpload(anonymous, publicId, {
        secrets: { editToken: sent.editToken },
      }),
    ).resolves.toBeDefined();
  });

  it("frees a removed form picture's room on a later upload, after a day", async () => {
    const { publicId, cover } = await makeForm("public");
    await resave(publicId, (detail) => ({
      definition: { ...detail.definition, coverImage: null },
    }));
    await uploadFormImage(
      db,
      adminViewer(),
      { formPublicId: publicId, purpose: "asset", bytes: PNG_1X1 },
      new Date(now.getTime() + 2 * DAY),
    );
    await expect(readFormImage(db, adminViewer(), cover)).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );
  });

  it("clears out answer pictures nobody sent, after a day", async () => {
    const { publicId } = await makeForm("public");
    const stale = await answerUpload(mia, publicId);
    await answerUpload(mia, publicId, {}, new Date(now.getTime() + 2 * DAY));
    await expect(readFormImage(db, mia, stale.publicId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("reading", () => {
  it("shows a public form's pictures to anyone, and lets browsers keep them", async () => {
    const { cover } = await makeForm("public");
    const file = await readFormImage(db, anonymous, cover);
    expect(file).toMatchObject({ contentType: "image/png", cacheable: true });
    expect(file.body.length).toBe(PNG_1X1.length);
  });

  it("stops showing a picture once the form no longer uses it, except to managers", async () => {
    const { publicId, cover } = await makeForm("public");
    await resave(publicId, (detail) => ({
      definition: { ...detail.definition, coverImage: null },
    }));
    await expect(readFormImage(db, anonymous, cover)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      readFormImage(db, adminViewer(), cover),
    ).resolves.toBeDefined();
  });

  it("shows a members' form's pictures to signed-in people only, uncached", async () => {
    const { cover } = await makeForm("members");
    await expect(readFormImage(db, anonymous, cover)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(readFormImage(db, mia, cover)).resolves.toMatchObject({
      cacheable: false,
    });
  });

  it("keeps a project form's pictures to that project", async () => {
    const project = await seedProject(db, {
      id: admin.userId,
      email: admin.email,
    });
    const { cover } = await makeForm("projects", true, [project.publicId]);
    await expect(readFormImage(db, mia, cover)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      readFormImage(db, { ...mia, projectIds: [project.publicId] }, cover),
    ).resolves.toBeDefined();
  });

  it("hides a draft's pictures from everyone but managers", async () => {
    const { cover } = await makeForm("public", false);
    await expect(readFormImage(db, anonymous, cover)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      readFormImage(db, adminViewer(), cover),
    ).resolves.toBeDefined();
  });

  it("shows an unsent answer picture only to the signed-in person who uploaded it", async () => {
    const { publicId } = await makeForm("public");
    const mine = await answerUpload(mia, publicId);
    await expect(readFormImage(db, mia, mine.publicId)).resolves.toBeDefined();
    await expect(
      readFormImage(db, anonymous, mine.publicId),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      readFormImage(db, anonymous, "zzzzzzzzzzzz"),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
