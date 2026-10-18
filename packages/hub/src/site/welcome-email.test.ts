import { describe, expect, it } from "vitest";

import {
  formatExpiryDay,
  WELCOME_SUBJECT,
  welcomeEmail,
} from "./welcome-email";

describe("formatExpiryDay", () => {
  it("gives the day in Sydney, not the server's zone", () => {
    // 15:00 UTC on 24 October is already the 25th in Sydney (UTC+11).
    expect(formatExpiryDay(new Date("2026-10-24T15:00:00Z"))).toBe(
      "10 月 25 日",
    );
    expect(formatExpiryDay(new Date("2026-10-24T10:00:00Z"))).toBe(
      "10 月 24 日",
    );
  });
});

describe("welcomeEmail", () => {
  const base = {
    nickname: "小林",
    email: "lin@example.test",
    link: "https://hub.example.test/join#token",
    expiresAt: new Date("2026-10-25T06:00:00Z"),
    canReply: true,
  };

  it("greets the person and carries their link, address and expiry", () => {
    const mail = welcomeEmail(base);
    expect(mail.subject).toBe(WELCOME_SUBJECT);
    expect(
      mail.text.startsWith(
        "你好 小林，\n\n欢迎加入 UNSW 创客社 BuilderSpace。",
      ),
    ).toBe(true);
    expect(mail.text).toContain("\nhttps://hub.example.test/join#token\n");
    expect(mail.text).toContain("（lin@example.test）注册");
    expect(mail.text).toContain("10 月 25 日前有效");
    expect(mail.text.endsWith("BuilderSpace 核心团队")).toBe(true);
  });

  it("asks for a reply only when replies reach someone", () => {
    expect(welcomeEmail(base).text).toContain("直接回复这封邮件");
    const noReply = welcomeEmail({ ...base, canReply: false }).text;
    expect(noReply).not.toContain("回复这封邮件");
    expect(noReply).toContain("在社团群里说一声");
  });

  it("drops a trailing full stop from the nickname", () => {
    expect(welcomeEmail({ ...base, nickname: "珊." }).text).toMatch(
      /^你好 珊，/,
    );
    expect(welcomeEmail({ ...base, nickname: "salicaceae." }).text).toMatch(
      /^你好 salicaceae，/,
    );
  });

  it("still greets someone whose nickname is only punctuation or blank", () => {
    expect(welcomeEmail({ ...base, nickname: "." }).text).toMatch(/^你好 \.，/);
    expect(welcomeEmail({ ...base, nickname: "  " }).text).toMatch(/^你好，/);
  });
});
