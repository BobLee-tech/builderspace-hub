import type { AuditActor } from "../audit";
import type { Db } from "../db";
import type { FunctionColors } from "./function-colors.policy";
import { withAudit } from "../audit";
import { HubError } from "../shared/errors";
import { functionNames } from "../tasks/task.policy";
import {
  readFunctionColors,
  validateFunctionColors,
} from "./function-colors.policy";
import { readSetting, writeSetting } from "./settings.repo";

const FUNCTION_COLORS_KEY = "function_colors";

/** The colours every page paints 开发 / 运营 / 营销 in. */
export async function getFunctionColors(db: Db): Promise<FunctionColors> {
  return readFunctionColors(await readSetting(db, FUNCTION_COLORS_KEY));
}

export async function setFunctionColors(
  db: Db,
  actor: AuditActor,
  input: Record<string, unknown>,
  now: Date = new Date(),
): Promise<FunctionColors> {
  const checked = validateFunctionColors(input);
  if (!checked.ok) throw new HubError("INVALID_INPUT", checked.reason);
  const { colors } = checked;

  await withAudit(
    db,
    (tx) =>
      writeSetting(tx, FUNCTION_COLORS_KEY, colors, {
        userId: actor.userId,
        at: now,
      }),
    () => ({
      actor,
      action: "settings.function_colors_changed",
      entityType: "setting",
      entityId: FUNCTION_COLORS_KEY,
      summary: `职能颜色改为 ${Object.entries(colors)
        .map(
          ([key, hex]) =>
            `${functionNames[key as keyof FunctionColors]} ${hex}`,
        )
        .join("、")}`,
      detail: colors,
    }),
  );
  return colors;
}
