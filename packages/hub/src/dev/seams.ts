/**
 * Keeps the fork honest about what it changes in Kan's code.
 *
 * Rule: everything we write lives in our own paths; an upstream file may only
 * differ from Kan at a registered "seam", and each seam carries a marker so a
 * merge that drops our line is noticed. `seams.json` is the register.
 */

export interface Seam {
  file: string;
  /** Text that must be present in the file. Omitted for generated files. */
  marker?: string;
  /** True for files a tool rewrites (the lockfile). */
  generated?: boolean;
  why: string;
}

export interface ShadowedFile {
  /** An upstream file we no longer render. */
  file: string;
  /** Our file that took over its job. */
  replacedBy: string;
  /** Git blob hash of the upstream file when we last compared the two. */
  upstreamSha: string;
}

export interface SeamConfig {
  upstreamRef: string;
  /** Files and folders (ending in "/") that exist only in this fork. */
  ownPaths: string[];
  seams: Seam[];
  shadowed: ShadowedFile[];
}

const isOwnPath = (file: string, ownPaths: string[]): boolean =>
  ownPaths.some((own) =>
    own.endsWith("/") ? file.startsWith(own) : file === own,
  );

/** Returns one message per problem; an empty array means the seams are intact. */
export function checkSeams(
  config: SeamConfig,
  repo: {
    /** Files that differ from the upstream ref. */
    changedFiles: string[];
    /** Current content of a file, or null when it does not exist. */
    readFile: (file: string) => string | null;
  },
): string[] {
  const seamFiles = new Set(config.seams.map((seam) => seam.file));

  const unregistered = repo.changedFiles
    .filter((file) => !isOwnPath(file, config.ownPaths))
    .filter((file) => !seamFiles.has(file))
    .map((file) => `未登记的上游改动: ${file}`);

  const broken = config.seams.flatMap((seam) => {
    if (seam.generated || seam.marker === undefined) return [];

    const content = repo.readFile(seam.file);
    if (content === null) return [`接缝文件不存在: ${seam.file}`];
    if (!content.includes(seam.marker)) {
      return [
        `接缝标记丢失: ${seam.file}（应包含 ${JSON.stringify(seam.marker)}）`,
      ];
    }
    return [];
  });

  return [...unregistered, ...broken];
}

/**
 * Upstream components we replaced keep changing upstream. This reports the ones
 * that moved since we last looked, so our replacement can follow.
 */
export function checkShadowed(
  config: SeamConfig,
  upstreamSha: (file: string) => string | null,
): string[] {
  return config.shadowed.flatMap((entry) => {
    const current = upstreamSha(entry.file);

    if (current === null) {
      return [
        `上游已删除 ${entry.file}，替身 ${entry.replacedBy} 可能不再需要对照它`,
      ];
    }
    if (current !== entry.upstreamSha) {
      return [
        `上游改了 ${entry.file}，请检查替身 ${entry.replacedBy} 是否要跟进，然后更新 seams.json 里的 upstreamSha 为 ${current}`,
      ];
    }
    return [];
  });
}
