export interface SeedCliOptions {
  baseUrl: string;
  apiKey: string;
  dryRun: boolean;
  /** Path to a private JSON file of extra starter tasks (HUB_TASKS_FILE). */
  tasksFile?: string;
}

export type ParsedOptions =
  | { ok: true; options: SeedCliOptions }
  | { ok: false; errors: string[] };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const isLocalHost = (hostname: string): boolean =>
  LOCAL_HOSTS.has(hostname) || hostname.endsWith(".localhost");

const checkUrl = (raw: string): { baseUrl: string } | { error: string } => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { error: `HUB_URL 不是合法的地址: ${raw}` };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:")
    return { error: "HUB_URL 必须是 http(s) 地址" };
  if (url.username !== "" || url.password !== "")
    return { error: "HUB_URL 里不要带用户名或密码" };
  // The API key travels in a header, so refuse to send it in clear text.
  if (url.protocol === "http:" && !isLocalHost(url.hostname))
    return { error: "HUB_URL 必须使用 https（本地开发的 localhost 除外）" };

  return { baseUrl: `${url.origin}${url.pathname.replace(/\/+$/, "")}` };
};

/** Turns environment variables and CLI flags into validated seed options. */
export function parseOptions(
  env: Record<string, string | undefined>,
  argv: string[],
): ParsedOptions {
  const errors: string[] = [];

  for (const arg of argv) {
    if (arg !== "--dry-run")
      errors.push(`未知参数: ${arg}（只支持 --dry-run）`);
  }

  const rawUrl = env.HUB_URL?.trim() ?? "";
  const apiKey = env.HUB_API_KEY?.trim() ?? "";
  let baseUrl = "";

  if (rawUrl === "") {
    errors.push("缺少环境变量 HUB_URL（例如 http://localhost:3000）");
  } else {
    const checked = checkUrl(rawUrl);
    if ("error" in checked) errors.push(checked.error);
    else baseUrl = checked.baseUrl;
  }

  if (apiKey === "")
    errors.push("缺少环境变量 HUB_API_KEY（在 Hub 的 设置 → API 中创建）");

  if (errors.length > 0) return { ok: false, errors };

  const tasksFile = env.HUB_TASKS_FILE?.trim() ?? "";

  return {
    ok: true,
    options: {
      baseUrl,
      apiKey,
      dryRun: argv.includes("--dry-run"),
      ...(tasksFile !== "" && { tasksFile }),
    },
  };
}
