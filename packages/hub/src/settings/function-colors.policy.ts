import type { FunctionKey } from "../tasks/task.policy";
import { functionKeys } from "../tasks/task.policy";

/**
 * The colour each function (技术 / 活动 / 运营) is shown in. Pure: shared by
 * the server, which validates and stores it, and the browser, which paints
 * with it and falls back to the defaults while loading.
 */

export type FunctionColors = Record<FunctionKey, string>;

/** Soft, muted defaults that sit quietly on the black-and-white design. */
export const DEFAULT_FUNCTION_COLORS: FunctionColors = {
  dev: "#6B8FD6",
  ops: "#5BA68A",
  marketing: "#D9925B",
};

/** A small palette of equally soft colours to pick from in the back office. */
export const functionColorPalette: readonly { name: string; hex: string }[] = [
  { name: "雾蓝", hex: "#6B8FD6" },
  { name: "鼠尾草绿", hex: "#5BA68A" },
  { name: "杏橙", hex: "#D9925B" },
  { name: "薰衣草", hex: "#9A86D1" },
  { name: "玫瑰灰", hex: "#C77F95" },
  { name: "青瓷", hex: "#4FA3A5" },
  { name: "芥末黄", hex: "#C9A646" },
  { name: "珊瑚", hex: "#D7776B" },
  { name: "苔绿", hex: "#8AA35A" },
  { name: "石板灰", hex: "#7C8796" },
];

const HEX = /^#[0-9a-f]{6}$/i;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

/**
 * Reads whatever is stored. Anything missing or malformed falls back to the
 * default for that function, so a bad value can never break a page.
 */
export function readFunctionColors(stored: unknown): FunctionColors {
  const source =
    typeof stored === "object" && stored !== null
      ? (stored as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    functionKeys.map((key) => {
      const value = source[key];
      return [
        key,
        isHexColor(value) ? value.toUpperCase() : DEFAULT_FUNCTION_COLORS[key],
      ];
    }),
  ) as FunctionColors;
}

/** Checks a full set of colours before it is saved. */
export function validateFunctionColors(
  input: Record<string, unknown>,
): { ok: true; colors: FunctionColors } | { ok: false; reason: string } {
  for (const key of functionKeys) {
    if (!isHexColor(input[key])) {
      return { ok: false, reason: "颜色要写成 #RRGGBB 的形式" };
    }
  }
  return { ok: true, colors: readFunctionColors(input) };
}
