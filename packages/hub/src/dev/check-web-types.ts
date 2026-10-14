/**
 * `pnpm --filter @kan/hub check-web-types`
 *
 * Typechecks the web app and fails only on errors in the Hub's own files;
 * Kan's own errors are counted and left alone (see web-types.ts).
 * Run it after `pnpm --filter @kan/web build` (or `dev`), which writes the
 * next-env.d.ts the web app's types rely on.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import type { SeamConfig } from "./seams";
import { hubDiagnostics, parseTscOutput } from "./web-types";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");

const config = JSON.parse(
  readFileSync(new URL("../../seams.json", import.meta.url), "utf8"),
) as SeamConfig;

// Run from the repository root so tsc prints paths the way seams.json has them.
const result = spawnSync(
  process.execPath,
  [tsc, "--noEmit", "--pretty", "false", "--project", "apps/web"],
  { cwd: repoRoot, encoding: "utf8" },
);

if (result.status === 0) {
  console.log("✓ 网页代码没有类型错误。");
  process.exit(0);
}

const diagnostics = parseTscOutput(result.stdout);
if (diagnostics.length === 0) {
  console.error(result.stdout, result.stderr, result.error ?? "");
  console.error("✗ tsc 没有跑完，类型没有检查成。");
  process.exit(1);
}

const ours = hubDiagnostics(config, diagnostics);
const kans = diagnostics.length - ours.length;

if (ours.length > 0) {
  for (const diagnostic of ours) console.error(diagnostic.text);
  console.error(
    `\n✗ Hub 的代码有 ${ours.length} 个类型错误（另有 ${kans} 个在 Kan 自己的代码里，不算）。`,
  );
  process.exit(1);
}

console.log(
  `✓ Hub 的代码没有类型错误（另有 ${kans} 个在 Kan 自己的代码里，不算）。`,
);
