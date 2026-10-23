import { FORM_TOKEN_HEADER, FORM_VOTER_HEADER } from "@kan/hub/public";

import { copy } from "~/hub/copy/zh";

/**
 * The browser side of `/api/hub/forms`: the fill page, the results wall and
 * picture uploads. Plain fetch rather than tRPC, because these pages work
 * without signing in (a tRPC call that comes back UNAUTHORIZED sends the
 * browser to the login page).
 *
 * Two secrets live in this browser's storage, never in a URL: the edit
 * token for an anonymous answer (per form), and a random key that makes an
 * anonymous like count once. Storage can be missing or refused (private
 * windows), so every access is guarded; the page still works without it.
 */

const tokenKey = (formId: string) => `hub-form-token:${formId}`;
const draftKey = (formId: string) => `hub-form-draft:${formId}`;
const VOTER_KEY = "hub-form-voter";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage refused: the page keeps working, only without memory.
  }
}

export const editTokenFor = (formId: string) => read(tokenKey(formId));

export function rememberEditToken(formId: string, token: string | null): void {
  if (token) write(tokenKey(formId), token);
}

function randomKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** This browser's like key, made on first use. */
export function browserKey(): string {
  const existing = read(VOTER_KEY);
  if (existing) return existing;
  const fresh = randomKey();
  write(VOTER_KEY, fresh);
  return fresh;
}

/** Unsent answers, kept so a reload or a closed tab does not lose them. */
export function loadDraft<T>(formId: string): T | null {
  const raw = read(draftKey(formId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function saveDraft(formId: string, value: unknown): void {
  write(draftKey(formId), JSON.stringify(value));
}

export function clearDraft(formId: string): void {
  write(draftKey(formId), null);
}

export class FormApiError extends Error {
  readonly status: number;
  readonly fieldErrors: Record<string, string>;

  constructor(
    status: number,
    message: string,
    fieldErrors: Record<string, string> = {},
  ) {
    super(message);
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

function secretHeaders(formId: string | null): Record<string, string> {
  const headers: Record<string, string> = { [FORM_VOTER_HEADER]: browserKey() };
  const token = formId ? editTokenFor(formId) : null;
  if (token) headers[FORM_TOKEN_HEADER] = token;
  return headers;
}

async function errorOf(response: Response): Promise<FormApiError> {
  if (response.status === 429) {
    return new FormApiError(429, copy.forms.fill.rateLimited);
  }
  const body = (await response.json().catch(() => null)) as {
    message?: string;
    fieldErrors?: Record<string, string>;
  } | null;
  return new FormApiError(
    response.status,
    body?.message ?? copy.forms.fill.networkError,
    body?.fieldErrors ?? {},
  );
}

/** Parts after `/api/hub/forms/`: public ids (`generateUID`) and fixed words. */
const FORM_API_PATH = /^[a-z0-9]{1,32}(\/[a-z0-9]{1,32}){0,3}$/;

/**
 * `/api/hub/forms/<formId>/<rest…>`. The form id comes from the address
 * bar, so a crafted link could otherwise point the request at another Hub
 * endpoint (`../`); anything that is not a plain id is treated as no form.
 */
function formUrl(formId: string, rest: readonly string[]): string {
  const path = [formId, ...rest].join("/");
  if (!FORM_API_PATH.test(path)) {
    throw new FormApiError(404, copy.forms.fill.notFound);
  }
  return `/api/hub/forms/${path}`;
}

/**
 * Calls `/api/hub/forms/<formId>/<rest…>` with this browser's secrets for
 * the form. Throws FormApiError with the server's message (and field errors).
 */
export async function formApi<T>(
  formId: string,
  rest: readonly string[],
  init: {
    method?: string;
    json?: unknown;
    query?: Record<string, string>;
  } = {},
): Promise<T> {
  const url = formUrl(formId, rest);
  const query = init.query
    ? `?${new URLSearchParams(init.query).toString()}`
    : "";
  let response: Response;
  try {
    response = await fetch(`${url}${query}`, {
      method: init.method ?? "GET",
      credentials: "same-origin",
      headers: {
        ...secretHeaders(formId),
        ...(init.json === undefined
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body: init.json === undefined ? undefined : JSON.stringify(init.json),
    });
  } catch {
    throw new FormApiError(0, copy.forms.fill.networkError);
  }
  if (!response.ok) throw await errorOf(response);
  return (await response.json()) as T;
}

export interface UploadedImage {
  publicId: string;
  width: number;
  height: number;
}

/**
 * Sends one (already shrunk) picture. XMLHttpRequest rather than fetch,
 * because only it reports upload progress, which matters on a phone.
 */
export function uploadFormImage(input: {
  formId: string;
  purpose: "asset" | "answer";
  fieldId?: string;
  blob: Blob;
  onProgress?: (percent: number) => void;
}): Promise<UploadedImage> {
  const query = new URLSearchParams({ purpose: input.purpose });
  if (input.fieldId) query.set("field", input.fieldId);
  return new Promise((resolve, reject) => {
    const url = formUrl(input.formId, ["images"]);
    const request = new XMLHttpRequest();
    request.open("POST", `${url}?${query.toString()}`);
    request.withCredentials = true;
    request.setRequestHeader("Content-Type", input.blob.type || "image/jpeg");
    for (const [name, value] of Object.entries(secretHeaders(input.formId))) {
      request.setRequestHeader(name, value);
    }
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        input.onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    };
    request.onerror = () =>
      reject(new FormApiError(0, copy.forms.fill.networkError));
    request.onload = () => {
      let body: { message?: string } & Partial<UploadedImage> = {};
      try {
        body = JSON.parse(request.responseText) as typeof body;
      } catch {
        // A proxy's error page: fall through to the generic message.
      }
      if (request.status === 201 && body.publicId) {
        resolve(body as UploadedImage);
      } else if (request.status === 429) {
        reject(new FormApiError(429, copy.forms.fill.rateLimited));
      } else {
        reject(
          new FormApiError(
            request.status,
            body.message ?? copy.forms.image.failed,
          ),
        );
      }
    };
    request.send(input.blob);
  });
}

/**
 * A picture this browser may only see with its edit token (its own answer's
 * pictures on an anonymous form). Fetched with the header, shown as a blob.
 */
export async function fetchImageWithToken(
  formId: string,
  src: string,
): Promise<string | null> {
  try {
    const response = await fetch(src, {
      credentials: "same-origin",
      headers: secretHeaders(formId),
    });
    if (!response.ok) return null;
    return URL.createObjectURL(await response.blob());
  } catch {
    return null;
  }
}
