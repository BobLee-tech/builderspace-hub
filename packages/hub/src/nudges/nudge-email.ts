import type { DueState } from "../tasks/task.policy";
import { idleDays, STALE_AFTER_DAYS } from "./nudge.policy";

/**
 * The 催一下 mail: the recipient's unfinished tasks, numbered. Plain text, like
 * the welcome mail, so every client shows it the same way. It never names
 * who asked: nothing records that.
 */

/** One line of the mail. */
export interface MailTask {
  title: string;
  project: string;
  board: string;
  /** The column it sits in, shown when nothing more pressing applies. */
  listName: string;
  dueState: DueState;
  dueDate: Date | null;
  lastTouchedAt: Date;
}

/** Most members are in Sydney, so "today" and dates are Sydney's. */
const TIME_ZONE = "Australia/Sydney";

function sydneyParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  const part = (type: "year" | "month" | "day") =>
    parts.find((p) => p.type === type)?.value ?? "";
  return { year: part("year"), month: part("month"), day: part("day") };
}

function isSameSydneyDay(a: Date, b: Date): boolean {
  const x = sydneyParts(a);
  const y = sydneyParts(b);
  return x.year === y.year && x.month === y.month && x.day === y.day;
}

function pressing(task: MailTask, now: Date): string {
  if (task.dueState === "overdue") return "已逾期";
  if (task.dueDate) {
    if (isSameSydneyDay(task.dueDate, now)) return "今天到期";
    const { month, day } = sydneyParts(task.dueDate);
    return `${month} 月 ${day} 日到期`;
  }
  const days = idleDays(task.lastTouchedAt, now);
  return days >= STALE_AFTER_DAYS ? `${days} 天没动` : task.listName;
}

export function nudgeEmail(input: {
  name: string;
  /** The tasks to list, already in order and cut to length. */
  tasks: readonly MailTask[];
  /** All of their unfinished tasks, listed or not. */
  total: number;
  baseUrl: string;
  now: Date;
}): { subject: string; text: string } {
  const name = input.name.trim();
  const more = input.total - input.tasks.length;
  const text = [
    name.length > 0 ? `你好 ${name}，` : "你好，",
    "",
    `有人在 BuilderSpace Hub 上提醒了你一下，你手上还有 ${input.total} 件事没做完：`,
    "",
    ...input.tasks.map(
      (task, index) =>
        `${index + 1}. ${task.title}（${task.project} · ${task.board}）· ${pressing(task, input.now)}`,
    ),
    ...(more > 0 ? [`……还有 ${more} 件`] : []),
    "",
    `打开 Hub 看看：${input.baseUrl}/tasks/mine`,
    "",
    "提醒是匿名的，Hub 不记录是谁点的；同一个人一小时内最多收到一封。",
    `不想再收到这类邮件，在这里关掉：${input.baseUrl}/me/reminders`,
  ].join("\n");
  return { subject: `你还有 ${input.total} 件事没做完`, text };
}
