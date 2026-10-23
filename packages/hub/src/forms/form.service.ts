import { z } from "zod";

import { generateUID } from "@kan/shared/utils";

import type { AdminActor } from "../accounts/account.service";
import type { Db } from "../db";
import type { FormAccess, FormStatus } from "../schema";
import type { FormDefinition, FormPhase, FormSettings } from "./form.model";
import type {
  CandidateRow,
  FormListRow,
  FormRow,
  ManagerRow,
} from "./form.repo";
import { withAudit } from "../audit";
import { listMemberships } from "../kan/accounts.gateway";
import { listProjects } from "../kan/projects.gateway";
import { formAccessLevels, formStatuses } from "../schema";
import { HubError } from "../shared/errors";
import { loadManaged, parse, requireShare } from "./form.guard";
import {
  checkDefinition,
  cleanLine,
  DEFAULT_SETTINGS,
  FORM_LIMITS,
  formPhase,
  isQuestion,
  newFieldId,
  referencedImages,
  settingsSchema,
} from "./form.model";
import { canCreateForm, reconcileSettings } from "./form.policy";
import {
  addManager,
  copyImages,
  countResponses,
  deleteForm as deleteFormRow,
  deleteImages,
  findUserName,
  insertForm,
  listFormsToFill,
  listImagesOf,
  listImagesOfKind,
  listManagedForms,
  listManagers,
  lockForm,
  removeManager,
  searchManagerCandidates,
  updateForm,
} from "./form.repo";

/**
 * Forms as their managers see them: create, change, open and close,
 * duplicate, delete, and hand to more people. Answering a form is in
 * `response.service.ts`.
 */

const idSchema = z.string().min(1).max(32);

const titleSchema: z.ZodType<string, z.ZodTypeDef, string> = z
  .string()
  .max(FORM_LIMITS.title * 2)
  .transform(cleanLine)
  .pipe(
    z
      .string()
      .min(1, "标题要填写")
      .max(FORM_LIMITS.title, `标题最多 ${FORM_LIMITS.title} 个字`),
  );

const STALE = "这份表单在你打开之后被别人改过了，请刷新后再改";

/** A new form starts with one question, so the builder is never blank. */
function starterDefinition(): FormDefinition {
  return {
    description: "",
    coverImage: null,
    fields: [
      {
        id: newFieldId(),
        type: "short_text",
        title: "你的称呼",
        help: "",
        images: [],
        required: true,
        onWall: true,
        format: "plain",
      },
    ],
  };
}

export async function createForm(
  db: Db,
  actor: AdminActor,
  rawInput: { title: string },
  now: Date = new Date(),
): Promise<{ publicId: string }> {
  if (!canCreateForm(actor.role)) {
    throw new HubError("FORBIDDEN", "只有所有者和管理员能新建表单");
  }
  const title = parse(titleSchema, rawInput.title);

  return withAudit(
    db,
    async (tx) => {
      const created = await insertForm(tx, {
        publicId: generateUID(),
        title,
        status: "draft",
        access: "members",
        definition: starterDefinition(),
        settings: DEFAULT_SETTINGS,
        closesAt: null,
        maxResponses: null,
        createdBy: actor.userId,
        now,
      });
      await addManager(tx, {
        formId: created.id,
        userId: actor.userId,
        grantedBy: actor.userId,
      });
      return { publicId: created.publicId };
    },
    (result) => ({
      actor,
      action: "form.created",
      entityType: "form",
      entityId: result.publicId,
      summary: `新建了表单「${title}」`,
    }),
  );
}

export interface FormDetail {
  publicId: string;
  title: string;
  status: FormStatus;
  access: FormAccess;
  definition: FormDefinition;
  settings: FormSettings;
  closesAt: Date | null;
  maxResponses: number | null;
  responseCount: number;
  phase: FormPhase;
  updatedAt: Date;
  createdAt: Date;
  canShare: boolean;
  /** Every project, for the "which projects may answer" picker. */
  projects: { publicId: string; name: string }[];
  managers: ManagerRow[];
}

export async function getFormDetail(
  db: Db,
  actor: AdminActor,
  publicId: string,
  now: Date = new Date(),
): Promise<FormDetail> {
  const access = await loadManaged(db, actor, publicId);
  const { row } = access;
  const [responseCount, projects, managers] = await Promise.all([
    countResponses(db, row.id),
    listProjects(db),
    listManagers(db, row.id),
  ]);
  return {
    publicId: row.publicId,
    title: row.title,
    status: row.status,
    access: row.access,
    definition: row.definition,
    settings: row.settings,
    closesAt: row.closesAt,
    maxResponses: row.maxResponses,
    responseCount,
    phase: formPhase(row, responseCount, now),
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
    canShare: access.canShare,
    projects: projects.map((project) => ({
      publicId: project.publicId,
      name: project.name,
    })),
    managers,
  };
}

