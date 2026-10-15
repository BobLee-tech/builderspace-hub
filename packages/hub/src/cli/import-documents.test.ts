import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AdminActor } from "../accounts/account.service";
import type { Db } from "../db";
import { getLibrary } from "../documents/library.service";
import { MemoryDocumentStorage } from "../testing/memory-storage";
import { createHubTestDb, seedHubAccount, seedUser } from "../testing/test-db";
import { parseCli } from "./args";
import { importDocuments } from "./import-documents";

let db: Db;
let storage: MemoryDocumentStorage;
let dir: string;
let viewer: AdminActor;

beforeEach(async () => {
  db = await createHubTestDb();
  storage = new MemoryDocumentStorage();
  dir = await mkdtemp(path.join(tmpdir(), "hub-import-"));
  const user = await seedUser(db);
  await seedHubAccount(db, user.id, { role: "owner" });
  viewer = { userId: user.id, email: user.email, role: "owner" };
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const write = async (name: string, content = "hello") => {
  const target = path.join(dir, name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
};

const run = (overrides: Partial<Parameters<typeof importDocuments>[2]> = {}) =>
  importDocuments(db, storage, {
    sources: [{ dir, folder: ["方案"] }],
    recursive: false,
    dryRun: false,
    ...overrides,
  });

describe("importDocuments", () => {
  it("puts the files into the folder and reports each one", async () => {
    await write("brief.pdf");
    await write("deck.pptx");

    const lines = await run();

    expect(lines[0]).toBe("导入完成：新建 2，替换 0，不变 0，跳过 0，失败 0");
    expect(lines.slice(1).join("\n")).toContain("新建  方案 / brief.pdf");
    const library = await getLibrary(db, storage, viewer, {});
    expect(library.folders).toMatchObject([{ name: "方案", documentCount: 2 }]);
    expect(storage.files.size).toBe(2);
  });

  it("can be run again without duplicating anything", async () => {
    await write("brief.pdf");
    await run();
    const again = await run();
    expect(again[0]).toContain("不变 1");
    expect(storage.files.size).toBe(1);

    await write("brief.pdf", "changed");
    const changed = await run();
    expect(changed[0]).toContain("替换 1");
    expect(storage.files.size).toBe(1);
  });

  it("skips what the library will not hold, and says why", async () => {
    await write("ok.pdf");
    await write("run.sh");
    await write("noext");
    await write(".DS_Store");
    await write("~$lock.docx");

    const lines = await run();
    expect(lines[0]).toBe("导入完成：新建 1，替换 0，不变 0，跳过 2，失败 0");
    expect(lines.join("\n")).toContain(
      "跳过  方案 / run.sh（不支持这种文件格式）",
    );
  });

  it("mirrors sub-directories as sub-folders when asked, and ignores them otherwise", async () => {
    await write("top.pdf");
    await write("print/inner.pdf");
    await write("node_modules/x/y.pdf");

    const flat = await run();
    expect(flat[0]).toContain("新建 1");

    const deep = await run({ recursive: true });
    expect(deep[0]).toContain("新建 1");
    expect(deep[0]).toContain("不变 1");
    const inside = await getLibrary(db, storage, viewer, {
      folderPublicId: (await getLibrary(db, storage, viewer, {})).folders[0]
        ?.publicId,
    });
    expect(inside.folders.map((f) => f.name)).toEqual(["print"]);
  });

  it("folds a page's linked styles and images into the stored file", async () => {
    await write("style.css", "body { color: red }");
    await write("logo.png", "PNG");
    await write(
      "page.html",
      '<link rel="stylesheet" href="style.css"><img src="logo.png"><img src="gone.png">',
    );

    const lines = await run();

    expect(lines.join("\n")).toContain("内联 2 个资源");
    expect(lines.join("\n")).toContain("找不到被引用的文件：gone.png");
    const stored = [...storage.files.values()].find((f) =>
      f.contentType.startsWith("text/html"),
    );
    expect(stored?.body.toString()).toContain(
      "<style>body { color: red }</style>",
    );
    expect(stored?.body.toString()).toContain("data:image/png;base64,");
  });

  it("changes nothing in a dry run, and needs no storage for it", async () => {
    await write("brief.pdf");
    const lines = await importDocuments(db, null, {
      sources: [{ dir, folder: ["方案"] }],
      recursive: false,
      dryRun: true,
    });

    expect(lines[0]).toBe(
      "预演完成：新建 1，替换 0，不变 0，跳过 0，失败 0（没有改动任何东西）",
    );
    expect((await getLibrary(db, storage, viewer, {})).folders).toEqual([]);
    expect(storage.files.size).toBe(0);
  });

  it("predicts a repeat run in a dry run", async () => {
    await write("brief.pdf");
    await run();
    const lines = await run({ dryRun: true });
    expect(lines[0]).toContain("不变 1");
  });

  it("refuses a real import without storage", async () => {
    const lines = await importDocuments(db, null, {
      sources: [{ dir, folder: [] }],
      recursive: false,
      dryRun: false,
    });
    expect(lines[0]).toMatch(/^✗ 还没有配置文件存储/);
  });

  it("fails cleanly on a missing directory", async () => {
    const lines = await run({
      sources: [{ dir: path.join(dir, "nope"), folder: [] }],
    });
    expect(lines[0]).toMatch(/^✗ 读不了目录/);
  });

  it("flags the run as failed when a folder name is unusable", async () => {
    await write("a.pdf");
    const lines = await run({
      sources: [{ dir, folder: ["x".repeat(81)] }],
    });
    expect(lines[0]).toMatch(/^✗ 导入完成：.*失败 1/);
  });
});

describe("import-documents arguments", () => {
  it("reads sources, folder paths and flags", () => {
    expect(
      parseCli([
        "import-documents",
        "--source",
        "/a/b=合同/2026",
        "--source",
        "/c",
        "--recursive",
        "--dry-run",
      ]),
    ).toEqual({
      ok: true,
      command: {
        name: "import-documents",
        sources: [
          { dir: "/a/b", folder: ["合同", "2026"] },
          { dir: "/c", folder: [] },
        ],
        recursive: true,
        dryRun: true,
      },
    });
  });

  it("splits on the last = so paths may contain one", () => {
    const parsed = parseCli(["import-documents", "--source", "/a=b/c=方案"]);
    expect(parsed).toMatchObject({
      ok: true,
      command: { sources: [{ dir: "/a=b/c", folder: ["方案"] }] },
    });
  });

  it.each([
    [
      ["import-documents"],
      "import-documents 需要至少一个 --source <目录>=<文件夹>",
    ],
    [["import-documents", "--source"], "--source 后面缺少值"],
    [
      ["import-documents", "--source", "=x"],
      "--source 的格式是 <目录>=<文件夹>",
    ],
    [["import-documents", "--force"], "未知参数: --force"],
  ])("rejects %j", (argv, error) => {
    expect(parseCli(argv)).toEqual({ ok: false, error });
  });
});
