/**
 * `pnpm --filter @kan/hub check-seams`
 *
 * Compares this checkout with Kan's upstream branch and fails if an upstream
 * file was changed outside the register in `seams.json`. Needs the `upstream`
 * remote to be fetched.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { SeamConfig } from "./seams";
import { checkSeams, checkShadowed } from "./seams";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

const git = (...args: string[]): string =>
  execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();

const tryGit = (...args: string[]): string | null => {
  try {
    return git(...args);
  } catch {
    return null;
  }
};

const lines = (text: string): string[] =>
  text.split("\n").filter((line) => line.length > 0);

const config = JSON.parse(
  readFileSync(new URL("../../seams.json", import.meta.url), "utf8"),
) as SeamConfig;

const base = tryGit("merge-base", config.upstreamRef, "HEAD");
if (base === null) {
  console.error(
    `✗ 找不到 ${config.upstreamRef}。先执行: git fetch upstream main`,
  );
  process.exit(1);
}

// Committed differences, plus whatever is modified or new in the working tree.
const changedFiles = [
  ...new Set([
    ...lines(git("diff", "--name-only", base, "HEAD")),
    ...lines(git("diff", "--name-only", "HEAD")),
    ...lines(git("ls-files", "--others", "--exclude-standard")),
  ]),
];

const violations = checkSeams(config, {
  changedFiles,
  readFile: (file) => {
    const path = join(repoRoot, file);
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  },
});

const warnings = checkShadowed(config, (file) =>
  tryGit("rev-parse", `${config.upstreamRef}:${file}`),
);

for (const warning of warnings) console.warn(`! ${warning}`);

if (violations.length > 0) {
  for (const violation of violations) console.error(`✗ ${violation}`);
  console.error(
    "\n上游文件只能在登记过的接缝处修改。要新增接缝，请在 packages/hub/seams.json 和 docs/hub/UPSTREAM_SEAMS.md 里登记并说明原因。",
  );
  process.exit(1);
}

console.log(
  `✓ 接缝完好：${config.seams.length} 处登记，${changedFiles.length} 个文件与上游不同，全部在自有目录或接缝内。`,
);
