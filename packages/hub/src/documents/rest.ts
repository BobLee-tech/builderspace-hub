import { z } from "zod";

import type { AdminActor } from "../accounts/account.service";
import type { Db } from "../db";
import type { HubErrorCode } from "../shared/errors";
import type { DocumentSummary } from "./library.service";
import type { DocumentStorage } from "./storage";
import { HubError } from "../shared/errors";
import {
  completeUpload,
  openDocument,
  prepareUpload,
  updateDocument,
} from "./document.service";
import {
  createFolder,
  getDocumentDetail,
  getLibrary,
} from "./library.service";
import {
  createTextDocument,
  readTextContent,
  replaceTextContent,
} from "./text.service";

/**
 * The document library as a REST API, for the command line (`bshub doc`).
 *
 * This is the transport-free part: it takes the parts of a request and the
 * caller's identity and returns a status and a body. The Next.js route does the
 * authentication (an API key or a browser session), the rate limit and the
 * reading and writing of HTTP. Every rule still lives in the use cases, so the
 * API can do exactly what the web app can do for the same person, and no more.
 *
 * Deliberately not here, whatever the caller's rights: deleting a document or a
 * folder, and handing out or deciding edit rights. An API key has no scope yet,
 * so a leaked one must not be able to remove files or pass on the right to
 * change them. Those stay in the web app.
 */

export interface RestRequest {
  method: string;
  /** The path after /documents, split on "/". */
  segments: string[];
  query: Record<string, string | undefined>;
  body: unknown;
}

export interface RestResponse {
  status: number;
  body: unknown;
}

const STATUS_OF: Record<HubErrorCode, number> = {
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  FORBIDDEN: 403,
  UNAVAILABLE: 503,
};

export function statusOfHubError(code: HubErrorCode): number {
  return STATUS_OF[code];
}

const id = z.string().min(1).max(32);

const createBody = z.object({
  title: z.string(),
  filename: z.string(),
  content: z.string(),
  description: z.string().nullish(),
  folderPublicId: id.nullish(),
  readable: z.boolean().optional(),
});

const patchBody = z.object({
  title: z.string().optional(),
  description: z.string().nullish(),
  folderPublicId: id.nullish(),
  readable: z.boolean().optional(),
});

const contentBody = z.object({ content: z.string() });

const prepareBody = z.object({ filename: z.string(), size: z.number().int() });

const completeBody = z.object({
  title: z.string().nullish(),
  description: z.string().nullish(),
  folderPublicId: id.nullish(),
  readable: z.boolean().optional(),
});

const folderBody = z.object({
  name: z.string(),
  parentPublicId: id.nullish(),
});

function body<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, raw: unknown): T {
  const result = schema.safeParse(raw ?? {});
  if (!result.success) {
    throw new HubError(
      "INVALID_INPUT",
      result.error.issues[0]?.message ?? "请求内容不对",
    );
  }
  return result.data;
}

/** What the API calls a document. Dates are ISO strings. */
function documentJson(doc: DocumentSummary) {
  return {
    publicId: doc.publicId,
    title: doc.title,
    description: doc.description,
    filename: doc.filename,
    ext: doc.ext,
    size: doc.size,
    folderPublicId: doc.folderPublicId,
    readable: doc.readable,
    canEdit: doc.canEdit,
    updatedAt: doc.updatedAt.toISOString(),
  };
}

const ok = (payload: unknown, status = 200): RestResponse => ({
  status,
  body: payload,
});

const failure = (status: number, message: string): RestResponse => ({
  status,
  body: { message },
});

const notFound = () => failure(404, "没有这个接口");
const wrongMethod = () => failure(405, "这个接口不支持这种请求方法");

export async function handleDocumentsRest(
  db: Db,
  storage: DocumentStorage | null,
  actor: AdminActor,
  request: RestRequest,
): Promise<RestResponse> {
  const { method, segments } = request;
  const detail = async (publicId: string) =>
    documentJson(await getDocumentDetail(db, storage, actor, publicId));

  // /documents
  if (segments.length === 0) {
    if (method === "GET") {
      const library = await getLibrary(db, storage, actor, {
        folderPublicId: request.query.folder ?? null,
        search: request.query.search ?? null,
      });
      return ok({
        folders: library.folders.map((folder) => ({
          publicId: folder.publicId,
          name: folder.name,
          parentPublicId: folder.parentPublicId,
        })),
        documents: library.documents.map(documentJson),
      });
    }
    if (method === "POST") {
      const input = body(createBody, request.body);
      const created = await createTextDocument(db, storage, actor, input);
      return ok(await detail(created.publicId), 201);
    }
    return wrongMethod();
  }

  const [first, second, third] = segments;

  // /documents/folders
  if (first === "folders") {
    if (segments.length !== 1) return notFound();
    if (method !== "POST") return wrongMethod();
    const input = body(folderBody, request.body);
    const created = await createFolder(db, actor, input);
    return ok(
      {
        publicId: created.publicId,
        name: created.name,
        parentPublicId: input.parentPublicId ?? null,
      },
      201,
    );
  }

  // /documents/uploads and /documents/uploads/{uploadId}/complete
  if (first === "uploads") {
    if (segments.length === 1) {
      if (method !== "POST") return wrongMethod();
      const prepared = await prepareUpload(
        db,
        storage,
        actor,
        body(prepareBody, request.body),
      );
      return ok(
        {
          uploadId: prepared.uploadId,
          url: prepared.target.url,
          method: prepared.target.method,
          headers: prepared.target.headers,
          expiresAt: prepared.expiresAt.toISOString(),
        },
        201,
      );
    }
    if (segments.length === 3 && third === "complete" && second) {
      if (method !== "POST") return wrongMethod();
      const created = await completeUpload(db, storage, actor, {
        ...body(completeBody, request.body),
        uploadId: second,
      });
      return ok(await detail(created.publicId), 201);
    }
    return notFound();
  }

  // /documents/{id}, /documents/{id}/content, /documents/{id}/download
  const publicId = first;
  if (!publicId) return notFound();

  if (segments.length === 1) {
    if (method === "GET") return ok(await detail(publicId));
    if (method === "PATCH") {
      await updateDocument(db, actor, {
        ...body(patchBody, request.body),
        documentPublicId: publicId,
      });
      return ok(await detail(publicId));
    }
    return wrongMethod();
  }

  if (segments.length === 2 && second === "content") {
    if (method === "GET") {
      const text = await readTextContent(db, storage, actor, publicId);
      return ok({ content: text.content, updatedAt: text.updatedAt.toISOString() });
    }
    if (method === "PUT") {
      const input = body(contentBody, request.body);
      const result = await replaceTextContent(db, storage, actor, {
        documentPublicId: publicId,
        content: input.content,
      });
      return ok(result);
    }
    return wrongMethod();
  }

  if (segments.length === 2 && second === "download") {
    if (method !== "GET") return wrongMethod();
    const doc = await getDocumentDetail(db, storage, actor, publicId);
    const opened = await openDocument(db, storage, actor, {
      documentPublicId: publicId,
      mode: "download",
    });
    if (opened.source.kind !== "redirect") {
      throw new HubError(
        "CONFLICT",
        "当前的文件存储不能给出下载链接（只有开发环境的磁盘存储会这样）",
      );
    }
    return ok({ url: opened.source.url, filename: doc.filename });
  }

  return notFound();
}
