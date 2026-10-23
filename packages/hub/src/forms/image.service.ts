import { generateUID } from "@kan/shared/utils";

import type { Db } from "../db";
import type { FormImageKind } from "../schema";
import type { FormViewer } from "./form.policy";
import type { BrowserSecrets } from "./response.service";
import { HubError } from "../shared/errors";
import { hashGrantToken, isGrantTokenShape } from "../shared/token";
import { viewerManages } from "./form.guard";
import {
  closedReasonText,
  formPhase,
  isQuestion,
  referencedImages,
} from "./form.model";
import { canFill, canSeeWall } from "./form.policy";
import {
  countResponses,
  deleteAbandonedUploads,
  deleteUnusedAssets,
  findByTokenHash,
  findForm,
  findFormById,
  findImageMeta,
  findLatestByUser,
  findResponseById,
  imageUsage,
  insertImage,
  lockForm,
  readImageBody,
} from "./form.repo";
import { imageSizeProblem, sniffImage } from "./image.policy";
import { findMine } from "./response.service";

/**
 * Pictures in forms: the ones managers put in (cover, question and option
 * pictures) and the ones people upload as answers. An answer picture is
 * uploaded first, then named in the answer; it only becomes visible to
 * others once that answer is sent.
 */

/** All pictures of one form together may take this much room in the database. */
export const FORM_IMAGE_BUDGET_BYTES = 200 * 1024 * 1024;
/** Unsent answer pictures one form may hold within a day (a brake on abuse of public forms). */
const PENDING_PER_DAY = 300;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface UploadedImage {
  publicId: string;
  width: number;
  height: number;
}

export async function uploadFormImage(
  db: Db,
  viewer: FormViewer,
  input: {
    formPublicId: string;
    purpose: FormImageKind;
    /** For an answer picture: the question it is for. */
    fieldId?: string | null;
    /** This browser's secrets: someone changing their answer to a full form. */
    secrets?: BrowserSecrets;
    bytes: Uint8Array;
  },
  now: Date = new Date(),
): Promise<UploadedImage> {
  const sizeProblem = imageSizeProblem(input.bytes.length);
  if (sizeProblem) throw new HubError("INVALID_INPUT", sizeProblem);

  const form = await findForm(db, input.formPublicId);
  if (!form) throw new HubError("NOT_FOUND", "找不到这份表单");
  const isManager = await viewerManages(db, viewer, form.id);

  let fieldId: string | null = null;
  if (input.purpose === "asset") {
    if (!isManager) throw new HubError("NOT_FOUND", "找不到这份表单");
  } else {
    if (form.status === "draft" && !isManager) {
      throw new HubError("NOT_FOUND", "找不到这份表单");
    }
    const decision = isManager ? { allowed: true } : canFill(form, viewer);
    if (!decision.allowed) {
      throw new HubError("FORBIDDEN", "你不能填写这份表单");
    }
    const phase = formPhase(form, await countResponses(db, form.id), now);
    if (phase.phase === "closed") {
      // A full form still takes pictures from people changing their answer.
      const changing =
        phase.reason === "full" &&
        form.settings.allowEdit &&
        (await findMine(db, form.id, viewer, input.secrets ?? {})) !== null;
      if (!changing) {
        throw new HubError("CONFLICT", closedReasonText[phase.reason]);
      }
    }
    const field = form.definition.fields.find(
      (item) => item.id === input.fieldId,
    );
    if (!field || field.type !== "image") {
      throw new HubError("INVALID_INPUT", "这道题不能传图片，请刷新页面");
    }
    fieldId = field.id;
    await deleteAbandonedUploads(db, form.id, new Date(now.getTime() - DAY_MS));
  }

  const image = sniffImage(input.bytes);
  if (!image) {
    throw new HubError(
      "INVALID_INPUT",
      "只能传 JPG、PNG、WebP 或 GIF 图片，这张图片的格式不对或者已经损坏",
    );
  }

  // Uploads to one form take turns on its row, so two arriving together
  // cannot both fit under the limits by reading the same usage.
  const created = await db.transaction(async (tx) => {
    const locked = await lockForm(tx, form.id);
    if (!locked) throw new HubError("NOT_FOUND", "找不到这份表单");
    // Pictures taken out of the form free their room here too, not only
    // when the form is saved again.
    if (input.purpose === "asset") {
      await deleteUnusedAssets(
        tx,
        form.id,
        referencedImages(locked.definition),
        now,
      );
    }
    const usage = await imageUsage(
      tx,
      form.id,
      new Date(now.getTime() - DAY_MS),
    );
    if (usage.bytes + input.bytes.length > FORM_IMAGE_BUDGET_BYTES) {
      throw new HubError(
        "CONFLICT",
        "这份表单的图片空间已经满了，请联系表单的管理者",
      );
    }
    if (input.purpose === "answer" && usage.pending >= PENDING_PER_DAY) {
      throw new HubError("CONFLICT", "现在上传的人太多了，请稍后再试");
    }
    return insertImage(tx, {
      publicId: generateUID(),
      formId: form.id,
      responseId: null,
      fieldId,
      kind: input.purpose,
      uploadedBy: viewer.userId,
      contentType: image.contentType,
      size: input.bytes.length,
      width: image.width,
      height: image.height,
      body: Buffer.from(input.bytes),
      now,
    });
  });
  return {
    publicId: created.publicId,
    width: created.width,
    height: created.height,
  };
}

