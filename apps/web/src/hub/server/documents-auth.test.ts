import type { NextApiRequest, NextApiResponse } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createNextApiContext = vi.fn();
const getAccessFacts = vi.fn();

vi.mock("@kan/api/trpc-context", () => ({ createNextApiContext }));
vi.mock("@kan/hub/accounts", () => ({ getAccessFacts }));

const { authenticateDocumentApiRequest } = await import("./documents-auth");

function response() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res as typeof res & NextApiResponse;
}

const request = (headers: Record<string, string>) =>
  ({ headers }) as unknown as NextApiRequest;

const db = { marker: "db" };
const user = { id: "u1", email: "me@example.test" };

beforeEach(() => {
  createNextApiContext.mockReset();
  getAccessFacts.mockReset();
  getAccessFacts.mockResolvedValue({ status: "active", role: "owner" });
});

describe("authenticateDocumentApiRequest", () => {
  it("needs an API key header and never reaches the auth library without one", async () => {
    const res = response();
    expect(await authenticateDocumentApiRequest(request({ cookie: "session=1" }), res)).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(createNextApiContext).not.toHaveBeenCalled();
  });

  it("drops the cookie before looking the key up, so the key alone decides", async () => {
    createNextApiContext.mockResolvedValue({ user, db });
    const res = response();
    await authenticateDocumentApiRequest(
      request({ "x-api-key": "k", cookie: "better-auth.session_token=abc" }),
      res,
    );
    const seen = createNextApiContext.mock.calls[0]?.[0] as NextApiRequest;
    expect(seen.headers["x-api-key"]).toBe("k");
    expect(seen.headers.cookie).toBeUndefined();
  });

  it("drops an Authorization header too, which the auth library would prefer over the key", async () => {
    createNextApiContext.mockResolvedValue({ user, db });
    await authenticateDocumentApiRequest(
      request({ "x-api-key": "k", authorization: "Bearer something-else" }),
      response(),
    );
    const seen = createNextApiContext.mock.calls[0]?.[0] as NextApiRequest;
    expect(seen.headers.authorization).toBeUndefined();
    expect(seen.headers["x-api-key"]).toBe("k");
  });

  it("returns who is calling, with their back-office role", async () => {
    createNextApiContext.mockResolvedValue({ user, db });
    const res = response();
    expect(await authenticateDocumentApiRequest(request({ "x-api-key": "k" }), res)).toEqual({
      db,
      actor: { userId: "u1", email: "me@example.test", role: "owner" },
    });
  });

  it("answers an unknown, disabled or expired key with 401, not a server error", async () => {
    createNextApiContext.mockRejectedValue(
      Object.assign(new Error("Invalid API key."), { name: "APIError", body: { code: "INVALID_API_KEY" } }),
    );
    const res = response();
    expect(await authenticateDocumentApiRequest(request({ "x-api-key": "bad" }), res)).toBeNull();
    expect(res.statusCode).toBe(401);
  });

  it("answers a key used too often with 429", async () => {
    createNextApiContext.mockRejectedValue(
      Object.assign(new Error("slow down"), { name: "APIError", body: { code: "RATE_LIMITED" } }),
    );
    const res = response();
    await authenticateDocumentApiRequest(request({ "x-api-key": "k" }), res);
    expect(res.statusCode).toBe(429);
  });

  it("lets a real failure surface instead of hiding it as a bad key", async () => {
    createNextApiContext.mockRejectedValue(new Error("database is down"));
    await expect(
      authenticateDocumentApiRequest(request({ "x-api-key": "k" }), response()),
    ).rejects.toThrow("database is down");
  });

  it("refuses when no account stands behind the key, and when it is suspended", async () => {
    createNextApiContext.mockResolvedValue({ user: null, db });
    const none = response();
    expect(await authenticateDocumentApiRequest(request({ "x-api-key": "k" }), none)).toBeNull();
    expect(none.statusCode).toBe(401);

    createNextApiContext.mockResolvedValue({ user, db });
    getAccessFacts.mockResolvedValue({ status: "suspended", role: null });
    const suspended = response();
    expect(await authenticateDocumentApiRequest(request({ "x-api-key": "k" }), suspended)).toBeNull();
    expect(suspended.statusCode).toBe(403);
  });
});
