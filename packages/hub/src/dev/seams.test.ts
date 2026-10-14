import { describe, expect, it } from "vitest";

import type { SeamConfig } from "./seams";
import { checkSeams, checkShadowed } from "./seams";

const config: SeamConfig = {
  upstreamRef: "upstream/main",
  ownPaths: ["packages/hub/", "apps/web/src/hub/", "BUILDERSPACE.md"],
  seams: [
    {
      file: "packages/auth/src/auth.ts",
      marker: "hub-seam",
      why: "registration gate",
    },
    { file: "pnpm-lock.yaml", generated: true, why: "lockfile" },
  ],
  shadowed: [
    {
      file: "apps/web/src/views/auth/login/index.tsx",
      replacedBy: "apps/web/src/hub/features/auth/LoginPage.tsx",
      upstreamSha: "aaa111",
    },
  ],
};

const files = (contents: Record<string, string>) => (file: string) =>
  contents[file] ?? null;

const seamInPlace = files({
  "packages/auth/src/auth.ts": "// hub-seam: gate\nplugins: [...]",
});

describe("checkSeams", () => {
  it("accepts our own files, registered seams and generated files", () => {
    const violations = checkSeams(config, {
      changedFiles: [
        "packages/hub/src/access/grant.service.ts",
        "apps/web/src/hub/copy/zh.ts",
        "BUILDERSPACE.md",
        "packages/auth/src/auth.ts",
        "pnpm-lock.yaml",
      ],
      readFile: seamInPlace,
    });

    expect(violations).toEqual([]);
  });

  it("flags an upstream file that was changed without being registered", () => {
    const violations = checkSeams(config, {
      changedFiles: ["apps/web/src/components/Button.tsx"],
      readFile: seamInPlace,
    });

    expect(violations).toEqual([
      "未登记的上游改动: apps/web/src/components/Button.tsx",
    ]);
  });

  it("does not treat a look-alike path as ours", () => {
    const violations = checkSeams(config, {
      changedFiles: ["packages/hub-evil/index.ts", "BUILDERSPACE.md.bak"],
      readFile: seamInPlace,
    });

    expect(violations).toHaveLength(2);
  });

  it("flags a seam whose marker is gone, even when nothing else changed", () => {
    // What an upstream sync that silently drops our line looks like.
    const violations = checkSeams(config, {
      changedFiles: [],
      readFile: files({ "packages/auth/src/auth.ts": "plugins: [...]" }),
    });

    expect(violations).toEqual([
      '接缝标记丢失: packages/auth/src/auth.ts（应包含 "hub-seam"）',
    ]);
  });

  it("flags a seam file that no longer exists", () => {
    const violations = checkSeams(config, {
      changedFiles: [],
      readFile: files({}),
    });

    expect(violations).toEqual(["接缝文件不存在: packages/auth/src/auth.ts"]);
  });
});

describe("checkShadowed", () => {
  it("is quiet while upstream has not touched the component we replace", () => {
    expect(checkShadowed(config, () => "aaa111")).toEqual([]);
  });

  it("warns when upstream changed it, naming our replacement", () => {
    expect(checkShadowed(config, () => "bbb222")).toEqual([
      "上游改了 apps/web/src/views/auth/login/index.tsx，请检查替身 apps/web/src/hub/features/auth/LoginPage.tsx 是否要跟进，然后更新 seams.json 里的 upstreamSha 为 bbb222",
    ]);
  });

  it("warns when upstream removed it", () => {
    expect(checkShadowed(config, () => null)).toEqual([
      "上游已删除 apps/web/src/views/auth/login/index.tsx，替身 apps/web/src/hub/features/auth/LoginPage.tsx 可能不再需要对照它",
    ]);
  });
});
