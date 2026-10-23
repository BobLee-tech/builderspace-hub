import { useRef } from "react";
import { twMerge } from "tailwind-merge";

import type { AnswerInput, ChoiceField, FormField } from "@kan/hub/public";
import { FORM_LIMITS } from "@kan/hub/public";

import { copy } from "~/hub/copy/zh";
import { inputClass } from "~/hub/ui/admin-primitives";
import { FormImg, ImageStrip, RichText } from "./form-ui";
import { panelClass } from "./FormShell";
import { ImageAnswerInput } from "./ImageAnswerInput";

const text = copy.forms.fill;

export type AnswerUpdate = (
  previous: AnswerInput | undefined,
) => AnswerInput | undefined;

export interface FieldContext {
  formId: string;
  disabled: boolean;
  signedIn: boolean;
  /** Pictures already part of this browser's sent answer. */
  attached: ReadonlySet<string>;
}

/** The element id a question's block gets, for scrolling to its error. */
export const fieldAnchor = (fieldId: string) => `field-${fieldId}`;

/** One block of the form: a section of text, or a question with its input and error. */
export function FieldBlock({
  field,
  number,
  value,
  update,
  error,
  context,
}: {
  field: FormField;
  /** The question's number; sections have none. */
  number: number | null;
  value: AnswerInput | undefined;
  update: (change: AnswerUpdate) => void;
  error: string | undefined;
  context: FieldContext;
}) {
  if (field.type === "section") {
    return (
      <section
        className={twMerge(panelClass, "bg-transparent dark:bg-transparent")}
      >
        {field.title && (
          <h2 className="text-base font-semibold text-light-1000 dark:text-dark-1000">
            {field.title}
          </h2>
        )}
        <RichText
          text={field.help}
          className="mt-1 text-sm leading-6 text-light-900 dark:text-dark-900"
        />
        {field.images.length > 0 && (
          <div className="mt-3">
            <ImageStrip ids={field.images} />
          </div>
        )}
      </section>
    );
  }

  const labelId = `${fieldAnchor(field.id)}-label`;
  return (
    <section
      id={fieldAnchor(field.id)}
      aria-labelledby={labelId}
      className={twMerge(
        panelClass,
        error && "border-red-400 dark:border-red-800",
      )}
    >
      <h2
        id={labelId}
        className="text-[15px] font-semibold leading-6 text-light-1000 dark:text-dark-1000"
      >
        {number !== null && (
          <span className="mr-1.5 text-light-800 dark:text-dark-800">
            {number}.
          </span>
        )}
        {field.title}
        {field.required && (
          <span
            className="ml-1 text-red-600 dark:text-red-400"
            title={text.required}
          >
            *<span className="sr-only">{text.required}</span>
          </span>
        )}
      </h2>
      <RichText
        text={field.help}
        className="mt-1 text-sm leading-6 text-light-900 dark:text-dark-900"
      />
      {field.images.length > 0 && (
        <div className="mt-3">
          <ImageStrip ids={field.images} />
        </div>
      )}

      <div className="mt-3">
        {field.type === "short_text" && (
          <ShortText
            field={field}
            value={value}
            update={update}
            context={context}
            labelId={labelId}
          />
        )}
        {field.type === "long_text" && (
          <LongText
            value={value}
            update={update}
            context={context}
            labelId={labelId}
          />
        )}
        {(field.type === "single_choice" || field.type === "multi_choice") && (
          <Choice
            field={field}
            value={value}
            update={update}
            context={context}
            labelId={labelId}
          />
        )}
        {field.type === "image" && (
          <ImageAnswerInput
            formId={context.formId}
            fieldId={field.id}
            maxImages={field.maxImages}
            value={Array.isArray(value) ? value : []}
            setValue={(change) =>
              update((previous) => {
                const next = change(Array.isArray(previous) ? previous : []);
                return next.length > 0 ? next : undefined;
              })
            }
            disabled={context.disabled}
            signedIn={context.signedIn}
            attached={context.attached}
            labelledBy={labelId}
          />
        )}
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}

const FORMAT_INPUT = {
  plain: {
    type: "text",
    inputMode: "text",
    autoComplete: "off",
    placeholder: "",
  },
  email: {
    type: "email",
    inputMode: "email",
    autoComplete: "email",
    placeholder: "name@example.com",
  },
  url: {
    type: "url",
    inputMode: "url",
    autoComplete: "url",
    placeholder: "https://",
  },
  phone: {
    type: "tel",
    inputMode: "tel",
    autoComplete: "tel",
    placeholder: "",
  },
  number: {
    type: "text",
    inputMode: "decimal",
    autoComplete: "off",
    placeholder: "",
  },
} as const;

const bigInput = `${inputClass} py-2.5 text-base sm:text-sm`;

function ShortText({
  field,
  value,
  update,
  context,
  labelId,
}: {
  field: Extract<FormField, { type: "short_text" }>;
  value: AnswerInput | undefined;
  update: (change: AnswerUpdate) => void;
  context: FieldContext;
  labelId: string;
}) {
  const format = FORMAT_INPUT[field.format];
  return (
    <input
      aria-labelledby={labelId}
      type={format.type}
      inputMode={format.inputMode}
      autoComplete={format.autoComplete}
      placeholder={format.placeholder}
      maxLength={FORM_LIMITS.shortText}
      disabled={context.disabled}
      className={bigInput}
      value={typeof value === "string" ? value : ""}
      onChange={(event) => {
        const next = event.target.value;
        update(() => next);
      }}
    />
  );
}

function LongText({
  value,
  update,
  context,
  labelId,
}: {
  value: AnswerInput | undefined;
  update: (change: AnswerUpdate) => void;
  context: FieldContext;
  labelId: string;
}) {
  return (
    <textarea
      aria-labelledby={labelId}
      rows={4}
      maxLength={FORM_LIMITS.longText}
      disabled={context.disabled}
      className={`${bigInput} min-h-[6rem] resize-y leading-6`}
      value={typeof value === "string" ? value : ""}
      onChange={(event) => {
        const element = event.target;
        // Grow with the text, so a long answer stays readable on a phone.
        element.style.height = "auto";
        element.style.height = `${Math.min(element.scrollHeight + 2, 480)}px`;
        const next = element.value;
        update(() => next);
      }}
    />
  );
}

interface ChoiceValue {
  selected: string[];
  other: string | null;
}

function asChoice(value: AnswerInput | undefined): ChoiceValue {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { selected: value.selected, other: value.other ?? null };
  }
  return { selected: [], other: null };
}

