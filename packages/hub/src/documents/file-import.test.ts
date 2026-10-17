import {
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from "docx";
import { describe, expect, it } from "vitest";

import { MAX_IMPORT_FILE_BYTES, MAX_TEXT_BYTES } from "./document.policy";
import { importDocumentFile } from "./file-import";

const utf8 = (text: string) => new TextEncoder().encode(text);

// A 1×1 transparent PNG.
const PIXEL = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  ),
  (char) => char.charCodeAt(0),
);

const cell = (text: string) =>
  new TableCell({ children: [new Paragraph(text)] });

async function wordFile(children: (Paragraph | Table)[]): Promise<Uint8Array> {
  const buffer = await Packer.toBuffer(
    new Document({ sections: [{ children }] }),
  );
  return new Uint8Array(buffer);
}

async function imported(name: string, bytes: Uint8Array) {
  const result = await importDocumentFile({ name, bytes });
  if (!result.ok) throw new Error(`expected ok, got: ${result.reason}`);
  return result.document;
}

async function refused(name: string, bytes: Uint8Array) {
  const result = await importDocumentFile({ name, bytes });
  if (result.ok) throw new Error("expected the file to be refused");
  return result.reason;
}

describe("importDocumentFile: Word", () => {
  it("turns headings, emphasis, lists, tables and links into Markdown and leaves pictures out", async () => {
    const bytes = await wordFile([
      new Paragraph({ text: "活动方案", heading: HeadingLevel.HEADING_1 }),
      new Paragraph({
        children: [
          new TextRun("时间是 "),
          new TextRun({ text: "周四", bold: true }),
        ],
      }),
      new Paragraph({ text: "带电脑", bullet: { level: 0 } }),
      new Paragraph({ text: "提前注册 GitHub", bullet: { level: 0 } }),
      new Table({
        rows: [
          new TableRow({ children: [cell("组"), cell("人数")] }),
          new TableRow({ children: [cell("宣发"), cell("2")] }),
          new TableRow({ children: [cell("技术 | Helper"), cell("3")] }),
        ],
      }),
      new Paragraph({
        children: [
          new ExternalHyperlink({
            link: "https://example.com/signup",
            children: [new TextRun("报名链接")],
          }),
        ],
      }),
      new Paragraph({
        children: [
          new ImageRun({
            type: "png",
            data: PIXEL,
            transformation: { width: 10, height: 10 },
          }),
        ],
      }),
    ]);

    const doc = await imported("10-22 活动方案.docx", bytes);

    expect(doc).toMatchObject({
      title: "10-22 活动方案",
      format: "md",
      fileName: "10-22 活动方案.docx",
      droppedImages: 1,
    });
    expect(doc.content).toContain("# 活动方案");
    expect(doc.content).toContain("时间是 **周四**");
    expect(doc.content).toMatch(/^- +带电脑$/m);
    expect(doc.content).toMatch(/^- +提前注册 GitHub$/m);
    expect(doc.content).toContain(
      [
        "| 组 | 人数 |",
        "| --- | --- |",
        "| 宣发 | 2 |",
        "| 技术 \\| Helper | 3 |",
      ].join("\n"),
    );
    expect(doc.content).toContain("[报名链接](https://example.com/signup)");
    expect(doc.content).not.toContain("![");
    expect(doc.content).not.toContain("data:");
  });

  it("keeps a table cell that holds several paragraphs on one line", async () => {
    const bytes = await wordFile([
      new Table({
        rows: [
          new TableRow({ children: [cell("任务"), cell("说明")] }),
          new TableRow({
            children: [
              cell("海报"),
              new TableCell({
                children: [new Paragraph("初版"), new Paragraph("何时定稿")],
              }),
            ],
          }),
        ],
      }),
    ]);

    const doc = await imported("任务.docx", bytes);

    expect(doc.content).toContain("| 海报 | 初版 何时定稿 |");
    expect(doc.droppedImages).toBe(0);
  });

  it("keeps backslashes and pipes in table cells as text", async () => {
    const bytes = await wordFile([
      new Table({
        rows: [
          new TableRow({ children: [cell("路径"), cell("说明")] }),
          new TableRow({ children: [cell("C:\\temp\\"), cell("a\\|b")] }),
        ],
      }),
    ]);

    const doc = await imported("路径.docx", bytes);

    // Shown as C:\temp\ and a\|b, in two cells of one row.
    expect(doc.content).toContain(String.raw`| C:\\temp\\ | a\\\|b |`);
  });

  it("refuses a file that is not a readable .docx", async () => {
    expect(await refused("坏文件.docx", utf8("not a zip"))).toBe(
      "这个 Word 文件打不开，可能已经损坏",
    );
  });

  it("refuses a Word file with no text in it", async () => {
    const bytes = await wordFile([new Paragraph("")]);
    expect(await refused("空白.docx", bytes)).toBe("文件里没有文字");
  });
});

