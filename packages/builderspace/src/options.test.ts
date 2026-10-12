import { describe, expect, it } from "vitest";

import { parseOptions } from "./options";

const env = (overrides: Record<string, string | undefined> = {}) => ({
  HUB_URL: "https://hub.example.com",
  HUB_API_KEY: "kan_secret",
  ...overrides,
});

describe("parseOptions", () => {
  it("reads the Hub URL and API key from the environment", () => {
    expect(parseOptions(env(), [])).toEqual({
      ok: true,
      options: {
        baseUrl: "https://hub.example.com",
        apiKey: "kan_secret",
        dryRun: false,
      },
    });
  });

  it("picks up an optional private tasks file", () => {
    const result = parseOptions(
      env({ HUB_TASKS_FILE: " ./tasks.local.json " }),
      [],
    );
    expect(result.ok && result.options.tasksFile).toBe("./tasks.local.json");
  });

  it("leaves the tasks file unset when the variable is blank", () => {
    const result = parseOptions(env({ HUB_TASKS_FILE: "  " }), []);
    expect(result.ok && "tasksFile" in result.options).toBe(false);
  });

  it("enables dry run with --dry-run", () => {
    const result = parseOptions(env(), ["--dry-run"]);
    expect(result.ok && result.options.dryRun).toBe(true);
  });

  it("allows plain http only for local development hosts", () => {
    for (const url of ["http://localhost:3000", "http://127.0.0.1:3000"]) {
      expect(parseOptions(env({ HUB_URL: url }), []).ok).toBe(true);
    }

    expect(
      parseOptions(env({ HUB_URL: "http://hub.example.com" }), []),
    ).toEqual({
      ok: false,
      errors: ["HUB_URL 必须使用 https（本地开发的 localhost 除外）"],
    });
  });

  it("reports every missing variable at once", () => {
    expect(parseOptions({}, [])).toEqual({
      ok: false,
      errors: [
        "缺少环境变量 HUB_URL（例如 http://localhost:3000）",
        "缺少环境变量 HUB_API_KEY（在 Hub 的 设置 → API 中创建）",
      ],
    });
  });

  it("treats blank values as missing", () => {
    const result = parseOptions(env({ HUB_API_KEY: "   " }), []);
    expect(result).toEqual({
      ok: false,
      errors: ["缺少环境变量 HUB_API_KEY（在 Hub 的 设置 → API 中创建）"],
    });
  });

  it("rejects a URL that is not a URL", () => {
    expect(parseOptions(env({ HUB_URL: "not a url" }), [])).toEqual({
      ok: false,
      errors: ["HUB_URL 不是合法的地址: not a url"],
    });
  });

  it("rejects non-http protocols and embedded credentials", () => {
    expect(parseOptions(env({ HUB_URL: "ftp://hub.example.com" }), []).ok).toBe(
      false,
    );
    expect(
      parseOptions(env({ HUB_URL: "https://user:pw@hub.example.com" }), []),
    ).toEqual({
      ok: false,
      errors: ["HUB_URL 里不要带用户名或密码"],
    });
  });

  it("rejects unknown flags so typos are not silently ignored", () => {
    expect(parseOptions(env(), ["--dryrun"])).toEqual({
      ok: false,
      errors: ["未知参数: --dryrun（只支持 --dry-run）"],
    });
  });
});
