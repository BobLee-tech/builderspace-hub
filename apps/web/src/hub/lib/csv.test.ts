import { describe, expect, it } from "vitest";

import { csvCell, toCsv } from "./csv";

describe("csvCell", () => {
  it("leaves plain values alone and empties missing ones", () => {
    expect(csvCell("小林")).toBe("小林");
    expect(csvCell(3)).toBe("3");
    expect(csvCell(true)).toBe("true");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("quotes cells with commas, quotes or line breaks", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
  });

  it("keeps a visitor's text from running as a formula", () => {
    expect(csvCell('=HYPERLINK("http://evil","x")')).toBe(
      `"'=HYPERLINK(""http://evil"",""x"")"`,
    );
    expect(csvCell("+61 400")).toBe("'+61 400");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@me")).toBe("'@me");
    expect(csvCell(-1)).toBe("-1");
  });
});

describe("toCsv", () => {
  it("starts with a byte order mark and ends every line with CRLF", () => {
    expect(toCsv(["昵称", "人数"], [["小林", 2]])).toBe(
      "\uFEFF昵称,人数\r\n小林,2\r\n",
    );
  });
});
