import { describe, expect, it } from "vitest";

import {
  addDays,
  dayIndexAt,
  dragSpan,
  endDayOf,
  HOUR_HEIGHT,
  moveSpanTo,
  resizeSpanTo,
  segmentsOfDay,
  startOfWeek,
  timeAtOffset,
  weekDays,
} from "./schedule-layout";

// Local-time constructors throughout, so the tests hold in any time zone.
const local = (day: number, hour = 0, minute = 0) =>
  new Date(2026, 9, day, hour, minute);
const span = (startsAt: Date, endsAt: Date) => ({ startsAt, endsAt });

describe("week", () => {
  it("starts on Monday, including when the date is a Sunday", () => {
    // 2026-10-14 is a Wednesday, 2026-10-18 a Sunday.
    expect(startOfWeek(local(14, 15, 30))).toEqual(local(12));
    expect(startOfWeek(local(18, 23, 59))).toEqual(local(12));
    expect(startOfWeek(local(12))).toEqual(local(12));
  });

  it("lists seven days and moves between months", () => {
    const days = weekDays(local(26));
    expect(days).toHaveLength(7);
    expect(days[6]).toEqual(new Date(2026, 10, 1));
    expect(addDays(local(31), 1)).toEqual(new Date(2026, 10, 1));
  });
});

describe("timeAtOffset", () => {
  const day = local(14);

  it("snaps to quarter hours", () => {
    expect(timeAtOffset(day, 9 * HOUR_HEIGHT)).toEqual(local(14, 9));
    expect(timeAtOffset(day, 9.3 * HOUR_HEIGHT)).toEqual(local(14, 9, 15));
    expect(timeAtOffset(day, 9.1 * HOUR_HEIGHT)).toEqual(local(14, 9));
  });

  it("stays inside the day", () => {
    expect(timeAtOffset(day, -50)).toEqual(local(14, 0));
    expect(timeAtOffset(day, 30 * HOUR_HEIGHT)).toEqual(local(15, 0));
  });
});

describe("dayIndexAt", () => {
  it("maps a position across the grid to a column and clamps the ends", () => {
    expect(dayIndexAt(100, 100, 700)).toBe(0);
    expect(dayIndexAt(350, 100, 700)).toBe(2);
    expect(dayIndexAt(799, 100, 700)).toBe(6);
    expect(dayIndexAt(50, 100, 700)).toBe(0);
    expect(dayIndexAt(900, 100, 700)).toBe(6);
  });
});

