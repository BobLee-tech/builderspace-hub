import { describe, expect, it } from "vitest";

import type { CardEvent } from "./archive.policy";
import {
  completionOf,
  countsForMe,
  isTimeZone,
  monthKey,
  monthsEndingAt,
} from "./archive.policy";

const at = (iso: string) => new Date(iso);
const moved = (
  iso: string,
  toStage: CardEvent["toStage"],
  by = "u1",
): CardEvent => ({ kind: "moved", toStage, by, at: at(iso) });
const created = (iso: string, by = "u1"): CardEvent => ({
  kind: "created",
  toStage: null,
  by,
  at: at(iso),
});

describe("completionOf", () => {
  it("takes the last move into a finished column", () => {
    expect(
      completionOf([
        moved("2026-10-01T00:00:00Z", "done", "a"),
        moved("2026-10-02T00:00:00Z", "doing", "b"),
        moved("2026-10-05T00:00:00Z", "done", "c"),
        moved("2026-10-03T00:00:00Z", "review", "d"),
      ]),
    ).toEqual({ at: at("2026-10-05T00:00:00Z"), by: "c" });
  });

  it("falls back to creation for a card made in the finished column", () => {
    expect(
      completionOf([
        created("2026-10-01T00:00:00Z", "a"),
        moved("2026-10-02T00:00:00Z", "doing"),
      ]),
    ).toEqual({ at: at("2026-10-01T00:00:00Z"), by: "a" });
  });

  it("prefers a move over creation, whatever the order of the list", () => {
    expect(
      completionOf([
        moved("2026-10-04T00:00:00Z", "done", "b"),
        created("2026-10-01T00:00:00Z", "a"),
      ]),
    ).toEqual({ at: at("2026-10-04T00:00:00Z"), by: "b" });
  });

  it("is null when nothing in the history says", () => {
    expect(completionOf([])).toBeNull();
    expect(completionOf([moved("2026-10-02T00:00:00Z", "doing")])).toBeNull();
  });
});

describe("countsForMe", () => {
  it("gives assigned tasks to their assignees only", () => {
    const base = { hasAssignees: true, finishedBy: "me", userId: "me" };
    expect(countsForMe({ ...base, assignedToMe: true })).toBe(true);
    expect(countsForMe({ ...base, assignedToMe: false })).toBe(false);
  });

  it("gives an unassigned task to whoever finished it", () => {
    const base = { hasAssignees: false, assignedToMe: false, userId: "me" };
    expect(countsForMe({ ...base, finishedBy: "me" })).toBe(true);
    expect(countsForMe({ ...base, finishedBy: "someone" })).toBe(false);
    expect(countsForMe({ ...base, finishedBy: null })).toBe(false);
  });
});

describe("months", () => {
  it("reads the month on the viewer's wall clock", () => {
    // 2026-09-30 15:30 UTC is already October in Sydney, still September in LA.
    const instant = at("2026-09-30T15:30:00Z");
    expect(monthKey(instant, "Australia/Sydney")).toBe("2026-10");
    expect(monthKey(instant, "UTC")).toBe("2026-09");
    expect(monthKey(instant, "America/Los_Angeles")).toBe("2026-09");
  });

  it("lists months backwards across a year boundary, oldest first", () => {
    expect(monthsEndingAt("2026-02", 4)).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
    expect(monthsEndingAt("2026-10", 1)).toEqual(["2026-10"]);
  });

  it("knows real time zones from made-up ones", () => {
    expect(isTimeZone("Australia/Sydney")).toBe(true);
    expect(isTimeZone("UTC")).toBe(true);
    expect(isTimeZone("Mars/Olympus_Mons")).toBe(false);
  });
});
