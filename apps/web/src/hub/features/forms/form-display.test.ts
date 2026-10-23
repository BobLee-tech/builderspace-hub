import { describe, expect, it } from "vitest";

import {
  csvFilename,
  fromLocalInput,
  linkParts,
  phaseLabel,
  phaseTone,
  responsesCsv,
  toLocalInput,
} from "./form-display";

describe("phaseLabel", () => {
  it("names each phase and why a form closed", () => {
    expect(phaseLabel({ phase: "draft" })).toBe("草稿");
    expect(phaseLabel({ phase: "open" })).toBe("收集中");
    expect(phaseLabel({ phase: "closed", reason: "manual" })).toBe("已停止");
    expect(phaseLabel({ phase: "closed", reason: "deadline" })).toBe("已截止");
    expect(phaseLabel({ phase: "closed", reason: "full" })).toBe("已满");
    expect(phaseTone({ phase: "open" })).toBe("strong");
    expect(phaseTone({ phase: "closed", reason: "full" })).toBe("alert");
    expect(phaseTone({ phase: "draft" })).toBe("neutral");
  });
});

describe("linkParts", () => {
  it("finds http(s) addresses only, leaving punctuation outside", () => {
    expect(
      linkParts("看 https://me.dev/a?b=1。然后 javascript:alert(1)"),
    ).toEqual([
      { text: "看 " },
      { text: "https://me.dev/a?b=1", href: "https://me.dev/a?b=1" },
      { text: "。然后 javascript:alert(1)" },
    ]);
    expect(linkParts("(see http://x.io).")).toEqual([
      { text: "(see " },
      { text: "http://x.io", href: "http://x.io" },
      { text: ")." },
    ]);
    expect(linkParts("")).toEqual([]);
  });
});

describe("datetime-local values", () => {
  it("round-trips through the browser's zone", () => {
    const iso = new Date(2026, 9, 30, 18, 5).toISOString();
    expect(toLocalInput(iso)).toBe("2026-10-30T18:05");
    expect(fromLocalInput("2026-10-30T18:05")).toBe(iso);
    expect(toLocalInput(null)).toBe("");
    expect(toLocalInput("nonsense")).toBe("");
    expect(fromLocalInput("")).toBeNull();
    expect(fromLocalInput("nonsense")).toBeNull();
  });
});

describe("responsesCsv", () => {
  it("writes one row per answer, with deleted questions marked and pictures as links", () => {
    const csv = responsesCsv(
      {
        title: "网站",
        columns: [
          { fieldId: "a", title: "网站", removed: false },
          { fieldId: "b", title: "截图", removed: false },
          { fieldId: "c", title: "电话", removed: true },
        ],
        items: [
          {
            respondent: "Mia",
            respondentEmail: "mia@example.test",
            signedIn: true,
            likes: 2,
            createdAt: new Date(2026, 9, 22, 18, 0).toISOString(),
            updatedAt: new Date(2026, 9, 22, 19, 5).toISOString(),
            answers: {
              a: { type: "text", title: "网站", text: "=cmd" },
              b: { type: "images", title: "截图", images: ["abcdefghijkl"] },
            },
          },
          {
            respondent: null,
            respondentEmail: null,
            signedIn: false,
            likes: 0,
            createdAt: new Date(2026, 9, 22, 17, 0).toISOString(),
            updatedAt: new Date(2026, 9, 22, 17, 0).toISOString(),
            answers: {
              c: {
                type: "choice",
                title: "电话",
                selected: [{ id: "x", label: "X" }],
                other: null,
              },
            },
          },
        ],
      },
      "https://hub.test",
    );
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe(
      "填写人,邮箱,提交时间,修改时间,点赞,网站,截图,电话（已删除的题目）",
    );
    expect(lines[1]).toBe(
      "Mia,mia@example.test,2026-10-22 18:00,2026-10-22 19:05,2,'=cmd,https://hub.test/api/hub/forms/images/abcdefghijkl,",
    );
    expect(lines[2]).toBe("匿名,,2026-10-22 17:00,,0,,,X");
  });
});

describe("csvFilename", () => {
  it("keeps the title and drops characters files cannot hold", () => {
    expect(csvFilename('a/b:"c"', new Date(2026, 9, 2))).toBe(
      "a b c-20261002.csv",
    );
    expect(csvFilename("///", new Date(2026, 9, 2))).toBe("form-20261002.csv");
  });
});