const choiceRow =
  "flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors";
const choiceIdle =
  "border-light-300 bg-light-50 hover:bg-light-100 dark:border-dark-300 dark:bg-dark-50 dark:hover:bg-dark-200";
const choiceOn =
  "border-light-1000 bg-light-200 dark:border-dark-1000 dark:bg-dark-200";
const choiceOff = "cursor-not-allowed opacity-50";

function Choice({
  field,
  value,
  update,
  context,
  labelId,
}: {
  field: ChoiceField;
  value: AnswerInput | undefined;
  update: (change: AnswerUpdate) => void;
  context: FieldContext;
  labelId: string;
}) {
  const otherInput = useRef<HTMLInputElement>(null);
  const multi = field.type === "multi_choice";
  const current = asChoice(value);
  const count = current.selected.length + (current.other === null ? 0 : 1);
  const max = field.type === "multi_choice" ? field.maxSelect : 1;
  const atMax = multi && max !== null && count >= max;
  const pictures = field.options.some((item) => item.image);
  const name = `choice-${field.id}`;

  const set = (next: ChoiceValue) =>
    update(() =>
      next.selected.length === 0 && next.other === null ? undefined : next,
    );

  const toggle = (optionId: string) => {
    const on = current.selected.includes(optionId);
    if (!multi) {
      set({ selected: [optionId], other: null });
      return;
    }
    if (on) {
      set({
        ...current,
        selected: current.selected.filter((id) => id !== optionId),
      });
    } else if (!atMax) {
      set({ ...current, selected: [...current.selected, optionId] });
    }
  };

  const toggleOther = () => {
    if (current.other !== null) {
      if (multi) set({ ...current, other: null });
      return;
    }
    if (atMax) return;
    set(multi ? { ...current, other: "" } : { selected: [], other: "" });
    // Wait for the box to appear, then put the cursor in it.
    setTimeout(() => otherInput.current?.focus(), 0);
  };

  const optionBox = (
    checked: boolean,
    onChange: () => void,
    blocked: boolean,
  ) => (
    <input
      type={multi ? "checkbox" : "radio"}
      name={name}
      checked={checked}
      disabled={context.disabled || blocked}
      onChange={onChange}
      className="h-4 w-4 shrink-0 accent-light-1000 dark:accent-dark-1000"
    />
  );

  return (
    <div role={multi ? "group" : "radiogroup"} aria-labelledby={labelId}>
      {multi && (
        <p className="mb-2 text-xs text-light-900 dark:text-dark-900">
          {text.choose(field.minSelect, field.maxSelect)}
        </p>
      )}
      <div
        className={
          pictures
            ? "grid grid-cols-2 gap-3 sm:grid-cols-3"
            : "flex flex-col gap-2"
        }
      >
        {field.options.map((item) => {
          const checked = current.selected.includes(item.id);
          const blocked = !checked && atMax;
          return (
            <label
              key={item.id}
              className={twMerge(
                pictures
                  ? "flex cursor-pointer flex-col gap-2 rounded-lg border p-2 text-sm transition-colors"
                  : choiceRow,
                checked ? choiceOn : choiceIdle,
                (context.disabled || blocked) && choiceOff,
              )}
            >
              {item.image && (
                <FormImg
                  id={item.image}
                  alt={item.label}
                  className="aspect-square w-full"
                />
              )}
              <span className="flex items-center gap-2.5">
                {optionBox(checked, () => toggle(item.id), blocked)}
                <span className="min-w-0 break-words text-light-1000 dark:text-dark-1000">
                  {item.label}
                </span>
              </span>
            </label>
          );
        })}
        {field.allowOther && (
          <label
            className={twMerge(
              pictures
                ? "flex cursor-pointer items-center gap-2.5 rounded-lg border p-2 text-sm"
                : choiceRow,
              current.other !== null ? choiceOn : choiceIdle,
              (context.disabled || (current.other === null && atMax)) &&
                choiceOff,
            )}
          >
            {optionBox(
              current.other !== null,
              toggleOther,
              current.other === null && atMax,
            )}
            <span className="text-light-1000 dark:text-dark-1000">
              {text.other}
            </span>
          </label>
        )}
      </div>
      {current.other !== null && (
        <input
          ref={otherInput}
          aria-label={text.other}
          placeholder={text.otherPlaceholder}
          maxLength={FORM_LIMITS.other}
          disabled={context.disabled}
          className={`${bigInput} mt-2`}
          value={current.other}
          onChange={(event) => set({ ...current, other: event.target.value })}
        />
      )}
      {!multi && !field.required && count > 0 && !context.disabled && (
        <button
          type="button"
          className="mt-2 text-xs text-light-900 underline underline-offset-2 hover:text-light-1000 dark:text-dark-900 dark:hover:text-dark-1000"
          onClick={() => set({ selected: [], other: null })}
        >
          {text.clearChoice}
        </button>
      )}
    </div>
  );
}
