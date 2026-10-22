import { z } from "zod";

/**
 * What a form is made of, and what counts as a valid answer to it. Pure and
 * free of Node, so the form builder and the fill page in the browser run the
 * very checks the server runs (it is exported from `@kan/hub/public`).
 */

export const FORM_LIMITS = {
  title: 120,
  description: 3000,
  confirmation: 500,
  fields: 60,
  fieldTitle: 200,
  fieldHelp: 1000,
  fieldImages: 4,
  options: 50,
  optionLabel: 200,
  answerImages: 9,
  shortText: 500,
  longText: 5000,
  other: 200,
  maxResponses: 100_000,
  projects: 20,
} as const;

export const formStatuses = ["draft", "open", "closed"] as const;
export type FormStatus = (typeof formStatuses)[number];

/** Who may fill a form in: anyone with the link, signed-in members, or members of some projects. */
export const formAccessLevels = ["public", "members", "projects"] as const;
export type FormAccess = (typeof formAccessLevels)[number];

export const fieldTypes = [
  "section",
  "short_text",
  "long_text",
  "single_choice",
  "multi_choice",
  "image",
] as const;
export type FieldType = (typeof fieldTypes)[number];

export const textFormats = [
  "plain",
  "email",
  "url",
  "phone",
  "number",
] as const;
export type TextFormat = (typeof textFormats)[number];

/** Whether people see each other's answers: never, once they have answered, or always. */
export const wallModes = ["off", "after_submit", "always"] as const;
export type WallMode = (typeof wallModes)[number];

/** Who may 👍 an answer on the wall. */
export const likeModes = ["off", "signed_in", "anyone"] as const;
export type LikeMode = (typeof likeModes)[number];

const ID = /^[a-z0-9]{6,16}$/;
/** A picture is referred to by its public id (see `hub_form_image`). */
const IMAGE_ID = /^[a-z0-9]{12}$/;

const fieldId = z.string().regex(ID, "编号格式不对");
const imageId = z.string().regex(IMAGE_ID, "图片编号格式不对");

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** One line of text: trimmed, inner whitespace collapsed, no control characters. */
export function cleanLine(value: string): string {
  return value.replace(CONTROL_CHARS, "").replace(/\s+/g, " ").trim();
}

/** Text that may span lines: line ends normalised, trailing space dropped. */
export function cleanText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_CHARS, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

const line = (max: number) =>
  z
    .string()
    .max(max * 2)
    .transform(cleanLine)
    .pipe(z.string().max(max, `最多 ${max} 个字`));

const block = (max: number) =>
  z
    .string()
    .max(max * 2)
    .transform(cleanText)
    .pipe(z.string().max(max, `最多 ${max} 个字`));

const base = {
  id: fieldId,
  title: line(FORM_LIMITS.fieldTitle),
  help: block(FORM_LIMITS.fieldHelp).default(""),
  images: z
    .array(imageId)
    .max(FORM_LIMITS.fieldImages, `每题最多 ${FORM_LIMITS.fieldImages} 张图`)
    .default([]),
};

const question = {
  ...base,
  required: z.boolean().default(false),
  /** Shown on the results wall. Off for anything private, such as a phone number. */
  onWall: z.boolean().default(true),
};

const option = z.object({
  id: fieldId,
  label: line(FORM_LIMITS.optionLabel),
  image: imageId.nullable().default(null),
});

const options = z
  .array(option)
  .max(FORM_LIMITS.options, `每题最多 ${FORM_LIMITS.options} 个选项`);

const fieldSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("section"), ...base }),
  z.object({
    type: z.literal("short_text"),
    ...question,
    format: z.enum(textFormats).default("plain"),
  }),
  z.object({ type: z.literal("long_text"), ...question }),
  z.object({
    type: z.literal("single_choice"),
    ...question,
    options,
    allowOther: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("multi_choice"),
    ...question,
    options,
    allowOther: z.boolean().default(false),
    minSelect: z
      .number()
      .int()
      .min(1)
      .max(FORM_LIMITS.options)
      .nullable()
      .default(null),
    maxSelect: z
      .number()
      .int()
      .min(1)
      .max(FORM_LIMITS.options)
      .nullable()
      .default(null),
  }),
  z.object({
    type: z.literal("image"),
    ...question,
    maxImages: z.number().int().min(1).max(FORM_LIMITS.answerImages).default(1),
  }),
]);

export const definitionSchema = z.object({
  description: block(FORM_LIMITS.description).default(""),
  coverImage: imageId.nullable().default(null),
  fields: z
    .array(fieldSchema)
    .max(FORM_LIMITS.fields, `最多 ${FORM_LIMITS.fields} 道题`),
});

export const settingsSchema = z.object({
  /** One answer per signed-in person. Anonymous answers are limited per browser only. */
  limitOne: z.boolean().default(true),
  /** People may change their answer while the form is open (needs `limitOne`). */
  allowEdit: z.boolean().default(false),
  wall: z.enum(wallModes).default("off"),
  /** On the wall, show who answered (signed-in people only; anonymous stays anonymous). */
  wallShowNames: z.boolean().default(true),
  likes: z.enum(likeModes).default("off"),
  /** For `access: "projects"`: the projects whose members may answer. */
  projectIds: z
    .array(z.string().min(1).max(32))
    .max(FORM_LIMITS.projects)
    .default([]),
  /** Shown after sending. Empty means the default thank-you line. */
  confirmation: block(FORM_LIMITS.confirmation).default(""),
});

export type FormField = z.output<typeof fieldSchema>;
export type FormFieldInput = z.input<typeof fieldSchema>;
export type ChoiceOption = z.output<typeof option>;
export type FormDefinition = z.output<typeof definitionSchema>;
export type FormDefinitionInput = z.input<typeof definitionSchema>;
export type FormSettings = z.output<typeof settingsSchema>;
export type FormSettingsInput = z.input<typeof settingsSchema>;
export type QuestionField = Exclude<FormField, { type: "section" }>;
export type ChoiceField = Extract<
  FormField,
  { type: "single_choice" | "multi_choice" }
>;

export const DEFAULT_SETTINGS: FormSettings = settingsSchema.parse({});

export const isQuestion = (field: FormField): field is QuestionField =>
  field.type !== "section";

export interface Problem {
  /** The field the problem is about; absent for the form as a whole. */
  fieldId?: string;
  message: string;
}

/** "第 3 题" for the third question; sections are not counted. */
export function fieldLabel(fields: FormField[], id: string): string {
  const field = fields.find((item) => item.id === id);
  if (!field) return "这道题";
  if (field.type === "section") return "说明段落";
  const number = fields.filter(isQuestion).findIndex((item) => item.id === id);
  return `第 ${number + 1} 题`;
}

/**
 * Parses a form's questions and checks what the schema cannot: unique ids,
 * titles present, sane option lists, consistent selection limits. Every
 * problem is listed, so the builder can mark each question at once.
 */
