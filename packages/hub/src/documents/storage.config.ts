import type { Db } from "../db";
import type { DocumentStorage } from "./storage";
import { DatabaseDocumentStorage } from "./storage.db";

/**
 * The storage for document content: always the database. Nothing to
 * configure, no bucket and no environment variables.
 */
export function getDocumentStorage(db: Db): DocumentStorage {
  return new DatabaseDocumentStorage(db);
}
