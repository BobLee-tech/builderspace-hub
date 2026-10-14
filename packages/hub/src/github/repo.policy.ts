/**
 * Pure rules for the repositories linked to projects. No IO.
 */

/** Enough for a project's app, site and tooling; more is a sign of a mistake. */
export const MAX_REPOS_PER_PROJECT = 20;

// GitHub's own limits: an owner is 1–39 letters, digits or single hyphens and
// does not start with one; a repository name is 1–100 of letters, digits,
// ".", "-" and "_", and is never "." or "..".
const OWNER = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;
const NAME = /^[\w.-]{1,100}$/;

export type RepoParse =
  | { ok: true; fullName: string }
  | { ok: false; reason: string };

/**
 * "owner/name" from what someone typed or pasted: the short form, or a
 * github.com link with or without "https://", ".git" or a trailing path.
 * Always lower case, since GitHub ignores case in names.
 */
export function parseRepo(input: string): RepoParse {
  let path = input.trim().replace(/^https?:\/\//i, "");
  // Owners never contain a dot, so a first segment with one is a host.
  const host = path.split("/")[0] ?? "";
  if (host.includes(".")) {
    if (!/^(www\.)?github\.com$/i.test(host)) {
      return { ok: false, reason: "只支持 github.com 上的仓库。" };
    }
    path = path.slice(host.length + 1);
  }

  const [owner = "", rawName = ""] = path.split("/");
  const name = rawName.replace(/\.git$/i, "");
  if (!OWNER.test(owner) || !NAME.test(name) || name === "." || name === "..") {
    return {
      ok: false,
      reason: "请填写 owner/仓库名，或者粘贴仓库的 GitHub 链接。",
    };
  }
  return { ok: true, fullName: `${owner}/${name}`.toLowerCase() };
}

export function repoUrl(fullName: string): string {
  return `https://github.com/${fullName}`;
}