describe("importDocumentFile: Markdown and HTML", () => {
  it("reads Markdown as it is and drops a byte-order mark", async () => {
    const bytes = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...utf8("# 讲稿\n\n正文\n"),
    ]);

    const doc = await imported("讲稿.md", bytes);

    expect(doc).toEqual({
      title: "讲稿",
      format: "md",
      content: "# 讲稿\n\n正文\n",
      fileName: "讲稿.md",
      droppedImages: 0,
    });
  });

  it("accepts the .markdown extension", async () => {
    expect((await imported("notes.markdown", utf8("hi"))).format).toBe("md");
  });

  it("reads .html and .htm as HTML", async () => {
    const page = "<!doctype html><h1>Hi</h1>";
    expect(await imported("page.html", utf8(page))).toMatchObject({
      format: "html",
      content: page,
    });
    expect((await imported("PAGE.HTM", utf8(page))).format).toBe("html");
  });

  it("refuses text that is not UTF-8", async () => {
    expect(await refused("gbk.md", new Uint8Array([0xff, 0xfe, 0x41]))).toBe(
      "文件不是 UTF-8 编码，请另存为 UTF-8 再上传",
    );
  });

  it("refuses an empty file and one with only whitespace", async () => {
    expect(await refused("empty.md", new Uint8Array())).toBe("文件是空的");
    expect(await refused("blank.md", utf8(" \n\t\n"))).toBe("文件里没有文字");
  });

  it("refuses text longer than a document may hold", async () => {
    const reason = await refused(
      "long.md",
      utf8("a".repeat(MAX_TEXT_BYTES + 1)),
    );
    expect(reason).toBe(
      `文字内容超过 ${MAX_TEXT_BYTES / 1024} KB，拆成几份再上传`,
    );
  });

  it("refuses a file too big to read", async () => {
    const reason = await refused(
      "huge.md",
      new Uint8Array(MAX_IMPORT_FILE_BYTES + 1),
    );
    expect(reason).toBe(
      `文件太大，上限 ${MAX_IMPORT_FILE_BYTES / 1024 / 1024} MB`,
    );
  });
});

describe("importDocumentFile: other files", () => {
  it("explains that the old .doc format has to be saved as .docx", async () => {
    expect(await refused("合同.doc", utf8("x"))).toBe(
      "老的 Word 格式（.doc）读不了，请在 Word 里另存为 .docx 再上传",
    );
  });

  it("refuses PDF, slides and files without an extension", async () => {
    const unsupported = "只能上传 .md、.html 和 Word（.docx）文件";
    expect(await refused("deck.pdf", utf8("x"))).toBe(unsupported);
    expect(await refused("deck.pptx", utf8("x"))).toBe(unsupported);
    expect(await refused("README", utf8("x"))).toBe(unsupported);
  });
});

describe("importDocumentFile: titles", () => {
  it("takes the title from the file name, tidied and shortened", async () => {
    const long = `${"很长的名字".repeat(40)}.md`;
    expect((await imported(long, utf8("x"))).title).toHaveLength(120);
    expect((await imported("  两个   空格 .md", utf8("x"))).title).toBe(
      "两个 空格",
    );
    expect((await imported(".md", utf8("x"))).title).toBe("未命名");
  });
});