const saveSchema = z.object({
  formPublicId: idSchema,
  title: z.string(),
  access: z.enum(formAccessLevels),
  definition: z.unknown(),
  settings: z.unknown(),
  closesAt: z
    .string()
    .datetime({ message: "截止时间的格式不对" })
    .transform((value) => new Date(value))
    .nullable(),
  maxResponses: z
    .number()
    .int("名额要是整数")
    .min(1, "名额至少是 1")
    .max(FORM_LIMITS.maxResponses, `名额最多 ${FORM_LIMITS.maxResponses}`)
    .nullable(),
  /** The `updatedAt` the builder was opened with; the save is refused if it changed. */
  expectedUpdatedAt: z
    .string()
    .datetime()
    .transform((value) => new Date(value)),
});

/** Pictures uploaded for a form but not kept in it are removed after this long. */
const UNUSED_ASSET_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Saves the title, questions and settings in one go. The builder always
 * sends the whole form; a save made on a stale copy is refused.
 *
 * Once a form has answers, a question keeps its type: an answer stored as
 * text cannot become a choice. Deleting a question is allowed; its answers
 * stay and are shown under the old title.
 */
export async function saveForm(
  db: Db,
  actor: AdminActor,
  rawInput: z.input<typeof saveSchema>,
  now: Date = new Date(),
): Promise<{ updatedAt: Date }> {
  const input = parse(saveSchema, rawInput);
  const title = parse(titleSchema, input.title);
  const access = await loadManaged(db, actor, input.formPublicId);
  const { row } = access;

  // The builder runs the same check and marks every problem; here the first is enough.
  const checked = checkDefinition(input.definition);
  if (!checked.ok) {
    throw new HubError(
      "INVALID_INPUT",
      checked.problems[0]?.message ?? "题目有问题",
    );
  }
  const definition = checked.definition;
  const settings = reconcileSettings(
    input.access,
    parse(settingsSchema, input.settings),
  );

  if (input.access === "projects") {
    if (settings.projectIds.length === 0) {
      throw new HubError(
        "INVALID_INPUT",
        "选「指定项目的成员」时，至少要选一个项目",
      );
    }
    const known = new Set((await listProjects(db)).map((p) => p.publicId));
    if (settings.projectIds.some((id) => !known.has(id))) {
      throw new HubError("INVALID_INPUT", "选的项目有的已经不存在了，请重新选");
    }
  }

  if (
    input.closesAt &&
    input.closesAt.getTime() !== row.closesAt?.getTime() &&
    input.closesAt.getTime() <= now.getTime()
  ) {
    throw new HubError("INVALID_INPUT", "截止时间要晚于现在");
  }

  if (row.status !== "draft" && !definition.fields.some(isQuestion)) {
    throw new HubError("INVALID_INPUT", "已发布的表单至少要有一道题");
  }

  // Every picture the form points at must be one of this form's own.
  const wanted = referencedImages(definition);
  const found = await listImagesOf(db, row.id, wanted);
  const assets = new Set(
    found.filter((image) => image.kind === "asset").map((i) => i.publicId),
  );
  if (wanted.some((id) => !assets.has(id))) {
    throw new HubError("INVALID_INPUT", "有图片已经失效了，请重新上传");
  }

  await withAudit(
    db,
    async (tx) => {
      // Answers take the same lock, so a first answer cannot arrive between
      // this check and the write.
      await lockForm(tx, row.id);
      if ((await countResponses(tx, row.id)) > 0) {
        keepQuestionTypes(row.definition, definition);
      }
      const written = await updateForm(
        tx,
        row.id,
        {
          title,
          access: input.access,
          definition,
          settings,
          closesAt: input.closesAt,
          maxResponses: input.maxResponses,
        },
        now,
        input.expectedUpdatedAt,
      );
      if (!written) throw new HubError("CONFLICT", STALE);

      const kept = new Set(wanted);
      const cutoff = now.getTime() - UNUSED_ASSET_GRACE_MS;
      const unused = (await listImagesOfKind(tx, row.id, "asset")).filter(
        (image) =>
          !kept.has(image.publicId) && image.createdAt.getTime() < cutoff,
      );
      await deleteImages(
        tx,
        unused.map((image) => image.id),
      );
    },
    () => ({
      actor,
      action: "form.updated",
      entityType: "form",
      entityId: row.publicId,
      summary: `修改了表单「${title}」`,
    }),
  );
  return { updatedAt: now };
}

