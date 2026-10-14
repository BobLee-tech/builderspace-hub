/**
 * Geometry of the week view, with no React in it: which pixel is which time,
 * how a block that crosses midnight is cut per day, and how overlapping blocks
 * share a day's width.
 *
 * Everything is in the viewer's local time, the way a wall calendar reads. A
 * day is 24 wall-clock hours, so a daylight-saving day is drawn 24 hours long.
 */

export const HOUR_HEIGHT = 48;
export const DAY_HEIGHT = HOUR_HEIGHT * 24;
export const SNAP_MINUTES = 15;
const MINUTE_MS = 60 * 1000;
const DAY_MINUTES = 24 * 60;

/** Blocks are never drawn shorter than this, so a 15-minute slot stays clickable. */
const MIN_SEGMENT_HEIGHT = 20;

export interface Span {
  startsAt: Date;
  endsAt: Date;
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Monday 00:00 of the week containing `date`. */
export function startOfWeek(date: Date): Date {
  const sinceMonday = (date.getDay() + 6) % 7;
  return addDays(startOfDay(date), -sinceMonday);
}

export function weekDays(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

/** The wall-clock time `minutes` after `day`'s midnight. 1440 is the next midnight. */
function atMinutes(day: Date, minutes: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes);
}

function snapMinutes(minutes: number): number {
  return Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
}

/** The time at a vertical offset inside `day`'s column, snapped to the grid. */
export function timeAtOffset(day: Date, y: number): Date {
  const minutes = snapMinutes((y / HOUR_HEIGHT) * 60);
  return atMinutes(day, Math.min(DAY_MINUTES, Math.max(0, minutes)));
}

/** Which of the week's seven columns a horizontal position falls in. */
export function dayIndexAt(x: number, left: number, width: number): number {
  const index = Math.floor(((x - left) / width) * 7);
  return Math.min(6, Math.max(0, index));
}

/** Minutes from `day`'s midnight to `time`, held to the day's own 0–1440. */
function minutesInto(day: Date, time: Date): number {
  const dayStart = startOfDay(day);
  const next = addDays(dayStart, 1);
  if (time <= dayStart) return 0;
  if (time >= next) return DAY_MINUTES;
  return time.getHours() * 60 + time.getMinutes();
}

export interface Segment<T extends Span> {
  block: T;
  top: number;
  height: number;
  /** False when the block began on an earlier day. */
  startsHere: boolean;
  /** False when the block carries on past midnight. */
  endsHere: boolean;
  /** Which of `lanes` side-by-side columns this block sits in. */
  lane: number;
  lanes: number;
}

/**
 * The pieces of `blocks` that fall on `day`, positioned in pixels. Blocks that
 * overlap in time are put side by side instead of on top of each other.
 */
export function segmentsOfDay<T extends Span>(
  blocks: readonly T[],
  day: Date,
): Segment<T>[] {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);

  const pieces = blocks
    .filter((block) => block.startsAt < dayEnd && block.endsAt > dayStart)
    .map((block) => {
      const from = minutesInto(day, block.startsAt);
      const to = minutesInto(day, block.endsAt);
      const top = (from / 60) * HOUR_HEIGHT;
      return {
        block,
        from,
        to,
        top,
        height: Math.max(MIN_SEGMENT_HEIGHT, ((to - from) / 60) * HOUR_HEIGHT),
        startsHere: block.startsAt >= dayStart,
        endsHere: block.endsAt <= dayEnd,
        lane: 0,
        lanes: 1,
      };
    })
    .sort((a, b) => a.from - b.from || b.to - a.to);

  // A cluster is a run of blocks that overlap one another, directly or through
  // a chain; the cluster's lane count is the width everyone in it shares.
  let cluster: typeof pieces = [];
  let laneEnds: number[] = [];
  let clusterEnd = 0;
  const closeCluster = () => {
    for (const piece of cluster) piece.lanes = laneEnds.length;
    cluster = [];
    laneEnds = [];
    clusterEnd = 0;
  };

  for (const piece of pieces) {
    const bottom = piece.top + piece.height;
    if (cluster.length > 0 && piece.top >= clusterEnd) closeCluster();
    let lane = laneEnds.findIndex((end) => end <= piece.top);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(bottom);
    } else {
      laneEnds[lane] = bottom;
    }
    piece.lane = lane;
    cluster.push(piece);
    clusterEnd = Math.max(clusterEnd, bottom);
  }
  closeCluster();

  return pieces.map(
    ({ block, top, height, startsHere, endsHere, lane, lanes }) => ({
      block,
      top,
      height,
      startsHere,
      endsHere,
      lane,
      lanes,
    }),
  );
}

const SNAP_MS = SNAP_MINUTES * MINUTE_MS;
const DEFAULT_MS = 60 * MINUTE_MS;

/** The span dragged out between two times, in either direction. A bare click makes an hour. */
export function dragSpan(anchor: Date, current: Date): Span {
  if (anchor.getTime() === current.getTime()) {
    return {
      startsAt: anchor,
      endsAt: new Date(anchor.getTime() + DEFAULT_MS),
    };
  }
  const [startsAt, endsAt] =
    anchor < current ? [anchor, current] : [current, anchor];
  return {
    startsAt,
    endsAt:
      endsAt.getTime() - startsAt.getTime() < SNAP_MS
        ? new Date(startsAt.getTime() + SNAP_MS)
        : endsAt,
  };
}

/** `span` shifted so it starts at `startsAt`, keeping its length. */
export function moveSpanTo(span: Span, startsAt: Date): Span {
  const length = span.endsAt.getTime() - span.startsAt.getTime();
  return { startsAt, endsAt: new Date(startsAt.getTime() + length) };
}

/** `span` with a new end, never shorter than one grid step. */
export function resizeSpanTo(span: Span, endsAt: Date): Span {
  const earliest = span.startsAt.getTime() + SNAP_MS;
  return {
    startsAt: span.startsAt,
    endsAt: new Date(Math.max(earliest, endsAt.getTime())),
  };
}
