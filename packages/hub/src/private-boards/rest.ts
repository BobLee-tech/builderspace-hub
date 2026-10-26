import { z } from "zod";

import type { AdminActor } from "../accounts/account.service";
import type { Db } from "../db";
import type { RestRequest, RestResponse } from "../shared/rest";
import { HubError } from "../shared/errors";
import { boardAudiences } from "./private-board.policy";
import { getBoardPrivacy, setBoardAudience } from "./private-board.service";

/**
 * Who can see a board, as a REST API for the command line
 * (`bshub board +audience`): the same 所有成员 / 仅管理员可见 / 仅自己可见
 * switch as the board page, with the same rules, because both call the use
 * cases in `private-board.service.ts`.
 *
 *   GET /boards/{publicId}/audience   → { audience, canSwitchTo }
 *   PUT /boards/{publicId}/audience   { audience: "admins" | "owner" | null }
 *
 * Boards themselves (creating, renaming, cards) stay on Kan's /api/v1.
 */

const audienceBody = z.object({
  /** Null hands the board back to every project member. */
  audience: z.enum(boardAudiences).nullable(),
});

const notFound = (): RestResponse => ({
  status: 404,
  body: { message: "没有这个接口" },
});

const wrongMethod = (): RestResponse => ({
  status: 405,
  body: { message: "这个接口不支持这种请求方法" },
});

export async function handleBoardsRest(
  db: Db,
  actor: AdminActor,
  request: RestRequest,
): Promise<RestResponse> {
  const { method, segments } = request;
  const [boardPublicId, what] = segments;
  if (segments.length !== 2 || !boardPublicId || what !== "audience") {
    return notFound();
  }
  if (method === "GET") {
    return {
      status: 200,
      body: await getBoardPrivacy(db, actor.userId, boardPublicId),
    };
  }
  if (method === "PUT") {
    const parsed = audienceBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw new HubError(
        "INVALID_INPUT",
        "audience 只能是 admins（仅管理员可见）、owner（仅自己可见）或 null（所有成员）",
      );
    }
    const privacy = await setBoardAudience(db, actor, {
      boardPublicId,
      audience: parsed.data.audience,
    });
    return { status: 200, body: privacy };
  }
  return wrongMethod();
}
