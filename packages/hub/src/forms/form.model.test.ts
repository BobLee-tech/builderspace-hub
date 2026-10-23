import { describe, expect, it } from "vitest";

import type { FormDefinition, FormFieldInput } from "./form.model";
import {
  answerImages,
  answerText,
  answerToInput,
  checkAnswers,
  checkDefinition,
  checkTextFormat,
  cleanText,
  fieldLabel,
  FORM_LIMITS,
  formPhase,
  newFieldId,
  normaliseUrl,
  referencedImages,
} from "./form.model";

const IMG = "abcdefghijkl";
const IMG2 = "mnopqrstuvwx";

const field = (
  overrides: Partial<FormFieldInput> & { type: FormFieldInput["type"] },
) =>
  ({
    id: `f${Math.random().toString(36).slice(2, 10)}`,
    title: "题目",
    ...overrides,
  }) as FormFieldInput;

const define = (
  fields: FormFieldInput[],
  extra: object = {},
): FormDefinition => {
  const checked = checkDefinition({ fields, ...extra });
  if (!checked.ok) throw new Error(JSON.stringify(checked.problems));
  return checked.definition;
};

describe("checkDefinition", () => {
  it("accepts a form and fills in the defaults", () => {
    const result = checkDefinition({
      fields: [{ id: "name01", type: "short_text", title: "  你的  称呼 " }],
    });
    expect(result).toEqual({
      ok: true,
      definition: {
        description: "",
        coverImage: null,
        fields: [
          {
            id: "name01",
            type: "short_text",
            title: "你的 称呼",
            help: "",
            images: [],
            required: false,
            onWall: true,
            format: "plain",
          },
        ],
      },
    });
  });

  it("names the question each problem is about, counting only questions", () => {
    const result = checkDefinition({
      fields: [
        { id: "sect01", type: "section", title: "说明" },
        { id: "qone01", type: "short_text", title: "" },
        { id: "qtwo02", type: "single_choice", title: "选一个", options: [] },
      ],
    });
    expect(result).toEqual({
      ok: false,
      problems: [
        { fieldId: "qone01", message: "第 1 题：还没写题目" },
        { fieldId: "qtwo02", message: "第 2 题：至少要有一个选项" },
      ],
    });
  });

  it("reports schema problems with the question number", () => {
    const result = checkDefinition({
      fields: [
        { id: "sect01", type: "section", title: "说明" },
        {
          id: "qone01",
          type: "short_text",
          title: "x".repeat(FORM_LIMITS.fieldTitle + 1),
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems[0]).toEqual({
        fieldId: "qone01",
        message: `第 1 题：最多 ${FORM_LIMITS.fieldTitle} 个字`,
      });
    }
  });

  it("reports problems with the form itself without a question", () => {
    const result = checkDefinition({ fields: "nope" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]?.fieldId).toBeUndefined();
    expect(checkDefinition(null).ok).toBe(false);
  });

  it("refuses bad ids, duplicate ids and too many questions", () => {
    expect(
      checkDefinition({
        fields: [{ id: "BAD ID", type: "long_text", title: "a" }],
      }).ok,
    ).toBe(false);
    const twice = checkDefinition({
      fields: [
        { id: "same01", type: "long_text", title: "a" },
        { id: "same01", type: "long_text", title: "b" },
      ],
    });
    expect(twice.ok).toBe(false);
    if (!twice.ok)
      expect(twice.problems[0]?.message).toContain("编号和别的题重复了");

    const many = Array.from({ length: FORM_LIMITS.fields + 1 }, (_, i) => ({
      id: `field${i}`,
      type: "long_text",
      title: "a",
    }));
    expect(checkDefinition({ fields: many }).ok).toBe(false);
  });

  it("refuses an empty section but takes one with only a picture", () => {
    expect(
      checkDefinition({
        fields: [{ id: "sect01", type: "section", title: "" }],
      }).ok,
    ).toBe(false);
    expect(
      checkDefinition({
        fields: [{ id: "sect01", type: "section", title: "", images: [IMG] }],
      }).ok,
    ).toBe(true);
  });

  it("checks options: present, labelled or pictured, not repeated", () => {
    const options = (list: object[]) =>
      checkDefinition({
        fields: [
          { id: "pick01", type: "multi_choice", title: "选", options: list },
        ],
      });
    expect(options([{ id: "opt001", label: "", image: IMG }]).ok).toBe(true);
    const blank = options([
      { id: "opt001", label: "" },
      { id: "opt002", label: "" },
    ]);
    expect(!blank.ok && blank.problems).toEqual([
      { fieldId: "pick01", message: "第 1 题：有选项既没有文字也没有图片" },
    ]);
    const repeated = options([
      { id: "opt001", label: "Red" },
      { id: "opt002", label: "red" },
    ]);
    expect(!repeated.ok && repeated.problems[0]?.message).toContain("重复了");
    const sameId = options([
      { id: "opt001", label: "a" },
      { id: "opt001", label: "b" },
    ]);
    expect(!sameId.ok && sameId.problems[0]?.message).toContain(
      "选项编号重复了",
    );
  });

  it("checks that selection limits can be met", () => {
    const multi = (extra: object) =>
      checkDefinition({
        fields: [
          {
            id: "pick01",
            type: "multi_choice",
            title: "选",
            options: [
              { id: "opt001", label: "a" },
              { id: "opt002", label: "b" },
            ],
            ...extra,
          },
        ],
      });
    expect(multi({ minSelect: 2, maxSelect: 2 }).ok).toBe(true);
    expect(multi({ minSelect: 2, maxSelect: 1 }).ok).toBe(false);
    expect(multi({ minSelect: 3 }).ok).toBe(false);
    expect(multi({ minSelect: 3, allowOther: true }).ok).toBe(true);
  });
});

describe("referencedImages and fieldLabel", () => {
  it("lists the cover, question and option pictures once each", () => {
    const definition = define(
      [
        field({ type: "section", images: [IMG] }),
        field({
          type: "single_choice",
          options: [
            { id: "opt001", label: "a", image: IMG2 },
            { id: "opt002", label: "b" },
          ],
        }),
      ],
      { coverImage: IMG },
    );
    expect(referencedImages(definition).sort()).toEqual([IMG, IMG2]);
  });

  it("labels sections, questions and unknown ids", () => {
    const definition = define([
      field({ id: "sect01", type: "section" }),
      field({ id: "qone01", type: "long_text" }),
    ]);
    expect(fieldLabel(definition.fields, "sect01")).toBe("说明段落");
    expect(fieldLabel(definition.fields, "qone01")).toBe("第 1 题");
    expect(fieldLabel(definition.fields, "nope00")).toBe("这道题");
  });
});

describe("normaliseUrl and text formats", () => {
  it("adds https and keeps http(s) only", () => {
    expect(normaliseUrl("me.dev")).toBe("https://me.dev/");
    expect(normaliseUrl("http://Me.dev/a?b=1")).toBe("http://me.dev/a?b=1");
    expect(normaliseUrl("javascript:alert(1)")).toBeNull();
    expect(normaliseUrl("ftp://me.dev")).toBeNull();
    expect(normaliseUrl("not a url")).toBeNull();
    expect(normaliseUrl("nodot")).toBeNull();
    expect(normaliseUrl("http://localhost:3000")).toBe(
      "http://localhost:3000/",
    );
    expect(normaliseUrl("")).toBeNull();
    expect(normaliseUrl("https://[bad")).toBeNull();
  });

  it("checks e-mail, phone and number", () => {
    expect(checkTextFormat("email", "a@b.co").ok).toBe(true);
    expect(checkTextFormat("email", "a@b").ok).toBe(false);
    expect(checkTextFormat("phone", "+86 138-0000-0000").ok).toBe(true);
    expect(checkTextFormat("phone", "12-3").ok).toBe(false);
    expect(checkTextFormat("number", "-3.5").ok).toBe(true);
    expect(checkTextFormat("number", "1e5").ok).toBe(false);
    expect(checkTextFormat("plain", "anything").ok).toBe(true);
  });

  it("cleans multi-line text", () => {
    expect(cleanText(" a \r\n\r\n\r\n\r\n\r\nb\u0007 ")).toBe("a\n\n\nb");
  });
});

describe("checkAnswers", () => {
  const definition = define([
    field({ id: "sect01", type: "section" }),
    field({ id: "name01", type: "short_text", title: "称呼", required: true }),
    field({ id: "site01", type: "short_text", title: "网站", format: "url" }),
    field({ id: "bio001", type: "long_text", title: "介绍" }),
    field({
      id: "role01",
      type: "single_choice",
      title: "角色",
      allowOther: true,
      options: [
        { id: "dev001", label: "开发" },
        { id: "des001", label: "设计" },
      ],
    }),
    field({
      id: "tags01",
      type: "multi_choice",
      title: "兴趣",
      minSelect: 1,
      maxSelect: 2,
      options: [
        { id: "a00001", label: "A" },
        { id: "b00001", label: "B" },
        { id: "c00001", label: "C" },
      ],
    }),
    field({ id: "shot01", type: "image", title: "截图", maxImages: 2 }),
  ]);

  it("stores answers with titles and labels, and drops unknown questions", () => {
    const result = checkAnswers(definition, {
      name01: "  小明  ",
      site01: "xiaoming.dev",
      bio001: "第一行\r\n第二行",
      role01: { selected: ["dev001"] },
      tags01: { selected: ["c00001", "a00001", "a00001"] },
      shot01: [IMG],
      gone01: "ignored",
      sect01: "ignored",
    });
    expect(result).toEqual({
      ok: true,
      answers: {
        name01: { type: "text", title: "称呼", text: "小明" },
        site01: { type: "text", title: "网站", text: "https://xiaoming.dev/" },
        bio001: { type: "text", title: "介绍", text: "第一行\n第二行" },
        role01: {
          type: "choice",
          title: "角色",
          selected: [{ id: "dev001", label: "开发" }],
          other: null,
        },
        tags01: {
          type: "choice",
          title: "兴趣",
          selected: [
            { id: "a00001", label: "A" },
            { id: "c00001", label: "C" },
          ],
          other: null,
        },
        shot01: { type: "images", title: "截图", images: [IMG] },
      },
    });
  });

  it("reports every problem at once, by question", () => {
    const result = checkAnswers(definition, {
      name01: "   ",
      site01: "javascript:alert(1)",
      role01: { selected: ["dev001", "des001"] },
      tags01: { selected: ["a00001", "b00001", "c00001"] },
      shot01: [IMG, IMG2, "zzzzzzzzzzzz"],
    });
    expect(result).toEqual({
      ok: false,
      errors: {
        name01: "这道题必须回答",
        site01: "网址格式不对，例如 https://example.com",
        role01: "只能选一项",
        tags01: "最多选 2 项",
        shot01: "最多传 2 张图",
      },
    });
  });

  it("handles 其他", () => {
    const one = (value: unknown) =>
      checkAnswers(definition, { name01: "x", role01: value });
    expect(one({ selected: [], other: " 产品 " })).toMatchObject({
      ok: true,
      answers: { role01: { selected: [], other: "产品" } },
    });
    expect(one({ selected: [], other: "  " })).toMatchObject({
      ok: false,
      errors: { role01: "选了「其他」，请写上内容" },
    });
    expect(one({ selected: ["dev001"], other: "x" })).toMatchObject({
      ok: false,
      errors: { role01: "只能选一项" },
    });
    expect(
      checkAnswers(definition, {
        name01: "x",
        tags01: { selected: ["a00001"], other: "y" },
      }),
    ).toMatchObject({
      ok: false,
      errors: { tags01: "这道题没有「其他」选项" },
    });
    expect(
      one({ selected: [], other: "x".repeat(FORM_LIMITS.other + 1) }),
    ).toMatchObject({
      ok: false,
    });
  });

  it("refuses options that no longer exist and malformed answers", () => {
    expect(
      checkAnswers(definition, {
        name01: "x",
        role01: { selected: ["zzz999"] },
      }),
    ).toMatchObject({
      ok: false,
      errors: { role01: "选项已经变了，请刷新页面后重新选择" },
    });
    expect(checkAnswers(definition, { name01: 5 })).toMatchObject({
      ok: false,
      errors: { name01: "答案格式不对" },
    });
    expect(
      checkAnswers(definition, { name01: "x", role01: "dev001" }),
    ).toMatchObject({
      ok: false,
      errors: { role01: "答案格式不对" },
    });
    expect(
      checkAnswers(definition, { name01: "x", shot01: "abc" }),
    ).toMatchObject({
      ok: false,
      errors: { shot01: "图片格式不对" },
    });
    expect(checkAnswers(definition, ["not", "an", "object"])).toMatchObject({
      ok: false,
      errors: { name01: "这道题必须回答" },
    });
  });

  it("treats an empty optional answer as no answer, and enforces minimums", () => {
    expect(
      checkAnswers(definition, { name01: "x", tags01: { selected: [] } }),
    ).toEqual({
      ok: true,
      answers: { name01: { type: "text", title: "称呼", text: "x" } },
    });
    const strict = define([
      field({
        id: "tags01",
        type: "multi_choice",
        minSelect: 2,
        options: [
          { id: "a00001", label: "A" },
          { id: "b00001", label: "B" },
        ],
      }),
    ]);
    expect(
      checkAnswers(strict, { tags01: { selected: ["a00001"] } }),
    ).toMatchObject({
      ok: false,
      errors: { tags01: "至少选 2 项" },
    });
  });

  it("collapses a one-line answer and limits lengths", () => {
    expect(checkAnswers(definition, { name01: "a\nb" })).toMatchObject({
      ok: true,
      answers: { name01: { text: "a b" } },
    });
    expect(
      checkAnswers(definition, {
        name01: "x".repeat(FORM_LIMITS.shortText + 1),
      }),
    ).toMatchObject({ ok: false });
    expect(
      checkAnswers(definition, {
        name01: "x",
        bio001: "x".repeat(FORM_LIMITS.longText + 1),
      }),
    ).toMatchObject({ ok: false });
  });
});

describe("answer helpers", () => {
  const answers = {
    a: { type: "text" as const, title: "A", text: "hi" },
    b: {
      type: "choice" as const,
      title: "B",
      selected: [{ id: "x", label: "X" }],
      other: "Y",
    },
    c: { type: "images" as const, title: "C", images: [IMG, IMG2] },
  };

  it("turns answers into text, inputs and picture lists", () => {
    expect(answerText(answers.a)).toBe("hi");
    expect(answerText(answers.b)).toBe("X；其他：Y");
    expect(answerText(answers.c)).toBe("2 张图片");
    expect(answerText(undefined)).toBe("");
    expect(answerToInput(answers.a)).toBe("hi");
    expect(answerToInput(answers.b)).toEqual({ selected: ["x"], other: "Y" });
    expect(answerToInput(answers.c)).toEqual([IMG, IMG2]);
    expect(answerImages(answers)).toEqual([
      { fieldId: "c", imageId: IMG },
      { fieldId: "c", imageId: IMG2 },
    ]);
  });

  it("makes field ids the model accepts", () => {
    expect(newFieldId()).toMatch(/^[a-z0-9]{10}$/);
  });
});

describe("formPhase", () => {
  const now = new Date("2026-10-22T12:00:00Z");
  const form = (extra: object) => ({
    status: "open" as const,
    closesAt: null,
    maxResponses: null,
    ...extra,
  });

  it("is draft, open, or closed for a reason", () => {
    expect(formPhase(form({ status: "draft" }), 0, now)).toEqual({
      phase: "draft",
    });
    expect(formPhase(form({}), 0, now)).toEqual({ phase: "open" });
    expect(formPhase(form({ status: "closed" }), 0, now)).toEqual({
      phase: "closed",
      reason: "manual",
    });
    expect(formPhase(form({ closesAt: now }), 0, now)).toEqual({
      phase: "closed",
      reason: "deadline",
    });
    expect(
      formPhase(form({ closesAt: new Date(now.getTime() + 1) }), 0, now),
    ).toEqual({ phase: "open" });
    expect(formPhase(form({ maxResponses: 2 }), 2, now)).toEqual({
      phase: "closed",
      reason: "full",
    });
    expect(formPhase(form({ maxResponses: 2 }), 1, now)).toEqual({
      phase: "open",
    });
  });
});