export interface ImageFile {
  contentType: string;
  body: Buffer;
  /**
   * A picture the managers put in a public form: the same bytes for
   * everyone, so the browser may keep a copy, though it still asks each
   * time (the form can stop being public). Answer pictures are never kept.
   */
  cacheable: boolean;
}

const NOT_FOUND = "找不到这张图片";

/**
 * One picture, for someone allowed to see it. Pictures someone may not see
 * and ones that do not exist get the same answer.
 *
 * - The form's own pictures: whoever may open the published form, while
 *   the form still uses them (a removed one is kept a day for undo).
 * - An answer picture: the form's managers; the person who sent it (by
 *   account, or by the browser's edit token); and, when its question is
 *   shown on the results wall, whoever may see the wall.
 */
export async function readFormImage(
  db: Db,
  viewer: FormViewer,
  imagePublicId: string,
  secrets: BrowserSecrets = {},
): Promise<ImageFile> {
  const meta = await findImageMeta(db, imagePublicId);
  if (!meta) throw new HubError("NOT_FOUND", NOT_FOUND);
  const form = await findFormById(db, meta.formId);
  if (!form) throw new HubError("NOT_FOUND", NOT_FOUND);

  const allowed = async (): Promise<boolean> => {
    if (await viewerManages(db, viewer, form.id)) return true;
    if (form.status === "draft") return false;
    const mayFill = canFill(form, viewer).allowed;

    if (meta.kind === "asset") {
      return (
        mayFill && referencedImages(form.definition).includes(meta.publicId)
      );
    }

    if (meta.responseId === null) {
      return viewer.userId !== null && meta.uploadedBy === viewer.userId;
    }
    const response = await findResponseById(db, meta.responseId);
    if (!response) return false;
    if (viewer.userId !== null && response.userId === viewer.userId)
      return true;
    if (
      isGrantTokenShape(secrets.editToken) &&
      response.editTokenHash === hashGrantToken(secrets.editToken)
    ) {
      return true;
    }

    const field = form.definition.fields.find((f) => f.id === meta.fieldId);
    if (!field || !isQuestion(field) || !field.onWall) return false;
    const mine = viewer.userId
      ? await findLatestByUser(db, form.id, viewer.userId)
      : isGrantTokenShape(secrets.editToken)
        ? await findByTokenHash(db, form.id, hashGrantToken(secrets.editToken))
        : null;
    return canSeeWall({
      wall: form.settings.wall,
      isManager: false,
      mayFill,
      hasAnswered: mine !== null,
    });
  };

  if (!(await allowed())) throw new HubError("NOT_FOUND", NOT_FOUND);
  return {
    contentType: meta.contentType,
    body: await readImageBody(db, meta.id),
    cacheable: meta.kind === "asset" && form.access === "public",
  };
}
