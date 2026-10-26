/** The things a request can name that live inside one board. */
export const boardRefKinds = [
  "board",
  "list",
  "card",
  "label",
  "checklist",
  "checklistItem",
  "comment",
  "attachment",
] as const;
export type BoardRefKind = (typeof boardRefKinds)[number];

/** Public ids a request names, by what they name. */
export type BoardRefs = Record<BoardRefKind, string[]>;

// Matched on the end of the field name, so prefixed fields such as Kan's
// `sourceBoardPublicId` count too, and a field upstream adds later
// (`targetListPublicId`, say) is guarded without anyone remembering to list
// it. `checklistItem` comes before `checklist` so the longer name wins.
const REF_FIELD = new RegExp(
  `(${[...boardRefKinds]
    .sort((a, b) => b.length - a.length)
    .join("|")})PublicIds?$`,
  "i",
);

// Kan's inputs are flat objects; a little depth covers arrays of objects
// without walking anything unbounded.
const MAX_DEPTH = 4;

// Every table these ids point into stores them as varchar(12), so a longer
// string cannot name anything and is not looked up.
const PUBLIC_ID_MAX_LENGTH = 12;

/**
 * More distinct ids than any real request carries. The guard reads the raw
 * input, before the procedure's own validation, so without a cap anyone could
 * make it look up thousands of ids; collecting stops just past this and the
 * request is refused without a query.
 */
export const MAX_BOARD_REFS = 200;

/**
 * Every board, list, card, label, checklist, checklist item, comment and
 * attachment a request's input names, wherever in the input it appears, each
 * id once. Stops collecting once there are more than `MAX_BOARD_REFS`.
 */
export function collectBoardRefs(input: unknown): BoardRefs {
  const found = Object.fromEntries(
    boardRefKinds.map((kind) => [kind, new Set<string>()]),
  ) as Record<BoardRefKind, Set<string>>;
  walk(input, 0, { found, total: 0 });
  return Object.fromEntries(
    boardRefKinds.map((kind) => [kind, [...found[kind]]]),
  ) as BoardRefs;
}

export function countBoardRefs(refs: BoardRefs): number {
  return boardRefKinds.reduce((total, kind) => total + refs[kind].length, 0);
}

/**
 * Who a private board is for, beyond Kan's own rules: 仅自己可见 (`owner`) or
 * 仅管理员可见 (`admins`, whoever is a project admin at the time).
 */
export const boardAudiences = ["owner", "admins"] as const;
export type BoardAudience = (typeof boardAudiences)[number];

/** A board set to 仅自己可见 or 仅管理员可见. */
export interface PrivateBoard {
  audience: BoardAudience;
  /** Who set it; for 仅自己可见, the only person who may see it. */
  ownerUserId: string | null;
  workspaceId: number;
}

/** The person asking, or a signed-out visitor, and the projects they run. */
export interface BoardViewer {
  id: string | null;
  adminOf: ReadonlySet<number>;
}

/**
 * Whether `viewer` may see a private board. 仅自己可见: only its owner; nobody
 * once the owner's account is gone. 仅管理员可见: the admins of its project,
 * whoever they are now. A signed-out visitor never may.
 */
export function canSeePrivateBoard(
  board: PrivateBoard,
  viewer: BoardViewer,
): boolean {
  if (viewer.id === null) return false;
  return board.audience === "admins"
    ? viewer.adminOf.has(board.workspaceId)
    : board.ownerUserId === viewer.id;
}

/**
 * Whether `viewer` may move a board from where it is (`current`, null for
 * every project member) to `target`. They must be allowed to leave the one and
 * enter the other:
 *
 * - leave 仅自己可见: its owner; leave 仅管理员可见: a project admin;
 * - enter 仅自己可见: the board's creator, so nobody can hide someone else's
 *   board from them; enter 仅管理员可见: a project admin.
 *
 * Going back to every member needs nothing more than leaving. Staying where
 * it is is not a move.
 */
export function canSwitchAudience(
  board: {
    workspaceId: number;
    createdBy: string | null;
    private: { audience: BoardAudience; ownerUserId: string | null } | null;
  },
  viewer: { id: string; adminOf: ReadonlySet<number> },
  target: BoardAudience | null,
): boolean {
  const current = board.private?.audience ?? null;
  if (target === current) return false;
  const isAdmin = viewer.adminOf.has(board.workspaceId);
  const mayLeave =
    current === null ||
    (current === "owner" ? board.private?.ownerUserId === viewer.id : isAdmin);
  const mayEnter =
    target === null ||
    (target === "owner" ? board.createdBy === viewer.id : isAdmin);
  return mayLeave && mayEnter;
}

/**
 * The board a request would put on Kan's public link, if it is one: Kan's
 * `board.update` with `visibility: "public"`.
 */
export function boardBeingPublished(
  path: string,
  input: unknown,
): string | undefined {
  if (path !== "board.update" || !isRecord(input)) return undefined;
  const { visibility, boardPublicId } = input;
  return visibility === "public" && typeof boardPublicId === "string"
    ? boardPublicId
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface Collecting {
  found: Record<BoardRefKind, Set<string>>;
  total: number;
}

const isFull = (state: Collecting) => state.total > MAX_BOARD_REFS;

function walk(value: unknown, depth: number, state: Collecting): void {
  if (depth > MAX_DEPTH || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (isFull(state)) return;
      walk(item, depth + 1, state);
    }
    return;
  }
  for (const [key, field] of Object.entries(value)) {
    if (isFull(state)) return;
    const kind = kindOf(key);
    if (kind) {
      for (const id of [field].flat()) {
        if (isFull(state)) return;
        if (!isPublicId(id) || state.found[kind].has(id)) continue;
        state.found[kind].add(id);
        state.total += 1;
      }
    } else {
      walk(field, depth + 1, state);
    }
  }
}

function isPublicId(id: unknown): id is string {
  return (
    typeof id === "string" && id.length > 0 && id.length <= PUBLIC_ID_MAX_LENGTH
  );
}

function kindOf(key: string): BoardRefKind | undefined {
  const name = REF_FIELD.exec(key)?.[1]?.toLowerCase();
  return boardRefKinds.find((kind) => kind.toLowerCase() === name);
}
