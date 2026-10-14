import { describe, expect, it } from "vitest";

import {
  DEFAULT_FUNCTION_COLORS,
  functionColorPalette,
  isHexColor,
  readFunctionColors,
  validateFunctionColors,
} from "./function-colors.policy";

describe("readFunctionColors", () => {
  it("uses the defaults when nothing was stored", () => {
    expect(readFunctionColors(undefined)).toEqual(DEFAULT_FUNCTION_COLORS);
    expect(readFunctionColors("nonsense")).toEqual(DEFAULT_FUNCTION_COLORS);
  });

  it("keeps good values and replaces bad ones one by one", () => {
    expect(
      readFunctionColors({ dev: "#9a86d1", ops: "red", marketing: 7 }),
    ).toEqual({
      dev: "#9A86D1",
      ops: DEFAULT_FUNCTION_COLORS.ops,
      marketing: DEFAULT_FUNCTION_COLORS.marketing,
    });
  });
});

describe("validateFunctionColors", () => {
  it("accepts three #RRGGBB colours", () => {
    expect(
      validateFunctionColors({
        dev: "#111111",
        ops: "#222222",
        marketing: "#abcdef",
      }),
    ).toEqual({
      ok: true,
      colors: { dev: "#111111", ops: "#222222", marketing: "#ABCDEF" },
    });
  });

  it("refuses anything else, including markup", () => {
    for (const bad of ["#12345", "blue", "#12345g", "url(x)", "</style>"]) {
      expect(
        validateFunctionColors({
          dev: bad,
          ops: "#222222",
          marketing: "#333333",
        }),
      ).toEqual({ ok: false, reason: "颜色要写成 #RRGGBB 的形式" });
    }
  });
});

describe("the palette", () => {
  it("only offers valid colours and includes every default", () => {
    expect(functionColorPalette.every((c) => isHexColor(c.hex))).toBe(true);
    const hexes = functionColorPalette.map((c) => c.hex);
    for (const hex of Object.values(DEFAULT_FUNCTION_COLORS)) {
      expect(hexes).toContain(hex);
    }
  });
});
