import { describe, expect, it, vi } from "vitest";

import { DEFAULT_MAIL_FROM, mailConfig } from "./mail.config";
import { createResendMailer, MailError } from "./resend";

describe("mailConfig", () => {
  it("is off without a Resend key", () => {
    expect(mailConfig({})).toBeNull();
    expect(mailConfig({ HUB_RESEND_API_KEY: "  " })).toBeNull();
  });

  it("ignores Kan's own mail settings", () => {
    expect(
      mailConfig({ SMTP_HOST: "smtp.example.test", EMAIL_FROM: "a@b.test" }),
    ).toBeNull();
  });

  it("defaults the sender and leaves replies unset", () => {
    expect(mailConfig({ HUB_RESEND_API_KEY: "re_test" })).toEqual({
      apiKey: "re_test",
      from: DEFAULT_MAIL_FROM,
      replyTo: null,
    });
  });

  it("takes the sender and reply address from the environment", () => {
    expect(
      mailConfig({
        HUB_RESEND_API_KEY: " re_test ",
        HUB_MAIL_FROM: "Club <club@example.test>",
        HUB_MAIL_REPLY_TO: "lead@example.test",
      }),
    ).toEqual({
      apiKey: "re_test",
      from: "Club <club@example.test>",
      replyTo: "lead@example.test",
    });
  });
});

const config = {
  apiKey: "re_test",
  from: "Club <club@example.test>",
  replyTo: "lead@example.test",
};
const message = {
  to: "new@example.test",
  subject: "Welcome",
  text: "secret link inside",
  idempotencyKey: "hub-welcome-abc",
};

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("createResendMailer", () => {
  it("posts one plain-text mail with the key, idempotency key and reply address", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(200, { id: "mail-1" })),
    );
    const mailer = createResendMailer(config, fetchImpl as typeof fetch);

    await expect(mailer.send(message)).resolves.toEqual({ id: "mail-1" });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer re_test",
      "Idempotency-Key": "hub-welcome-abc",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      from: "Club <club@example.test>",
      to: ["new@example.test"],
      subject: "Welcome",
      text: "secret link inside",
      reply_to: "lead@example.test",
    });
  });

  it("says whether replies reach anyone", () => {
    const fetchImpl = (() =>
      Promise.reject(new Error("unused"))) as typeof fetch;
    expect(createResendMailer(config, fetchImpl).acceptsReplies).toBe(true);
    expect(
      createResendMailer({ ...config, replyTo: null }, fetchImpl)
        .acceptsReplies,
    ).toBe(false);
  });

  it("leaves reply_to out when none is set", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(200, { id: "mail-1" })),
    );
    await createResendMailer(
      { ...config, replyTo: null },
      fetchImpl as typeof fetch,
    ).send(message);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(init.body as string)).not.toHaveProperty("reply_to");
  });

  it("passes on Resend's reason for a refusal, never the mail's text, without retrying", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        jsonResponse(403, { message: "The domain is not verified" }),
      ),
    );
    const mailer = createResendMailer(config, fetchImpl as typeof fetch);

    const error = await mailer.send(message).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MailError);
    expect((error as MailError).uncertain).toBe(false);
    expect((error as Error).message).toBe(
      "发信服务拒绝了：The domain is not verified",
    );
    expect((error as Error).message).not.toContain("secret");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("falls back to the status code when the refusal is not JSON", async () => {
    const mailer = createResendMailer(config, (() =>
      Promise.resolve(new Response("nope", { status: 422 }))) as typeof fetch);
    await expect(mailer.send(message)).rejects.toThrow(
      "发信服务拒绝了：HTTP 422",
    );
  });

  it("retries a request that got no answer, with the same idempotency key", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(jsonResponse(200, { id: "mail-1" }));
    const mailer = createResendMailer(config, fetchImpl as typeof fetch);

    await expect(mailer.send(message)).resolves.toEqual({ id: "mail-1" });
    const keys = fetchImpl.mock.calls.map(
      ([, init]) =>
        (init as RequestInit & { headers: Record<string, string> }).headers[
          "Idempotency-Key"
        ],
    );
    expect(keys).toEqual(["hub-welcome-abc", "hub-welcome-abc"]);
  });

  it("calls a mail uncertain when no answer ever comes back", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.reject(new TypeError("fetch failed")),
    );
    const mailer = createResendMailer(config, fetchImpl as typeof fetch);

    const error = await mailer.send(message).catch((e: unknown) => e);
    expect(error).toMatchObject({
      name: "MailError",
      message: "发信服务没有回应",
      uncertain: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries Resend's own errors and calls them uncertain if they persist", async () => {
    const recovered = vi
      .fn()
      .mockResolvedValueOnce(new Response("bad gateway", { status: 502 }))
      .mockResolvedValueOnce(jsonResponse(200, { id: "mail-2" }));
    await expect(
      createResendMailer(config, recovered as typeof fetch).send(message),
    ).resolves.toEqual({ id: "mail-2" });

    const broken = vi.fn(() =>
      Promise.resolve(jsonResponse(500, { message: "internal" })),
    );
    await expect(
      createResendMailer(config, broken as typeof fetch).send(message),
    ).rejects.toMatchObject({
      message: "发信服务出错：internal",
      uncertain: true,
    });
  });

  it("treats a 409 on the retry as the first request still going out", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(
        jsonResponse(409, { message: "concurrent_idempotent_requests" }),
      );
    await expect(
      createResendMailer(config, fetchImpl as typeof fetch).send(message),
    ).rejects.toMatchObject({ uncertain: true });
  });

  it("counts an accepted mail as sent even without an id in the reply", async () => {
    const mailer = createResendMailer(config, (() =>
      Promise.resolve(new Response("ok", { status: 200 }))) as typeof fetch);
    await expect(mailer.send(message)).resolves.toEqual({ id: null });
  });
});
