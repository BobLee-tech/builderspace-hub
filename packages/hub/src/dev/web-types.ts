/**
 * Type errors in the web app that the Hub is responsible for.
 *
 * `tsc` over apps/web also reports type errors in Kan's own code, which we
 * leave to upstream, so the web app as a whole never typechecks cleanly and
 * CI cannot simply require it to. What CI can require is that the Hub's own
 * files (`ownPaths` in seams.json) have none. Seam files are left out: they
 * are Kan's files, and one of them has a Kan type error of its own.
 */
import type { SeamConfig } from "./seams";
import { isOwnPath } from "./seams";

export interface Diagnostic {
  /** As tsc printed it; null for an error not tied to a file. */
  file: string | null;
  /** The whole message, including the indented lines that explain it. */
  text: string;
}

const FILE_ERROR = /^(.+?)\(\d+,\d+\): error TS\d+:/;
const GLOBAL_ERROR = /^error TS\d+:/;

/** Splits `tsc --pretty false` output into one entry per error. */
export function parseTscOutput(output: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const line of output.split("\n")) {
    const inFile = FILE_ERROR.exec(line)?.[1];
    const previous = diagnostics.at(-1);

    if (inFile !== undefined) {
      diagnostics.push({ file: inFile, text: line });
    } else if (GLOBAL_ERROR.test(line)) {
      diagnostics.push({ file: null, text: line });
    } else if (previous && /^\s+\S/.test(line)) {
      previous.text += `\n${line}`;
    }
  }

  return diagnostics;
}

/**
 * The errors in the Hub's own files. An error not tied to any file (a broken
 * tsconfig, say) is kept too: it means nothing was checked.
 */
export function hubDiagnostics(
  config: SeamConfig,
  diagnostics: Diagnostic[],
): Diagnostic[] {
  return diagnostics.filter(
    ({ file }) => file === null || isOwnPath(file, config.ownPaths),
  );
}
