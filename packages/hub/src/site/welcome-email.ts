/**
 * The email an accepted core-member applicant gets: a welcome and their own
 * registration link. Plain text, so every client shows it the same way and
 * nothing in it can be spoofed with markup.
 */

export const WELCOME_SUBJECT = "欢迎加入 UNSW 创客社 BuilderSpace";

/** Most members are in Sydney, so the expiry date is Sydney's. */
const EXPIRY_TIME_ZONE = "Australia/Sydney";

/** "10 月 25 日" in Sydney time. */
export function formatExpiryDay(expiresAt: Date): string {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: EXPIRY_TIME_ZONE,
    month: "numeric",
    day: "numeric",
  }).formatToParts(expiresAt);
  const part = (type: "month" | "day") =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("month")} 月 ${part("day")} 日`;
}

/** The nickname as a greeting: trailing full stops ("珊.") read oddly there. */
function greetingName(nickname: string): string {
  const name = nickname
    .trim()
    .replace(/[.。]+$/u, "")
    .trim();
  return name.length > 0 ? name : nickname.trim();
}

export function welcomeEmail(input: {
  nickname: string;
  email: string;
  link: string;
  expiresAt: Date;
}): { subject: string; text: string } {
  const name = greetingName(input.nickname);
  const text = [
    name.length > 0 ? `你好 ${name}，` : "你好，",
    "",
    "欢迎加入 UNSW 创客社 BuilderSpace。",
    "",
    "你的核心成员申请已经通过。下面是你的专属注册链接，打开后设置密码，就能进入我们的内部工作台 BuilderSpace Hub，查看社团的任务看板和文档：",
    "",
    input.link,
    "",
    `· 请用收到这封邮件的邮箱（${input.email}）注册；链接只能用一次，${formatExpiryDay(input.expiresAt)}前有效。`,
    "· 链接是你本人专用的，请不要转发。",
    "· 打不开或过期了，直接回复这封邮件。",
    "",
    "BuilderSpace 核心团队",
  ].join("\n");
  return { subject: WELCOME_SUBJECT, text };
}
