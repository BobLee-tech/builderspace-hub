import type { Db } from "../db";
import type { FormViewer } from "./form.policy";
import type { ImageFile } from "./image.service";
import type { BrowserSecrets } from "./response.service";
import { statusOfHubError } from "../documents/rest";
import { isHubError } from "../shared/errors";
import { readFormImage, uploadFormImage } from "./image.service";
import {
  AnswerProblemsError,
  getWall,
  likeResponse,
  openForm,
  submitResponse,
  updateMyResponse,
} from "./response.service";

/**
 * The API the fill page and the results wall use, at /api/hub/forms/…. It
 * works without signing in (for public forms); a signed-in browser session
 * is used when there is one. Transport-free like `documents/rest.ts`: the
 * Next.js route reads the request, works out the viewer and writes the
 * response. Every rule lives in the use cases.
 *
 *   GET  /{form}                        the form, and this person's answer
 *   POST /{form}/responses              send an answer
 *   PUT  /{form}/responses/mine         change one's answer
 *   GET  /{form}/wall?page=&sort=       the results wall
 *   PUT  /{form}/responses/{id}/like    👍 or take it back
 *   POST /{form}/images?purpose=&field= upload a picture (the body is the bytes)
 *   GET  /images/{image}                one picture
 */

export interface FormsRestRequest {
  method: string;
  /** The path after /api/hub/forms, split on "/". */
  segments: string[];
  query: Record<string, string | undefined>;
  /** The parsed JSON body, for every route but the upload. */
  body: unknown;
  /** The raw body, for the upload. */
  bytes?: Uint8Array;
  secrets: BrowserSecrets;
}

export type FormsRestResponse =
  | { status: number; body: unknown }
  | { status: number; file: ImageFile };

const json = (body: unknown, status = 200): FormsRestResponse => ({
  status,
  body,
});
const failure = (status: number, message: string) => json({ message }, status);
const notFound = () => failure(404, "没有这个接口");
const wrongMethod = () => failure(405, "这个接口不支持这种请求方法");

const ID = /^[a-z0-9]{1,32}$/;

async function route(
  db: Db,
  viewer: FormViewer,
  request: FormsRestRequest,
  now: Date,
): Promise<FormsRestResponse> {
  const { method, segments, secrets } = request;
  const [first, second, third, fourth] = segments;
  if (!first || segments.some((segment) => !ID.test(segment))) {
    return notFound();
  }

  if (first === "images") {
    if (segments.length !== 2 || !second) return notFound();
    if (method !== "GET") return wrongMethod();
    return {
      status: 200,
      file: await readFormImage(db, viewer, second, secrets),
    };
  }

  const form = first;
  if (segments.length === 1) {
    if (method !== "GET") return wrongMethod();
    return json(await openForm(db, viewer, form, secrets, now));
  }

  if (second === "responses") {
    if (segments.length === 2) {
      if (method !== "POST") return wrongMethod();
      const body = (request.body ?? {}) as Record<string, unknown>;
      const result = await submitResponse(
        db,
        viewer,
        form,
        { answers: body.answers, submissionKey: body.submissionKey as string },
        now,
      );
      return json(result, 201);
    }
    if (segments.length === 3 && third === "mine") {
      if (method !== "PUT") return wrongMethod();
      const body = (request.body ?? {}) as Record<string, unknown>;
      return json(
        await updateMyResponse(
          db,
          viewer,
          form,
          { answers: body.answers },
          secrets,
          now,
        ),
      );
    }
    if (segments.length === 4 && third && fourth === "like") {
      if (method !== "PUT") return wrongMethod();
      const body = (request.body ?? {}) as Record<string, unknown>;
      return json(
        await likeResponse(
          db,
          viewer,
          form,
          { responsePublicId: third, like: body.like as boolean },
          secrets,
          now,
        ),
      );
    }
    return notFound();
  }

  if (second === "wall" && segments.length === 2) {
    if (method !== "GET") return wrongMethod();
    const page = Number(request.query.page ?? "1");
    const sort = request.query.sort === "likes" ? "likes" : "newest";
    return json(
      await getWall(
        db,
        viewer,
        form,
        { page: Number.isInteger(page) ? page : 1, sort },
        secrets,
        now,
      ),
    );
  }

  if (second === "images" && segments.length === 2) {
    if (method !== "POST") return wrongMethod();
    const purpose = request.query.purpose === "asset" ? "asset" : "answer";
    const uploaded = await uploadFormImage(
      db,
      viewer,
      {
        formPublicId: form,
        purpose,
        fieldId: request.query.field ?? null,
        bytes: request.bytes ?? new Uint8Array(),
      },
      now,
    );
    return json(uploaded, 201);
  }

  return notFound();
}

/** Runs one request; a use case's expected failure becomes a status and a message. */
export async function handleFormsRest(
  db: Db,
  viewer: FormViewer,
  request: FormsRestRequest,
  now: Date = new Date(),
): Promise<FormsRestResponse> {
  try {
    return await route(db, viewer, request, now);
  } catch (error) {
    if (!isHubError(error)) throw error;
    const body: { message: string; fieldErrors?: Record<string, string> } = {
      message: error.message,
    };
    if (error instanceof AnswerProblemsError)
      body.fieldErrors = error.fieldErrors;
    return json(body, statusOfHubError(error.code));
  }
}