/** Once a form has answers, a question keeps its type (its answers are of it). */
function keepQuestionTypes(
  before: FormDefinition,
  after: FormDefinition,
): void {
  const types = new Map(before.fields.map((f) => [f.id, f.type]));
  for (const field of after.fields) {
    const type = types.get(field.id);
    if (type && type !== field.type) {
      throw new HubError(
        "INVALID_INPUT",
        "已经有人回答了，题目的类型不能再改。可以删掉这道题再加一道新的",
      );
    }
  }
}

/** Back to draft only before any answer; open only with a question, a future deadline and room left. */
function checkStatusChange(
  form: FormRow,
  status: FormStatus,
  responseCount: number,
  now: Date,
): void {
  if (status === "draft" && responseCount > 0) {
    throw new HubError(
      "CONFLICT",
      "已经有人回答了，不能改回草稿，可以停止收集",
    );
  }
  if (status !== "open") return;
  if (!form.definition.fields.some(isQuestion)) {
    throw new HubError("INVALID_INPUT", "表单还没有题目，加一道题再发布");
  }
  if (form.closesAt && form.closesAt.getTime() <= now.getTime()) {
    throw new HubError("INVALID_INPUT", "截止时间已经过了，先改截止时间再发布");
  }
  if (form.maxResponses !== null && responseCount >= form.maxResponses) {
    throw new HubError(
      "INVALID_INPUT",
      `已经收满 ${form.maxResponses} 份，先调高名额上限再发布`,
    );
  }
}

const statusSchema = z.object({
  formPublicId: idSchema,
  status: z.enum(formStatuses),
});

const STATUS_WORDS: Record<FormStatus, string> = {
  draft: "改回了草稿",
  open: "开始收集",
  closed: "停止收集",
};

/** Opens a form for answers, closes it, or (before any answer) takes it back to draft. */
export async function setFormStatus(
  db: Db,
  actor: AdminActor,
  rawInput: z.input<typeof statusSchema>,
  now: Date = new Date(),
): Promise<{ phase: FormPhase }> {
  const input = parse(statusSchema, rawInput);
  const { row } = await loadManaged(db, actor, input.formPublicId);
  const responseCount = await countResponses(db, row.id);
  const status = input.status;
  checkStatusChange(row, status, responseCount, now);

  if (status !== row.status) {
    await withAudit(
      db,
      async (tx) => {
        // An answer or a save arriving now holds the same lock: check again
        // against the form and its answers as they are under it.
        const locked = await lockForm(tx, row.id);
        if (!locked) throw new HubError("NOT_FOUND", "找不到这份表单");
        checkStatusChange(
          locked,
          status,
          await countResponses(tx, row.id),
          now,
        );
        await updateForm(tx, row.id, { status }, now);
      },
      () => ({
        actor,
        action: status === "open" ? "form.opened" : "form.closed",
        entityType: "form",
        entityId: row.publicId,
        summary: `把表单「${row.title}」${STATUS_WORDS[status]}`,
      }),
    );
  }
  return { phase: formPhase({ ...row, status }, responseCount, now) };
}

/**
 * Makes a fresh draft from a form: same questions, settings and pictures,
 * no answers, no deadline. This is how a form is reused.
 */
export async function duplicateForm(
  db: Db,
  actor: AdminActor,
  publicId: string,
  now: Date = new Date(),
): Promise<{ publicId: string }> {
  if (!canCreateForm(actor.role)) {
    throw new HubError("FORBIDDEN", "只有所有者和管理员能新建表单");
  }
  const { row } = await loadManaged(db, actor, publicId);

  const renamed = new Map(
    referencedImages(row.definition).map((id) => [id, generateUID()]),
  );
  const swap = (id: string | null) => (id ? (renamed.get(id) ?? id) : null);
  const definition: FormDefinition = {
    ...row.definition,
    coverImage: swap(row.definition.coverImage),
    fields: row.definition.fields.map((field) => {
      const images = field.images.map((id) => renamed.get(id) ?? id);
      if (field.type === "single_choice" || field.type === "multi_choice") {
        return {
          ...field,
          images,
          options: field.options.map((item) => ({
            ...item,
            image: swap(item.image),
          })),
        };
      }
      return { ...field, images };
    }),
  };
  const suffix = "（副本）";
  const title = `${row.title.slice(0, FORM_LIMITS.title - suffix.length)}${suffix}`;

  return withAudit(
    db,
    async (tx) => {
      const created = await insertForm(tx, {
        publicId: generateUID(),
        title,
        status: "draft",
        access: row.access,
        definition,
        settings: row.settings,
        closesAt: null,
        maxResponses: row.maxResponses,
        createdBy: actor.userId,
        now,
      });
      await copyImages(tx, {
        fromFormId: row.id,
        toFormId: created.id,
        publicIds: renamed,
        uploadedBy: actor.userId,
        now,
      });
      await addManager(tx, {
        formId: created.id,
        userId: actor.userId,
        grantedBy: actor.userId,
      });
      return { publicId: created.publicId };
    },
    (result) => ({
      actor,
      action: "form.duplicated",
      entityType: "form",
      entityId: result.publicId,
      summary: `复制表单「${row.title}」，得到「${title}」`,
    }),
  );
}

