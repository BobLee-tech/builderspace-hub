import { TRPCError } from "@trpc/server";

import { isHubError } from "@kan/hub/shared";

// Kept apart from procedures.ts, which imports ../../trpc: the private-board
// guard runs inside trpc.ts itself and needs this without the cycle.

const HUB_ERROR_CODES = {
  INVALID_INPUT: "BAD_REQUEST",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  FORBIDDEN: "FORBIDDEN",
  UNAVAILABLE: "SERVICE_UNAVAILABLE",
} as const;

/**
 * Runs a Hub use case and turns its expected failures into tRPC errors with
 * the use case's own message. Anything else is a bug and is re-thrown as is.
 */
export async function runHub<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isHubError(error)) {
      throw new TRPCError({
        code: HUB_ERROR_CODES[error.code],
        message: error.message,
      });
    }
    throw error;
  }
}