export function checkDefinition(
  raw: unknown,
):
  | { ok: true; definition: FormDefinition }
  | { ok: false; problems: Problem[] } {
  const parsed = definitionSchema.safeParse(raw);
  if (!parsed.success) {
    const rawFields = (raw as { fields?: unknown } | null)?.fields;
    const fields = Array.isArray(rawFields)
      ? (rawFields as ({ id?: unknown; type?: unknown } | null)[])
      : [];
    return {
      ok: false,
      problems: parsed.error.issues.slice(0, 20).map((issue) => {
        const [root, index] = issue.path;
        if (root !== "fields" || typeof index !== "number") {
          return { message: issue.message };
        }
        const raw = fields[index];
        const number = fields
          .slice(0, index + 1)
          .filter((item) => item?.type !== "section").length;
        const label = raw?.type === "section" ? "说明段落" : `第 ${number} 题`;
        const message = `${label}：${issue.message}`;
        return typeof raw?.id === "string"
          ? { fieldId: raw.id, message }
          : { message };
      }),
    };
  }

  const definition = parsed.data;
  const problems: Problem[] = [];
  const seen = new Set<string>();

  for (const field of definition.fields) {
    // Two blank options are one thing to fix, so each message is said once.
    const said = new Set<string>();
    const say = (message: string) => {
      if (said.has(message)) return;
      said.add(message);
      problems.push({
        fieldId: field.id,
        message: `${fieldLabel(definition.fields, field.id)}：${message}`,
      });
    };

    if (seen.has(field.id)) say("编号和别的题重复了");
    seen.add(field.id);

    if (field.type === "section") {
      if (!field.title && !field.help && field.images.length === 0) {
        say("说明段落是空的");
      }
      continue;
    }
    if (!field.title) say("还没写题目");

    if (field.type === "single_choice" || field.type === "multi_choice") {
      if (field.options.length === 0) say("至少要有一个选项");
      const labels = new Set<string>();
      const ids = new Set<string>();
      for (const item of field.options) {
        if (!item.label && !item.image) say("有选项既没有文字也没有图片");
        const key = item.label.toLowerCase();
        if (item.label && labels.has(key)) say(`选项「${item.label}」重复了`);
        labels.add(key);
        if (ids.has(item.id)) say("选项编号重复了");
        ids.add(item.id);
      }
      if (field.type === "multi_choice") {
        const available = field.options.length + (field.allowOther ? 1 : 0);
        const { minSelect, maxSelect } = field;
        if (minSelect !== null && maxSelect !== null && minSelect > maxSelect) {
          say("最少选的数目大于最多选的数目");
        }
        if (minSelect !== null && minSelect > available) {
          say(`最少要选 ${minSelect} 项，但只有 ${available} 个选项`);
        }
      }
    }
  }

  return problems.length > 0
    ? { ok: false, problems }
    : { ok: true, definition };
}

/** Every picture a form's questions point at: the cover, question pictures, option pictures. */
export function referencedImages(definition: FormDefinition): string[] {
  const ids = new Set<string>();
  if (definition.coverImage) ids.add(definition.coverImage);
  for (const field of definition.fields) {
    for (const id of field.images) ids.add(id);
    if (field.type === "single_choice" || field.type === "multi_choice") {
      for (const item of field.options) if (item.image) ids.add(item.image);
    }
  }
  return [...ids];
}

/* ── answers ─────────────────────────────────────────────────────────── */

/**
 * An answer as stored. It carries the question's title, and each chosen
 * option its label, as they were when the answer was sent: a question or
 * option deleted later must not turn old answers into bare ids.
 */
export type StoredAnswer =
  | { type: "text"; title: string; text: string }
  | {
      type: "choice";
      title: string;
      selected: { id: string; label: string }[];
      /** What was typed next to 其他, or null when 其他 was not chosen. */
      other: string | null;
    }
  | { type: "images"; title: string; images: string[] };

/** What the fill page sends for one question. */
export type AnswerInput =
  | string
  | string[]
  | { selected: string[]; other?: string | null };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9\s\-()]{5,25}$/;
const NUMBER = /^-?\d{1,15}(\.\d{1,10})?$/;

/**
 * A web address someone typed, made absolute: "me.dev" becomes
 * "https://me.dev/". Only http and https are accepted, so a `javascript:`
 * address can never end up behind a link. Null when it is not an address.
 */
