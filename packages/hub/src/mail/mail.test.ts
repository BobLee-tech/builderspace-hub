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

  it("passes on Resend's reason for a refusal, never the mail's text", async () => {
    const mailer = createResendMailer(config, (() =>
      Promise.resolve(
        jsonResponse(403, { message: "The domain is not verified" }),
      )) as typeof fetch);

    const error = await mailer.send(message).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MailError);
    expect((error as Error).message).toBe(
      "发信服务拒绝了：The domain is not verified",
    );
    expect((error as Error).message).not.toContain("secret");
  });

  it("falls back to the status code when the refusal is not JSON", async () => {
    const mailer = createResendMailer(config, (() =>
      Promise.resolve(
        new Response("bad gateway", { status: 502 }),
      )) as typeof fetch);
    await expect(mailer.send(message)).rejects.toThrow(
      "发信服务拒绝了：HTTP 502",
    );
  });

  it("reports a network failure in one sentence", async () => {
    const mailer = createResendMailer(config, (() =>
      Promise.reject(new TypeError("fetch failed"))) as typeof fetch);
    await expect(mailer.send(message)).rejects.toThrow("连不上发信服务");
  });

  it("refuses a success without an id", async () => {
    const mailer = createResendMailer(config, (() =>
      Promise.resolve(jsonResponse(200, {}))) as typeof fetch);
    await expect(mailer.send(message)).rejects.toThrow("发信服务的回复看不懂");
  });
});
