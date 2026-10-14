export type HubErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "CONFLICT"
  | "FORBIDDEN"
  /** Something the Hub depends on (such as the website's database) did not answer. */
  | "UNAVAILABLE";

/**
 * An expected failure of a Hub use case, safe to show to the person who caused
 * it. The API layer maps `code` to a transport error; anything that is not a
 * HubError is a bug and must not leak its message.
 */
export class HubError extends Error {
  readonly code: HubErrorCode;

  constructor(code: HubErrorCode, message: string) {
    super(message);
    this.name = "HubError";
    this.code = code;
  }
}

export function isHubError(value: unknown): value is HubError {
  return value instanceof HubError;
}
