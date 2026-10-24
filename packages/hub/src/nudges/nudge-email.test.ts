import { describe, expect, it } from "vitest";

import type { MailTask } from "./nudge-email";
import { nudgeEmail } from "./nudge-email";

const DAY = 24 * 60 * 60 * 1000;
// 2026-10-24 13:00 in Sydney.
const now = new Date("2026-10-24T02:00:00Z");

function task(overrides: Partial<MailTask> = {}): MailTask {
  return {
    title: "活动回顾推文",
    project: "BuilderSpace 社团",
    board: "运营",
    listName: "进行中",
    dueState: "none",
    dueDate: null,
    lastTouchedAt: now,
    ...overrides,
  };
}

const mail = (tasks: MailTask[], total = tasks.length, name = "小王") =>
  nudgeEmail({
    name,
    tasks,
    total,
    baseUrl: "https://hub.example.test",
    now,
  });

describe("nudgeEmail", () => {
  it("numbers the tasks and says how many are left in the subject", () => {
    const { subject, text } = mail([
      task({ title: "推文" }),
      task({ title: "海报", board: "活动" }),
    ]);

    expect(subject).toBe("你还有 2 件事没做完");
    expect(text).toContain("你好 小王，");
    expect(text).toContain("1. 推文（BuilderSpace 社团 · 运营）· 进行中");
    expect(text).toContain("2. 海报（BuilderSpace 社团 · 活动）· 进行中");
  });

  it("says what is pressing about each task", () => {
    const { text } = mail([
      task({
        title: "逾期",
        dueState: "overdue",
        dueDate: new Date(now.getTime() - DAY),
      }),
      // 2026-10-24 23:00 in Sydney: still today there.
      task({
        title: "今天",
        dueState: "soon",
        dueDate: new Date("2026-10-24T12:00:00Z"),
      }),
      task({
        title: "下周",
        dueState: "later",
        dueDate: new Date("2026-10-31T01:00:00Z"),
      }),
      task({ title: "放着", lastTouchedAt: new Date(now.getTime() - 5 * DAY) }),
    ]);

    expect(text).toContain("1. 逾期（BuilderSpace 社团 · 运营）· 已逾期");
    expect(text).toContain("2. 今天（BuilderSpace 社团 · 运营）· 今天到期");
    expect(text).toContain(
      "3. 下周（BuilderSpace 社团 · 运营）· 10 月 31 日到期",
    );
    expect(text).toContain("4. 放着（BuilderSpace 社团 · 运营）· 5 天没动");
  });

  it("says how many more there are past the listed ones", () => {
    const { subject, text } = mail([task(), task()], 11);

    expect(subject).toBe("你还有 11 件事没做完");
    expect(text).toContain("……还有 9 件");
  });

  it("links to my tasks and to where the mail is turned off", () => {
    const { text } = mail([task()]);

    expect(text).toContain("https://hub.example.test/tasks/mine");
    expect(text).toContain("https://hub.example.test/me/reminders");
  });

  it("never says who asked", () => {
    const { text } = mail([task()]);

    expect(text).toContain("有人在 BuilderSpace Hub 上提醒了你一下");
    expect(text).toContain("不记录是谁");
  });

  it("greets without a name when there is none", () => {
    expect(mail([task()], 1, "  ").text.startsWith("你好，\n")).toBe(true);
  });
});
