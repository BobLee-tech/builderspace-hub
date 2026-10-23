import type {
  ChoiceOption,
  FieldType,
  FormAccess,
  FormDefinition,
  FormField,
  FormSettings,
} from "@kan/hub/public";
import { newFieldId } from "@kan/hub/public";

/**
 * The form as the builder edits it: everything the save call sends, kept
 * in the page until 保存. Pure helpers, no React.
 */
export interface FormDraft {
  title: string;
  access: FormAccess;
  definition: FormDefinition;
  settings: FormSettings;
  /** ISO time, or null for no deadline. */
  closesAt: string | null;
  maxResponses: number | null;
}

export function draftOf(detail: {
  title: string;
  access: FormAccess;
  definition: FormDefinition;
  settings: FormSettings;
  closesAt: Date | null;
  maxResponses: number | null;
}): FormDraft {
  return {
    title: detail.title,
    access: detail.access,
    definition: detail.definition,
    settings: detail.settings,
    closesAt: detail.closesAt ? detail.closesAt.toISOString() : null,
    maxResponses: detail.maxResponses,
  };
}

/** Whether two drafts would save the same form. */
export function sameDraft(a: FormDraft, b: FormDraft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function newOption(label = ""): ChoiceOption {
  return { id: newFieldId(), label, image: null };
}

/** A fresh question (or section) of this type, with sensible defaults. */
export function newField(type: FieldType): FormField {
  const base = {
    id: newFieldId(),
    title: "",
    help: "",
    images: [] as string[],
  };
  const question = { ...base, required: false, onWall: true };
  switch (type) {
    case "section":
      return { ...base, type };
    case "short_text":
      return { ...question, type, format: "plain" };
    case "long_text":
      return { ...question, type };
    case "single_choice":
      return {
        ...question,
        type,
        options: [newOption(), newOption()],
        allowOther: false,
      };
    case "multi_choice":
      return {
        ...question,
        type,
        options: [newOption(), newOption()],
        allowOther: false,
        minSelect: null,
        maxSelect: null,
      };
    case "image":
      return { ...question, type, maxImages: 1 };
  }
}

/** A copy of a question with new ids for it and its options. */
export function duplicateField(field: FormField): FormField {
  if (field.type === "single_choice" || field.type === "multi_choice") {
    return {
      ...field,
      id: newFieldId(),
      options: field.options.map((option) => ({ ...option, id: newFieldId() })),
    };
  }
  return { ...field, id: newFieldId() };
}

/** The list with the item at `index` moved one place up (-1) or down (+1). */
export function move<T>(items: readonly T[], index: number, by: -1 | 1): T[] {
  const target = index + by;
  if (target < 0 || target >= items.length) return [...items];
  const next = [...items];
  const [item] = next.splice(index, 1);
  if (item !== undefined) next.splice(target, 0, item);
  return next;
}

/**
 * Options from pasted lines: trimmed, blanks and labels already present
 * (in any case) skipped, and no more than `room`.
 */
export function optionsFromLines(
  lines: string,
  existing: readonly ChoiceOption[],
  room: number,
): ChoiceOption[] {
  const seen = new Set(existing.map((option) => option.label.toLowerCase()));
  const added: ChoiceOption[] = [];
  for (const raw of lines.split(/\r?\n/)) {
    const label = raw.replace(/\s+/g, " ").trim();
    if (!label || seen.has(label.toLowerCase())) continue;
    if (added.length >= room) break;
    seen.add(label.toLowerCase());
    added.push(newOption(label));
  }
  return added;
}