export function normaliseUrl(value: string): string | null {
  const text = value.trim();
  if (!text || text.length > 2000 || /\s/.test(text)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text)
    ? text
    : `https://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname.includes(".") && url.hostname !== "localhost") return null;
  return url.href;
}

/** The text after checking its format, or a reason it is not acceptable. */
export function checkTextFormat(
  format: TextFormat,
  text: string,
): { ok: true; text: string } | { ok: false; message: string } {
  switch (format) {
    case "email":
      return EMAIL.test(text) && text.length <= 254
        ? { ok: true, text }
        : { ok: false, message: "邮箱格式不对" };
    case "url": {
      const url = normaliseUrl(text);
      return url
        ? { ok: true, text: url }
        : { ok: false, message: "网址格式不对，例如 https://example.com" };
    }
    case "phone":
      return PHONE.test(text) && (text.match(/\d/g)?.length ?? 0) >= 5
        ? { ok: true, text }
        : { ok: false, message: "电话号码格式不对" };
    case "number":
      return NUMBER.test(text)
        ? { ok: true, text }
        : { ok: false, message: "要填一个数字" };
    default:
      return { ok: true, text };
  }
}

export type AnswerCheck =
  | { ok: true; answers: Record<string, StoredAnswer> }
  | { ok: false; errors: Record<string, string> };

const isEmpty = (value: unknown) =>
  value === undefined ||
  value === null ||
  (typeof value === "string" && value.trim() === "") ||
  (Array.isArray(value) && value.length === 0);

function checkOne(
  field: QuestionField,
  value: unknown,
): { ok: true; answer: StoredAnswer | null } | { ok: false; message: string } {
  const title = field.title;
  const missing = () =>
    field.required
      ? ({ ok: false, message: "这道题必须回答" } as const)
      : ({ ok: true, answer: null } as const);

  switch (field.type) {
    case "short_text":
    case "long_text": {
      if (isEmpty(value)) return missing();
      if (typeof value !== "string")
        return { ok: false, message: "答案格式不对" };
      const long = field.type === "long_text";
      const text = long ? cleanText(value) : cleanLine(value);
      if (!text) return missing();
      const max = long ? FORM_LIMITS.longText : FORM_LIMITS.shortText;
      if (text.length > max) return { ok: false, message: `最多 ${max} 个字` };
      if (long) return { ok: true, answer: { type: "text", title, text } };
      const checked = checkTextFormat(field.format, text);
      if (!checked.ok) return checked;
      return { ok: true, answer: { type: "text", title, text: checked.text } };
    }

    case "single_choice":
    case "multi_choice": {
      if (isEmpty(value)) return missing();
      const input = value as { selected?: unknown; other?: unknown };
      if (
        typeof input !== "object" ||
        !Array.isArray(input.selected) ||
        !input.selected.every((id) => typeof id === "string") ||
        (input.other !== undefined &&
          input.other !== null &&
          typeof input.other !== "string")
      ) {
        return { ok: false, message: "答案格式不对" };
      }
      const ids = [...new Set(input.selected)];
      const chosen = [];
      for (const id of ids) {
        const item = field.options.find((candidate) => candidate.id === id);
        if (!item) {
          return { ok: false, message: "选项已经变了，请刷新页面后重新选择" };
        }
        chosen.push({ id: item.id, label: item.label });
      }
      // Keep the builder's order, not the order the boxes were ticked in.
      chosen.sort(
        (a, b) =>
          field.options.findIndex((o) => o.id === a.id) -
          field.options.findIndex((o) => o.id === b.id),
      );

      let other: string | null = null;
      if (typeof input.other === "string") {
        if (!field.allowOther)
          return { ok: false, message: "这道题没有「其他」选项" };
        other = cleanLine(input.other);
        if (!other) return { ok: false, message: "选了「其他」，请写上内容" };
        if (other.length > FORM_LIMITS.other) {
          return {
            ok: false,
            message: `「其他」最多 ${FORM_LIMITS.other} 个字`,
          };
        }
      }

      const count = chosen.length + (other === null ? 0 : 1);
      if (count === 0) return missing();
      if (field.type === "single_choice" && count > 1) {
        return { ok: false, message: "只能选一项" };
      }
      if (field.type === "multi_choice") {
        if (field.minSelect !== null && count < field.minSelect) {
          return { ok: false, message: `至少选 ${field.minSelect} 项` };
        }
        if (field.maxSelect !== null && count > field.maxSelect) {
          return { ok: false, message: `最多选 ${field.maxSelect} 项` };
        }
      }
      return {
        ok: true,
        answer: { type: "choice", title, selected: chosen, other },
      };
    }

    case "image": {
      if (isEmpty(value)) return missing();
      if (
        !Array.isArray(value) ||
        !value.every((id) => typeof id === "string" && IMAGE_ID.test(id))
      ) {
        return { ok: false, message: "图片格式不对" };
      }
      const images = [...new Set(value as string[])];
      if (images.length > field.maxImages) {
        return { ok: false, message: `最多传 ${field.maxImages} 张图` };
      }
      return { ok: true, answer: { type: "images", title, images } };
    }
  }
}

/**
 * Checks a whole set of answers against the form as it is now. Answers to
 * questions that no longer exist are dropped; every problem is reported, keyed
 * by question, so the page can mark each one.
 */
export function checkAnswers(
  definition: FormDefinition,
  raw: unknown,
): AnswerCheck {
  const input =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const answers: Record<string, StoredAnswer> = {};
  const errors: Record<string, string> = {};

  for (const field of definition.fields) {
    if (!isQuestion(field)) continue;
    const value = Object.hasOwn(input, field.id) ? input[field.id] : undefined;
    const result = checkOne(field, value);
    if (!result.ok) errors[field.id] = result.message;
    else if (result.answer) answers[field.id] = result.answer;
  }

  return Object.keys(errors).length > 0
    ? { ok: false, errors }
    : { ok: true, answers };
}

/** The pictures a set of stored answers points at, by question. */
export function answerImages(
  answers: Record<string, StoredAnswer>,
): { fieldId: string; imageId: string }[] {
  return Object.entries(answers).flatMap(([id, answer]) =>
    answer.type === "images"
      ? answer.images.map((imageId) => ({ fieldId: id, imageId }))
      : [],
  );
}

/** An answer as one line of text, for the table and the CSV export. */
export function answerText(answer: StoredAnswer | undefined): string {
  if (!answer) return "";
  switch (answer.type) {
    case "text":
      return answer.text;
    case "choice":
      return [
        ...answer.selected.map((item) => item.label),
        ...(answer.other === null ? [] : [`其他：${answer.other}`]),
      ].join("；");
    case "images":
      return `${answer.images.length} 张图片`;
  }
}

/** Turns a stored answer back into what the fill page edits. */
export function answerToInput(answer: StoredAnswer): AnswerInput {
  switch (answer.type) {
    case "text":
      return answer.text;
    case "choice":
      return {
        selected: answer.selected.map((item) => item.id),
        other: answer.other,
      };
    case "images":
      return answer.images;
  }
}

/* ── whether a form takes answers ────────────────────────────────────── */

export type FormPhase =
  | { phase: "draft" }
  | { phase: "open" }
  | { phase: "closed"; reason: "manual" | "deadline" | "full" };

export function formPhase(
  form: {
    status: FormStatus;
    closesAt: Date | null;
    maxResponses: number | null;
  },
  responseCount: number,
  now: Date,
): FormPhase {
  if (form.status === "draft") return { phase: "draft" };
  if (form.status === "closed") return { phase: "closed", reason: "manual" };
  if (form.closesAt && form.closesAt.getTime() <= now.getTime()) {
    return { phase: "closed", reason: "deadline" };
  }
  if (form.maxResponses !== null && responseCount >= form.maxResponses) {
    return { phase: "closed", reason: "full" };
  }
  return { phase: "open" };
}

export const closedReasonText = {
  manual: "这份表单已经停止收集",
  deadline: "这份表单已经截止",
  full: "名额已满，这份表单不再收集",
} as const;

/**
 * A short random id for a new question or option, made in the browser.
 * Not a secret, only unique within one form.
 */
export function newFieldId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}
