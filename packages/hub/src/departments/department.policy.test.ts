import { describe, expect, it } from "vitest";

import {
  departmentRef,
  effectiveDepartments,
  normaliseDepartmentName,
  swapForMove,
} from "./department.policy";

describe("normaliseDepartmentName", () => {
  it("trims, collapses spaces and refuses empty or long names", () => {
    expect(normaliseDepartmentName("  产品  设计 ")).toBe("产品 设计");
    expect(normaliseDepartmentName("   ")).toBeNull();
    expect(normaliseDepartmentName("部".repeat(20))).toBe("部".repeat(20));
    expect(normaliseDepartmentName("部".repeat(21))).toBeNull();
  });
});

describe("effectiveDepartments", () => {
  it("counts a department only in projects the person is still in", () => {
    expect(
      effectiveDepartments({
        rows: [
          { workspaceId: 1, departmentId: 10 },
          { workspaceId: 2, departmentId: 10 },
        ],
        activeProjectIds: new Set([1]),
      }),
    ).toEqual(new Set([departmentRef(1, 10)]));
  });
});

describe("swapForMove", () => {
  const list = [
    { id: 1, position: 1 },
    { id: 2, position: 2 },
    { id: 3, position: 5 },
  ];

  it("swaps positions with the neighbour", () => {
    expect(swapForMove(list, 3, "up")).toEqual([
      { id: 3, position: 2 },
      { id: 2, position: 5 },
    ]);
    expect(swapForMove(list, 1, "down")).toEqual([
      { id: 1, position: 2 },
      { id: 2, position: 1 },
    ]);
  });

  it("does nothing at either end or for an unknown id", () => {
    expect(swapForMove(list, 1, "up")).toBeNull();
    expect(swapForMove(list, 3, "down")).toBeNull();
    expect(swapForMove(list, 9, "up")).toBeNull();
  });
});
