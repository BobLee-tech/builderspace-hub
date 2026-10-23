import { vi } from "vitest";

import type * as PrivateBoards from "./private-boards";

/**
 * Kan's own router tests hand the procedures a stand-in database (no
 * `select`) and mock modules such as `@kan/shared/utils`, which the Hub's
 * private-board code needs just to load. For those tests the 仅自己可见 guard
 * and filters step aside; every test with a real database (the Hub's
 * integration tests) gets the real ones, loaded only then.
 */
vi.mock("./private-boards", () => {
  const isRealDb = (db: unknown) =>
    typeof (db as { select?: unknown } | null)?.select === "function";
  const real = () => vi.importActual<typeof PrivateBoards>("./private-boards");

  return {
    guardPrivateBoards: async (
      ...args: Parameters<typeof PrivateBoards.guardPrivateBoards>
    ) => {
      if (isRealDb(args[0])) await (await real()).guardPrivateBoards(...args);
    },
    visibleBoardsOnly: async (
      ...args: Parameters<typeof PrivateBoards.visibleBoardsOnly>
    ) =>
      isRealDb(args[0])
        ? (await real()).visibleBoardsOnly(...args)
        : [...args[2]],
    visibleSearchResultsOnly: async (
      ...args: Parameters<typeof PrivateBoards.visibleSearchResultsOnly>
    ) =>
      isRealDb(args[0])
        ? (await real()).visibleSearchResultsOnly(...args)
        : [...args[2]],
  };
});
