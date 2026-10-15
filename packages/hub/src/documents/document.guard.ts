import type { AdminActor } from "../accounts/account.service";
import type { Db, DbOrTx } from "../db";
import type { DocumentRow } from "./document.repo";
import { HubError } from "../shared/errors";
import {
  canEditDocument,
  canManageEditors,
  canReadDocument,
} from "./document.policy";
import { findDocument, isEditor } from "./document.repo";

/** Everything the rules need to know about one person and one document. */
export interface DocumentAccess {
  row: DocumentRow;
  userId: string;
  isEditor: boolean;
  canEdit: boolean;
  canManage: boolean;
}

/** Documents are for signed-in people; a missing id means a bug in the caller. */
export function requireUserId(actor: AdminActor): string {
  if (!actor.userId) throw new HubError("FORBIDDEN", "请先登录");
  return actor.userId;
}

export function accessFor(
  row: DocumentRow,
  actor: AdminActor,
  userId: string,
  editor: boolean,
): DocumentAccess {
  return {
    row,
    userId,
    isEditor: editor,
    canEdit: canEditDocument({ role: actor.role, isEditor: editor }),
    canManage: canManageEditors({ role: actor.role, isEditor: editor }),
  };
}

/**
 * Loads a document for someone who must be able to read it. A document that
 * does not exist and one they may not read get the same answer, so the
 * response never confirms that a hidden document is there.
 */
export async function loadReadable(
  db: Db | DbOrTx,
  actor: AdminActor,
  publicId: string,
): Promise<DocumentAccess> {
  const userId = requireUserId(actor);
  const row = await findDocument(db, publicId);
  if (!row) throw new HubError("NOT_FOUND", "找不到这份文档");
  const access = accessFor(
    row,
    actor,
    userId,
    await isEditor(db, row.id, userId),
  );
  if (!canReadDocument({ readable: row.readable, canEdit: access.canEdit })) {
    throw new HubError("NOT_FOUND", "找不到这份文档");
  }
  return access;
}

export function requireEdit(access: DocumentAccess): void {
  if (!access.canEdit) {
    throw new HubError("FORBIDDEN", "你没有修改这份文档的权限，可以先申请");
  }
}

export function requireManage(access: DocumentAccess): void {
  if (!access.canManage) {
    throw new HubError(
      "FORBIDDEN",
      "只有所有者和这份文档的管理编辑者能分配修改权限",
    );
  }
}
