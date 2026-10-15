import { readFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * A page saved from a design tool usually links its stylesheet, fonts and
 * images by relative path. Shown from the library those links point at
 * nothing, so the page would render bare. This folds them into the page as
 * data URIs, making the stored file self-contained.
 */

const MIME: Record<string, string> = {
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

const DEFAULT_MAX_ASSET_BYTES = 5 * 1024 * 1024;

export interface InlineOptions {
  /** Directory that relative addresses in the page are resolved from. */
  baseDir: string;
  /** Nothing outside this directory is ever read. */
  root: string;
  maxAssetBytes?: number;
}

export interface InlineResult {
  html: string;
  /** How many assets were folded in. */
  inlined: number;
  /** Local addresses that could not be read (missing, outside `root`, too big). */
  missing: string[];
}

/** An address that names a file next to the page, not a network or inline resource. */
function isLocalReference(reference: string): boolean {
  const ref = reference.trim();
  return (
    ref.length > 0 &&
    !ref.startsWith("#") &&
    !ref.startsWith("/") &&
    !/^[a-z][a-z0-9+.-]*:/i.test(ref)
  );
}

const withoutQuery = (reference: string): string =>
  reference.split(/[?#]/)[0] ?? reference;

async function readAsset(
  reference: string,
  fromDir: string,
  options: Required<Pick<InlineOptions, "root" | "maxAssetBytes">>,
): Promise<{ bytes: Buffer; mime: string; absolutePath: string } | null> {
  const absolutePath = path.resolve(
    fromDir,
    decodeURI(withoutQuery(reference)),
  );
  const relative = path.relative(options.root, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;

  const mime = MIME[path.extname(absolutePath).toLowerCase()];
  if (!mime) return null;
  try {
    const info = await stat(absolutePath);
    if (!info.isFile() || info.size > options.maxAssetBytes) return null;
    return { bytes: await readFile(absolutePath), mime, absolutePath };
  } catch {
    return null;
  }
}

const dataUri = (mime: string, bytes: Buffer): string =>
  `data:${mime};base64,${bytes.toString("base64")}`;

export async function inlineLocalAssets(
  html: string,
  options: InlineOptions,
): Promise<InlineResult> {
  const limits = {
    root: path.resolve(options.root),
    maxAssetBytes: options.maxAssetBytes ?? DEFAULT_MAX_ASSET_BYTES,
  };
  const missing: string[] = [];
  let inlined = 0;

  /** Rewrites every local `url(...)` in CSS that lives in `cssDir`. */
  async function inlineCssUrls(css: string, cssDir: string): Promise<string> {
    const pattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
    const replacements: [string, string][] = [];
    for (const match of css.matchAll(pattern)) {
      const [whole, , reference] = match;
      if (!whole || !reference || !isLocalReference(reference)) continue;
      const asset = await readAsset(reference, cssDir, limits);
      if (!asset) {
        missing.push(reference);
        continue;
      }
      inlined += 1;
      replacements.push([whole, `url("${dataUri(asset.mime, asset.bytes)}")`]);
    }
    return replacements.reduce(
      (text, [from, to]) => text.split(from).join(to),
      css,
    );
  }

  async function replaceAsync(
    text: string,
    pattern: RegExp,
    replace: (match: RegExpMatchArray) => Promise<string>,
  ): Promise<string> {
    const parts: string[] = [];
    let last = 0;
    for (const match of text.matchAll(pattern)) {
      parts.push(text.slice(last, match.index), await replace(match));
      last = match.index + match[0].length;
    }
    parts.push(text.slice(last));
    return parts.join("");
  }

  // <link rel="stylesheet" href="local.css"> → <style>…</style>
  let result = await replaceAsync(html, /<link\b[^>]*>/gi, async ([tag]) => {
    if (!/\brel\s*=\s*["']?stylesheet/i.test(tag)) return tag;
    const reference = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!reference || !isLocalReference(reference)) return tag;
    const asset = await readAsset(reference, options.baseDir, limits);
    if (!asset || asset.mime !== "text/css") {
      missing.push(reference);
      return tag;
    }
    inlined += 1;
    const css = await inlineCssUrls(
      asset.bytes.toString("utf8"),
      path.dirname(asset.absolutePath),
    );
    // A stylesheet must not be able to close its own <style> element.
    return `<style>${css.replace(/<\/style/gi, "<\\/style")}</style>`;
  });

  // <style> blocks already in the page.
  result = await replaceAsync(
    result,
    /<style\b[^>]*>([\s\S]*?)<\/style>/gi,
    async ([whole, css]) => {
      if (css === undefined || !/url\(/i.test(css)) return whole;
      const rewritten = await inlineCssUrls(css, options.baseDir);
      return whole.replace(css, () => rewritten);
    },
  );

  // <img src="local.png">
  result = await replaceAsync(result, /<img\b[^>]*>/gi, async ([tag]) => {
    const match = /\bsrc\s*=\s*(["'])([^"']+)\1/i.exec(tag);
    const reference = match?.[2];
    if (!reference || !isLocalReference(reference)) return tag;
    const asset = await readAsset(reference, options.baseDir, limits);
    if (!asset?.mime.startsWith("image/")) {
      missing.push(reference);
      return tag;
    }
    inlined += 1;
    return tag.replace(
      match[0],
      () => `src="${dataUri(asset.mime, asset.bytes)}"`,
    );
  });

  return { html: result, inlined, missing: [...new Set(missing)] };
}
