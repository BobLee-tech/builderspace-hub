import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { inlineLocalAssets } from "./inline-html";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "hub-inline-"));
  await mkdir(path.join(root, "assets"), { recursive: true });
  await writeFile(path.join(root, "assets", "logo.webp"), "WEBP");
  await writeFile(path.join(root, "assets", "font.woff2"), "FONT");
  await writeFile(
    path.join(root, "style.css"),
    `@font-face { font-family: F; src: url("assets/font.woff2") format("woff2"); }
     .hero { background: url(assets/logo.webp); }
     .remote { background: url(https://cdn.example.test/x.png); }`,
  );
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const b64 = (text: string) => Buffer.from(text).toString("base64");

describe("inlineLocalAssets", () => {
  it("turns a linked stylesheet and its fonts and images into one self-contained page", async () => {
    const html = `<html><head><link rel="stylesheet" href="style.css"></head>
<body><img src="assets/logo.webp" alt="x"></body></html>`;

    const result = await inlineLocalAssets(html, { baseDir: root, root });

    expect(result.html).not.toContain('href="style.css"');
    expect(result.html).toContain("<style>");
    expect(result.html).toContain(`data:font/woff2;base64,${b64("FONT")}`);
    expect(result.html).toContain(`data:image/webp;base64,${b64("WEBP")}`);
    // The remote URL in the stylesheet is left for the browser.
    expect(result.html).toContain("https://cdn.example.test/x.png");
    expect(result.inlined).toBe(4);
    expect(result.missing).toEqual([]);
  });

  it("leaves addresses that are not local files alone", async () => {
    const html = `<link rel="stylesheet" href="https://cdn.example.test/a.css">
<img src="data:image/png;base64,AAAA"><img src="//cdn.example.test/b.png">
<img src="/abs/c.png"><a href="#top">top</a>`;
    const result = await inlineLocalAssets(html, { baseDir: root, root });
    expect(result.html).toBe(html);
    expect(result.inlined).toBe(0);
  });

  it("reports a file that is not there and keeps the original reference", async () => {
    const html = `<img src="assets/gone.png">`;
    const result = await inlineLocalAssets(html, { baseDir: root, root });
    expect(result.html).toBe(html);
    expect(result.missing).toEqual(["assets/gone.png"]);
  });

  it("will not read outside the source directory", async () => {
    await writeFile(path.join(path.dirname(root), "secret.png"), "SECRET");
    const html = `<img src="../secret.png">`;
    const result = await inlineLocalAssets(html, { baseDir: root, root });
    expect(result.html).toBe(html);
    expect(result.html).not.toContain(b64("SECRET"));
    expect(result.missing).toEqual(["../secret.png"]);
    await rm(path.join(path.dirname(root), "secret.png"), { force: true });
  });

  it("skips files that are too large or of a type it does not embed", async () => {
    await writeFile(path.join(root, "big.png"), Buffer.alloc(1024));
    await writeFile(path.join(root, "app.js"), "alert(1)");
    const html = `<img src="big.png"><img src="app.js">`;
    const result = await inlineLocalAssets(html, {
      baseDir: root,
      root,
      maxAssetBytes: 100,
    });
    expect(result.html).toBe(html);
    expect(result.inlined).toBe(0);
  });

  it("resolves a stylesheet's own urls from the stylesheet's folder", async () => {
    await mkdir(path.join(root, "css"), { recursive: true });
    await writeFile(path.join(root, "css", "pic.png"), "PNG");
    await writeFile(
      path.join(root, "css", "site.css"),
      `a { background: url('pic.png') }`,
    );
    const result = await inlineLocalAssets(
      `<link href="css/site.css" rel="stylesheet">`,
      { baseDir: root, root },
    );
    expect(result.html).toContain(`data:image/png;base64,${b64("PNG")}`);
  });
});
