import type { HubErrorCode } from "./errors";

/**
 * What the command line's REST handlers (`documents/rest.ts`,
 * `private-boards/rest.ts`) take and give back. The Next.js routes turn HTTP
 * into this and back; the handlers never see a request object.
 */
export interface RestRequest {
  method: string;
  /** The path after the API's base (/documents, /boards), split on "/". */
  segments: string[];
  query: Record<string, string | undefined>;
  body: unknown;
}

export interface RestResponse {
  status: number;
  body: unknown;
}

const STATUS_OF: Record<HubErrorCode, number> = {
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  FORBIDDEN: 403,
  UNAVAILABLE: 503,
};

export function statusOfHubError(code: HubErrorCode): number {
  return STATUS_OF[code];
}
