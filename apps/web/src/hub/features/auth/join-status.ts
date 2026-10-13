/** What `/api/hub/join-status` returns for a registration link. */
export type JoinStatus =
  | { state: "valid"; email: string }
  | { state: "invalid" | "expired" | "consumed" | "revoked" };

export const JOIN_STATUS_PATH = "/api/hub/join-status";
