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

/**
 * Every board, list, card, label, checklist, checklist item, comment and
 * attachment a request's input names, wherever in the input it appears.
 */
export function collectBoardRefs(input: unknown): BoardRefs {
  const refs = emptyRefs();
  walk(input, 0, refs);
  return refs;
}

export function hasBoardRefs(refs: BoardRefs): boolean {
  return boardRefKinds.some((kind) => refs[kind].length > 0);
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

function emptyRefs(): BoardRefs {
  return Object.fromEntries(
    boardRefKinds.map((kind) => [kind, [] as string[]]),
  ) as BoardRefs;
}

function walk(value: unknown, depth: number, refs: BoardRefs): void {
  if (depth > MAX_DEPTH || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, depth + 1, refs);
    return;
  }
  for (const [key, field] of Object.entries(value)) {
    const kind = kindOf(key);
    if (kind) {
      for (const id of [field].flat()) {
        if (typeof id === "string" && id !== "") refs[kind].push(id);
      }
    } else {
      walk(field, depth + 1, refs);
    }
  }
}

function kindOf(key: string): BoardRefKind | undefined {
  const name = REF_FIELD.exec(key)?.[1]?.toLowerCase();
  return boardRefKinds.find((kind) => kind.toLowerCase() === name);
}
