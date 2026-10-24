import { describe, expect, it } from "vitest";

import type { AssignedTask } from "./nudge.policy";
import {
  idleDays,
  mailOrder,
  nudgeLimitKey,
  STALE_AFTER_DAYS,
  stuckPeople,
  stuckReason,
} from "./nudge.policy";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-10-24T02:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY);

function task(overrides: Partial<AssignedTask> = {}): AssignedTask {
  return {
    title: "任务",
    stage: "doing",
    dueState: "none",
    dueDate: null,
    lastTouchedAt: daysAgo(0),
    assigneeIds: ["ann"],
    ...overrides,
  };
}

describe("idleDays", () => {
  it("counts whole days since the last touch, never below zero", () => {
    expect(idleDays(daysAgo(2.9), now)).toBe(2);
    expect(idleDays(daysAgo(3), now)).toBe(3);
    expect(idleDays(new Date(now.getTime() + DAY), now)).toBe(0);
  });
});

describe("stuckReason", () => {
  it("calls an open task stuck once nobody touched it for three days", () => {
    expect(STALE_AFTER_DAYS).toBe(3);
    expect(stuckReason(task({ lastTouchedAt: daysAgo(2.9) }), now)).toBeNull();
    expect(stuckReason(task({ lastTouchedAt: daysAgo(5) }), now)).toEqual({
      kind: "idle",
      days: 5,
    });
  });

  it("calls an overdue task stuck even if someone touched it today", () => {
    expect(stuckReason(task({ dueState: "overdue" }), now)).toEqual({
      kind: "overdue",
    });
  });

  it("never calls a finished task stuck", () => {
    expect(
      stuckReason(
        task({ stage: "done", dueState: "overdue", lastTouchedAt: daysAgo(9) }),
        now,
      ),
    ).toBeNull();
  });
});

describe("stuckPeople", () => {
  it("lists everyone with a stuck task, but never the viewer", () => {
    const people = stuckPeople(
      [
        task({ assigneeIds: ["ann", "me"], lastTouchedAt: daysAgo(4) }),
        task({ assigneeIds: ["bob"], lastTouchedAt: daysAgo(1) }),
      ],
      "me",
      now,
    );

    expect(people.map((p) => p.userId)).toEqual(["ann"]);
  });

  it("counts all of a person's open tasks, and picks the most stuck one", () => {
    const [ann] = stuckPeople(
      [
        task({ title: "刚动过" }),
        task({ title: "放了 4 天", lastTouchedAt: daysAgo(4) }),
        task({ title: "放了 6 天", lastTouchedAt: daysAgo(6) }),
        task({ title: "做完了", stage: "done", lastTouchedAt: daysAgo(30) }),
      ],
      "me",
      now,
    );

    expect(ann?.openCount).toBe(3);
    expect(ann?.headline.task.title).toBe("放了 6 天");
    expect(ann?.headline.stuck).toEqual({ kind: "idle", days: 6 });
  });

  it("puts overdue before idle, the longest overdue first", () => {
    const people = stuckPeople(
      [
        task({ assigneeIds: ["idle"], lastTouchedAt: daysAgo(20) }),
        task({
          assigneeIds: ["late"],
          dueState: "overdue",
          dueDate: daysAgo(1),
        }),
        task({
          assigneeIds: ["later"],
          dueState: "overdue",
          dueDate: daysAgo(3),
        }),
      ],
      "me",
      now,
    );

    expect(people.map((p) => p.userId)).toEqual(["later", "late", "idle"]);
  });

  it("ignores tasks nobody is assigned to", () => {
    expect(
      stuckPeople(
        [task({ assigneeIds: [], lastTouchedAt: daysAgo(9) })],
        "me",
        now,
      ),
    ).toEqual([]);
  });
});

describe("mailOrder", () => {
  it("puts the soonest due first, undated last, the longest untouched first among equals", () => {
    const ordered = mailOrder([
      task({ title: "没日期，昨天动过", lastTouchedAt: daysAgo(1) }),
      task({ title: "下周到期", dueDate: new Date(now.getTime() + 7 * DAY) }),
      task({ title: "没日期，放了一周", lastTouchedAt: daysAgo(7) }),
      task({ title: "已逾期", dueDate: daysAgo(2) }),
    ]);

    expect(ordered.map((t) => t.title)).toEqual([
      "已逾期",
      "下周到期",
      "没日期，放了一周",
      "没日期，昨天动过",
    ]);
  });
});

describe("nudgeLimitKey", () => {
  it("is keyed by the recipient alone, never by who asked", () => {
    expect(nudgeLimitKey("ann")).toBe("hub:nudge:ann");
  });
});