describe("segmentsOfDay", () => {
  const day = local(14);

  it("positions a block by its hours", () => {
    const [segment] = segmentsOfDay([span(local(14, 9), local(14, 11))], day);
    expect(segment).toMatchObject({
      top: 9 * HOUR_HEIGHT,
      height: 2 * HOUR_HEIGHT,
      startsHere: true,
      endsHere: true,
      lane: 0,
      lanes: 1,
    });
  });

  it("leaves out blocks on other days, including ones that only touch", () => {
    const segments = segmentsOfDay(
      [
        span(local(13, 9), local(13, 10)),
        span(local(13, 22), local(14, 0)),
        span(local(15, 0), local(15, 1)),
      ],
      day,
    );
    expect(segments).toEqual([]);
  });

  it("cuts a block that crosses midnight into one piece per day", () => {
    const overnight = span(local(14, 22), local(15, 2));

    const [first] = segmentsOfDay([overnight], day);
    expect(first).toMatchObject({
      top: 22 * HOUR_HEIGHT,
      height: 2 * HOUR_HEIGHT,
      startsHere: true,
      endsHere: false,
    });
    const [second] = segmentsOfDay([overnight], local(15));
    expect(second).toMatchObject({
      top: 0,
      height: 2 * HOUR_HEIGHT,
      startsHere: false,
      endsHere: true,
    });
  });

  it("puts overlapping blocks side by side and gives separate blocks the full width", () => {
    const a = span(local(14, 9), local(14, 11));
    const b = span(local(14, 10), local(14, 12));
    const c = span(local(14, 10, 30), local(14, 11, 30));
    const later = span(local(14, 14), local(14, 15));

    const byBlock = new Map(
      segmentsOfDay([later, c, b, a], day).map((s) => [s.block, s]),
    );

    expect(byBlock.get(a)).toMatchObject({ lane: 0, lanes: 3 });
    expect(byBlock.get(b)).toMatchObject({ lane: 1, lanes: 3 });
    expect(byBlock.get(c)).toMatchObject({ lane: 2, lanes: 3 });
    expect(byBlock.get(later)).toMatchObject({ lane: 0, lanes: 1 });
  });

  it("reuses a lane once the block in it has ended", () => {
    const a = span(local(14, 9), local(14, 10));
    const b = span(local(14, 9), local(14, 12));
    const c = span(local(14, 10), local(14, 11));

    const byBlock = new Map(
      segmentsOfDay([a, b, c], day).map((s) => [s.block, s]),
    );

    // The longer block takes the first lane; c slots in where a has finished.
    expect(byBlock.get(b)).toMatchObject({ lane: 0, lanes: 2 });
    expect(byBlock.get(a)).toMatchObject({ lane: 1, lanes: 2 });
    expect(byBlock.get(c)).toMatchObject({ lane: 1, lanes: 2 });
  });

  it("keeps a very short block tall enough to click", () => {
    const [segment] = segmentsOfDay([span(local(14, 9), local(14, 9, 5))], day);
    expect(segment?.height).toBeGreaterThanOrEqual(20);
  });
});

describe("dragSpan", () => {
  it("orders the two ends whichever way the pointer went", () => {
    expect(dragSpan(local(14, 9), local(14, 11))).toEqual(
      span(local(14, 9), local(14, 11)),
    );
    expect(dragSpan(local(14, 11), local(14, 9))).toEqual(
      span(local(14, 9), local(14, 11)),
    );
  });

  it("turns a bare click into an hour", () => {
    expect(dragSpan(local(14, 9), local(14, 9))).toEqual(
      span(local(14, 9), local(14, 10)),
    );
  });
});

describe("moveSpanTo and resizeSpanTo", () => {
  const original = span(local(14, 9), local(14, 11));

  it("keeps the length when moving, even to another day", () => {
    expect(moveSpanTo(original, local(16, 13))).toEqual(
      span(local(16, 13), local(16, 15)),
    );
  });

  it("never resizes below one grid step", () => {
    expect(resizeSpanTo(original, local(14, 12))).toEqual(
      span(local(14, 9), local(14, 12)),
    );
    expect(resizeSpanTo(original, local(14, 8))).toEqual(
      span(local(14, 9), local(14, 9, 15)),
    );
  });
});

describe("endDayOf", () => {
  it("is the day the span's last piece sits on", () => {
    expect(endDayOf(span(local(14, 15), local(14, 17)))).toEqual(local(14));
    expect(endDayOf(span(local(14, 22), local(15, 2)))).toEqual(local(15));
  });

  it("counts a span ending at midnight as ending the day before", () => {
    expect(endDayOf(span(local(14, 22), local(15)))).toEqual(local(14));
  });
});

describe("drawing stays on one day", () => {
  // What the grid does: both ends of a new block are read on the day the
  // press started, so drifting sideways cannot stretch it across days.
  const day = local(14);
  const at = (hour: number) => timeAtOffset(day, hour * HOUR_HEIGHT);

  it("keeps a drag on its own day whatever the pointer's column", () => {
    const drawn = dragSpan(at(15), at(17));
    expect(drawn).toEqual(span(local(14, 15), local(14, 17)));
    expect(endDayOf(drawn)).toEqual(day);
  });

  it("can reach the end of the day but no further", () => {
    expect(dragSpan(at(23), timeAtOffset(day, 30 * HOUR_HEIGHT))).toEqual(
      span(local(14, 23), local(15)),
    );
  });
});
