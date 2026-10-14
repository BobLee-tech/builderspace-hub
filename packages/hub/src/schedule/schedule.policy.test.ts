import { describe, expect, it } from "vitest";

import {
  isManualKind,
  MAX_BLOCK_MS,
  MAX_WINDOW_MS,
  MIN_BLOCK_MS,
  normaliseTitle,
  overlapsWindow,
  rangeProblem,
  windowProblem,
} from "./schedule.policy";

const at = (hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 9, 14, hour, minute));

describe("rangeProblem", () => {
  it("accepts an ordinary block", () => {
    expect(rangeProblem(at(9), at(10))).toBeNull();
  });

  it("refuses an end that is not after the start", () => {
    expect(rangeProblem(at(10), at(9))).not.toBeNull();
    expect(rangeProblem(at(10), at(10))).not.toBeNull();
  });

  it("refuses an invalid date", () => {
    expect(rangeProblem(new Date("nope"), at(10))).not.toBeNull();
  });

  it("holds the length between five minutes and seven days", () => {
    const start = at(9);
    const after = (ms: number) => new Date(start.getTime() + ms);
    expect(rangeProblem(start, after(MIN_BLOCK_MS - 1))).not.toBeNull();
    expect(rangeProblem(start, after(MIN_BLOCK_MS))).toBeNull();
    expect(rangeProblem(start, after(MAX_BLOCK_MS))).toBeNull();
    expect(rangeProblem(start, after(MAX_BLOCK_MS + 1))).not.toBeNull();
  });
});

describe("windowProblem", () => {
  it("accepts a week and refuses a backwards or enormous window", () => {
    const from = at(0);
    expect(
      windowProblem(from, new Date(from.getTime() + 7 * 86_400_000)),
    ).toBeNull();
    expect(windowProblem(from, from)).not.toBeNull();
    expect(
      windowProblem(from, new Date(from.getTime() + MAX_WINDOW_MS + 1)),
    ).not.toBeNull();
  });
});

describe("normaliseTitle", () => {
  it("trims, and treats blank as no title", () => {
    expect(normaliseTitle("  组会 ")).toBe("组会");
    expect(normaliseTitle("   ")).toBeNull();
    expect(normaliseTitle(null)).toBeNull();
    expect(normaliseTitle(undefined)).toBeNull();
  });
});

describe("overlapsWindow", () => {
  const window = { from: at(9), to: at(17) };
  const overlaps = (startsAt: Date, endsAt: Date) =>
    overlapsWindow({ startsAt, endsAt }, window.from, window.to);

  it("counts a block that starts before or ends after the window", () => {
    expect(overlaps(at(8), at(10))).toBe(true);
    expect(overlaps(at(16), at(18))).toBe(true);
    expect(overlaps(at(8), at(18))).toBe(true);
    expect(overlaps(at(11), at(12))).toBe(true);
  });

  it("does not count blocks that only touch the window", () => {
    expect(overlaps(at(7), at(9))).toBe(false);
    expect(overlaps(at(17), at(18))).toBe(false);
  });
});

describe("isManualKind", () => {
  it("is true for the kinds people draw and false for task blocks", () => {
    expect(isManualKind("free")).toBe(true);
    expect(isManualKind("busy")).toBe(true);
    expect(isManualKind("meeting")).toBe(true);
    expect(isManualKind("task")).toBe(false);
  });
});
