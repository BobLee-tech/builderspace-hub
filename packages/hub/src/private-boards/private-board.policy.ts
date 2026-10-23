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
 * Whether `viewerId` may see a board that is set to 仅自己可见 and owned by
 * `ownerUserId`. Only the owner may; nobody may once the owner's account is
 * gone, and a signed-out visitor never may.
 */
export function canSeePrivateBoard(
  ownerUserId: string | null,
  viewerId: string | null,
): boolean {
  return ownerUserId !== null && ownerUserId === viewerId;
}

/**
 * Who may turn 仅自己可见 on or off. On: the person who created the board, so
 * nobody can hide someone else's board from them. Off: its owner.
 */
export function canChangeOnlyMe(
  board: {
    createdBy: string | null;
    privateTo: { ownerUserId: string | null } | null;
  },
  viewerId: string,
): boolean {
  return board.privateTo
    ? board.privateTo.ownerUserId === viewerId
    : board.createdBy === viewerId;
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
