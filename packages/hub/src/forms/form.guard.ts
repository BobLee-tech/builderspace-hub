import type { z } from "zod";

import type { AdminActor } from "../accounts/account.service";
import type { Db, DbOrTx } from "../db";
import type { FormViewer } from "./form.policy";
import type { FormRow } from "./form.repo";
import { getAccessFacts } from "../accounts/account.service";
import { listMemberships } from "../kan/accounts.gateway";
import { HubError } from "../shared/errors";
import { canManageForm, canShareForm } from "./form.policy";
import { findForm, isManager } from "./form.repo";

export function parse<T, I>(
  schema: z.ZodType<T, z.ZodTypeDef, I>,
  input: unknown,
): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new HubError(
      "INVALID_INPUT",
      result.error.issues[0]?.message ?? "输入不对",
    );
  }
  return result.data;
}

const NOT_FOUND = "找不到这份表单";

/** Everything the rules need to know about one manager and one form. */
export interface FormAccessFacts {
  row: FormRow;
  userId: string;
  isManager: boolean;
  canShare: boolean;
}

/**
 * Loads a form for someone who must be able to manage it. A form that does
 * not exist and one they do not manage get the same answer, so the
 * response never confirms that someone else's form is there.
 */
export async function loadManaged(
  db: DbOrTx,
  actor: AdminActor,
  publicId: string,
): Promise<FormAccessFacts> {
  if (!actor.userId) throw new HubError("FORBIDDEN", "请先登录");
  const row = await findForm(db, publicId);
  if (!row) throw new HubError("NOT_FOUND", NOT_FOUND);
  const listed = await isManager(db, row.id, actor.userId);
  if (!canManageForm({ role: actor.role, isManager: listed })) {
    throw new HubError("NOT_FOUND", NOT_FOUND);
  }
  return {
    row,
    userId: actor.userId,
    isManager: listed,
    canShare: canShareForm({ role: actor.role, isManager: listed }),
  };
}

export function requireShare(access: FormAccessFacts): void {
  if (!access.canShare) {
    throw new HubError(
      "FORBIDDEN",
      "只有所有者和管理这份表单的管理员能做这件事",
    );
  }
}

/** Whether this viewer manages the form (owners manage every form). */
export async function viewerManages(
  db: DbOrTx,
  viewer: FormViewer,
  formId: number,
): Promise<boolean> {
  if (!viewer.userId) return false;
  return canManageForm({
    role: viewer.role,
    isManager: await isManager(db, formId, viewer.userId),
  });
}

/**
 * Who is looking at a form page: nobody (not signed in), or a signed-in
 * person with their back-office role and projects. A suspended account is
 * treated as not signed in.
 */
export async function formViewerFor(
  db: Db,
  user: { id: string } | null,
): Promise<FormViewer> {
  if (!user) return { userId: null, role: null, projectIds: [] };
  const facts = await getAccessFacts(db, user.id);
  if (facts.status === "suspended") {
    return { userId: null, role: null, projectIds: [] };
  }
  const memberships = await listMemberships(db, [user.id]);
  return {
    userId: user.id,
    role: facts.role,
    projectIds: (memberships.get(user.id) ?? []).map(
      (item) => item.projectPublicId,
    ),
  };
}