/** Deletes a form with all its answers and pictures. */
export async function deleteForm(
  db: Db,
  actor: AdminActor,
  publicId: string,
): Promise<void> {
  const access = await loadManaged(db, actor, publicId);
  requireShare(access);
  const { row } = access;
  const responseCount = await countResponses(db, row.id);
  await withAudit(
    db,
    (tx) => deleteFormRow(tx, row.id),
    () => ({
      actor,
      action: "form.deleted",
      entityType: "form",
      entityId: row.publicId,
      summary: `删除了表单「${row.title}」和它的 ${responseCount} 份回答`,
    }),
  );
}

export interface FormSummary {
  publicId: string;
  title: string;
  access: FormAccess;
  phase: FormPhase;
  responseCount: number;
  maxResponses: number | null;
  closesAt: Date | null;
  updatedAt: Date;
}

export interface FormList {
  canCreate: boolean;
  /** Forms this person manages (every form, for an owner). */
  managed: FormSummary[];
  /** Open forms for signed-in members that this person may answer. */
  toFill: (FormSummary & { answered: boolean })[];
}

const summaryOf = (row: FormListRow, now: Date): FormSummary => ({
  publicId: row.publicId,
  title: row.title,
  access: row.access,
  phase: formPhase(row, row.responseCount, now),
  responseCount: row.responseCount,
  maxResponses: row.maxResponses,
  closesAt: row.closesAt,
  updatedAt: row.updatedAt,
});

export async function listForms(
  db: Db,
  actor: AdminActor,
  now: Date = new Date(),
): Promise<FormList> {
  if (!actor.userId) throw new HubError("FORBIDDEN", "请先登录");
  const userId = actor.userId;
  const [managed, open] = await Promise.all([
    listManagedForms(db, { userId, all: actor.role === "owner" }),
    listMemberships(db, [userId]).then((memberships) =>
      listFormsToFill(db, {
        userId,
        projectIds: (memberships.get(userId) ?? []).map(
          (item) => item.projectPublicId,
        ),
        now,
      }),
    ),
  ]);

  return {
    canCreate: canCreateForm(actor.role),
    managed: managed.map((row) => summaryOf(row, now)),
    toFill: open.map((row) => ({
      ...summaryOf(row, now),
      answered: row.answered,
    })),
  };
}

/* ── managers ────────────────────────────────────────────────────────── */

export async function findManagerCandidates(
  db: Db,
  actor: AdminActor,
  input: { formPublicId: string; search: string },
): Promise<CandidateRow[]> {
  const access = await loadManaged(db, actor, input.formPublicId);
  requireShare(access);
  const search = input.search.trim();
  if (!search) return [];
  return searchManagerCandidates(db, {
    formId: access.row.id,
    search,
    limit: 8,
  });
}

export async function addFormManager(
  db: Db,
  actor: AdminActor,
  input: { formPublicId: string; userId: string },
): Promise<void> {
  const access = await loadManaged(db, actor, input.formPublicId);
  requireShare(access);
  const name = await findUserName(db, input.userId);
  if (!name) throw new HubError("NOT_FOUND", "找不到这个人");
  await withAudit(
    db,
    async (tx) => {
      const added = await addManager(tx, {
        formId: access.row.id,
        userId: input.userId,
        grantedBy: actor.userId,
      });
      if (!added) throw new HubError("CONFLICT", "这个人已经能管理这份表单了");
    },
    () => ({
      actor,
      action: "form.manager_added",
      entityType: "form",
      entityId: access.row.publicId,
      summary: `让 ${name} 管理表单「${access.row.title}」`,
      detail: { userId: input.userId },
    }),
  );
}

export async function removeFormManager(
  db: Db,
  actor: AdminActor,
  input: { formPublicId: string; userId: string },
): Promise<void> {
  const access = await loadManaged(db, actor, input.formPublicId);
  requireShare(access);
  const name = (await findUserName(db, input.userId)) ?? "这个人";
  await withAudit(
    db,
    async (tx) => {
      const removed = await removeManager(tx, access.row.id, input.userId);
      if (!removed)
        throw new HubError("NOT_FOUND", "这个人本来就不能管理这份表单");
    },
    () => ({
      actor,
      action: "form.manager_removed",
      entityType: "form",
      entityId: access.row.publicId,
      summary: `不再让 ${name} 管理表单「${access.row.title}」`,
      detail: { userId: input.userId },
    }),
  );
}
