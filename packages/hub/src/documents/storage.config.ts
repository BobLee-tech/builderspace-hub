import type { Db } from "../db";
import type { DocumentStorage } from "./storage";
import {
  DatabaseDocumentStorage,
  DatabaseFirstDocumentStorage,
} from "./storage.db";
import { FsDocumentStorage } from "./storage.fs";
import { createDocumentS3Client, S3DocumentStorage } from "./storage.s3";

type Env = Record<string, string | undefined>;

/**
 * Picks the storage from the environment.
 *
 * - `HUB_DOCUMENTS_BUCKET` set: that S3-compatible bucket, with the same
 *   `S3_*` variables Kan's own attachments use for the credentials and
 *   endpoint.
 * - else `HUB_DOCUMENTS_DIR` set: a folder on disk, development only.
 * - else null, and the library is read-only until one is configured.
 *
 * Throws on a half-configured bucket or a folder in production, so a mistake
 * shows up as an error instead of files silently going nowhere.
 */
export function documentStorageFromEnv(env: Env): DocumentStorage | null {
  const bucket = env.HUB_DOCUMENTS_BUCKET;
  if (bucket) {
    const accessKeyId = env.S3_ACCESS_KEY_ID;
    const secretAccessKey = env.S3_SECRET_ACCESS_KEY;
    if (!accessKeyId || !secretAccessKey) {
      throw new Error(
        "HUB_DOCUMENTS_BUCKET is set but S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY are not",
      );
    }
    return new S3DocumentStorage(
      createDocumentS3Client({
        region: env.S3_REGION || "us-east-1",
        endpoint: env.S3_ENDPOINT,
        accessKeyId,
        secretAccessKey,
        forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
      }),
      bucket,
    );
  }

  const dir = env.HUB_DOCUMENTS_DIR;
  if (dir) {
    if (env.NODE_ENV === "production") {
      throw new Error(
        "HUB_DOCUMENTS_DIR is for development only; set HUB_DOCUMENTS_BUCKET",
      );
    }
    return new FsDocumentStorage(dir);
  }

  return null;
}

let cached: { primary: DocumentStorage | null } | undefined;

/**
 * The storage to use, built around `db`. There is always some: a configured
 * bucket (or, in development, a folder) handles uploads and everything new;
 * without one the database holds text documents, which is enough to write
 * and edit documents before a bucket exists. Files already in the database
 * stay readable either way.
 */
export function getDocumentStorage(db: Db): DocumentStorage {
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  cached ??= { primary: documentStorageFromEnv(process.env) };
  return new DatabaseFirstDocumentStorage(
    new DatabaseDocumentStorage(db),
    cached.primary,
  );
}

/**
 * The configured bucket or folder on its own, without the database in front
 * of it: the disk upload route needs to know whether the folder driver is in
 * use.
 */
export function getPrimaryDocumentStorage(): DocumentStorage | null {
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  cached ??= { primary: documentStorageFromEnv(process.env) };
  return cached.primary;
}
