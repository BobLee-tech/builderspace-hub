import { useState } from "react";
import {
  TbArrowDown,
  TbArrowUp,
  TbCopy,
  TbPlus,
  TbTrash,
  TbX,
} from "react-icons/tb";
import { twMerge } from "tailwind-merge";

import type {
  ChoiceField,
  ChoiceOption,
  FieldType,
  FormField,
  TextFormat,
} from "@kan/hub/public";
import { fieldTypes, FORM_LIMITS, textFormats } from "@kan/hub/public";

import type { FormDraft } from "./form-draft";
import { copy } from "~/hub/copy/zh";
import { buttonClass, Card, inputClass } from "~/hub/ui/admin-primitives";
import { AssetImageButton } from "./AssetImageButton";
import {
  duplicateField,
  move,
  newField,
  newOption,
  optionsFromLines,
} from "./form-draft";
import { FormImg } from "./form-ui";

const text = copy.forms.builder;

const labelClass =
  "mb-1 block text-xs font-medium text-light-900 dark:text-dark-900";
const iconButton =
  "inline-flex h-7 w-7 items-center justify-center rounded-md text-light-900 hover:bg-light-200 hover:text-light-1000 disabled:cursor-not-allowed disabled:opacity-40 dark:text-dark-900 dark:hover:bg-dark-200 dark:hover:text-dark-1000";
const checkClass =
  "h-4 w-4 rounded border-light-500 text-light-1000 focus:ring-0 dark:border-dark-500";

/** The 题目 tab: title, description, cover, and the questions in order. */
export function FormBuilder({
  formId,
  draft,
  onChange,
  problems,
  formProblems,
  savedFieldIds,
  hasResponses,
}: {
  formId: string;
  draft: FormDraft;
  onChange: (draft: FormDraft) => void;
  /** Problems to show, by question id (only after the first save attempt). */
  problems: Map<string, string[]>;
  formProblems: string[];
  /** Questions already saved: once answered, deleting them needs a warning. */
  savedFieldIds: ReadonlySet<string>;
  hasResponses: boolean;
}) {
  const { definition } = draft;
  const fields = definition.fields;
  const setFields = (next: FormField[]) =>
    onChange({ ...draft, definition: { ...definition, fields: next } });

  let questionNumber = 0;

  return (
    <div className="space-y-4">
      <Card>
        <div className="space-y-4">
          <label className="block">
            <span className={labelClass}>{text.formTitle}</span>
            <input
              className={`${inputClass} text-base font-semibold`}
              maxLength={FORM_LIMITS.title}
              value={draft.title}
              onChange={(event) =>
                onChange({ ...draft, title: event.target.value })
              }
            />
          </label>
          <label className="block">
            <span className={labelClass}>{text.description}</span>
            <textarea
              className={`${inputClass} min-h-[88px]`}
              maxLength={FORM_LIMITS.description}
              placeholder={text.descriptionPlaceholder}
              value={definition.description}
              onChange={(event) =>
                onChange({
                  ...draft,
                  definition: {
                    ...definition,
                    description: event.target.value,
                  },
                })
              }
            />
          </label>
          <div>
            <span className={labelClass}>{text.cover}</span>
            {definition.coverImage ? (
              <div className="space-y-2">
                <FormImg
                  id={definition.coverImage}
                  className="h-40 w-full sm:h-52"
                />
                <button
                  type="button"
                  className={buttonClass.ghost}
                  onClick={() =>
                    onChange({
                      ...draft,
                      definition: { ...definition, coverImage: null },
                    })
                  }
                >
                  {text.removeCover}
                </button>
              </div>
            ) : (
              <AssetImageButton
                formId={formId}
                label={text.addCover}
                onUploaded={(id) =>
                  onChange({
                    ...draft,
                    definition: { ...definition, coverImage: id },
                  })
                }
              />
            )}
          </div>
          {formProblems.map((problem) => (
            <p
              key={problem}
              role="alert"
              className="text-sm text-red-600 dark:text-red-400"
            >
              {problem}
            </p>
          ))}
        </div>
      </Card>

      {fields.length === 0 && (
        <p className="rounded-xl border border-dashed border-light-400 p-6 text-center text-sm text-light-900 dark:border-dark-400 dark:text-dark-900">
          {text.empty}
        </p>
      )}

      {fields.map((field, index) => {
        if (field.type !== "section") questionNumber += 1;
        return (
          <FieldCard
            key={field.id}
            formId={formId}
            field={field}
            label={
              field.type === "section"
                ? copy.forms.fieldTypes.section
                : `第 ${questionNumber} 题 · ${copy.forms.fieldTypes[field.type]}`
            }
            problems={problems.get(field.id) ?? []}
            isFirst={index === 0}
            isLast={index === fields.length - 1}
            canAdd={fields.length < FORM_LIMITS.fields}
            warnOnDelete={hasResponses && savedFieldIds.has(field.id)}
            onChange={(next) =>
              setFields(
                fields.map((item) => (item.id === field.id ? next : item)),
              )
            }
            onMove={(by) => setFields(move(fields, index, by))}
            onDuplicate={() =>
              setFields([
                ...fields.slice(0, index + 1),
                duplicateField(field),
                ...fields.slice(index + 1),
              ])
            }
            onDelete={() =>
              setFields(fields.filter((item) => item.id !== field.id))
            }
          />
        );
      })}

      <AddFieldMenu
        disabled={fields.length >= FORM_LIMITS.fields}
        onAdd={(type) => setFields([...fields, newField(type)])}
      />
    </div>
  );
}

function AddFieldMenu({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: (type: FieldType) => void;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        className={twMerge(
          buttonClass.ghost,
          "w-full gap-1.5 border-dashed py-3",
        )}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <TbPlus size={16} aria-hidden="true" />
        {text.addField}
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-light-300 bg-light-50 p-3 dark:border-dark-300 dark:bg-dark-100">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {fieldTypes.map((type) => (
          <button
            key={type}
            type="button"
            className="rounded-lg border border-light-300 p-3 text-left hover:border-light-600 hover:bg-light-100 dark:border-dark-300 dark:hover:border-dark-600 dark:hover:bg-dark-200"
            onClick={() => {
              onAdd(type);
              setOpen(false);
            }}
          >
            <span className="block text-sm font-medium text-light-1000 dark:text-dark-1000">
              {copy.forms.fieldTypes[type]}
            </span>
            <span className="mt-0.5 block text-xs text-light-900 dark:text-dark-900">
              {copy.forms.fieldTypeHints[type]}
            </span>
          </button>
        ))}
      </div>
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          className={buttonClass.ghost}
          onClick={() => setOpen(false)}
        >
          {copy.forms.list.cancel}
        </button>
      </div>
    </div>
  );
}

function FieldCard({
  formId,
  field,
  label,
  problems,
  isFirst,
  isLast,
  canAdd,
  warnOnDelete,
  onChange,
  onMove,
  onDuplicate,
  onDelete,
}: {
  formId: string;
  field: FormField;
  label: string;
  problems: string[];
  isFirst: boolean;
  isLast: boolean;
  canAdd: boolean;
  warnOnDelete: boolean;
  onChange: (field: FormField) => void;
  onMove: (by: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const isSection = field.type === "section";

  return (
    <section
      id={`field-${field.id}`}
      className={twMerge(
        "rounded-xl border border-light-300 bg-light-50 p-4 dark:border-dark-300 dark:bg-dark-100",
        problems.length > 0 && "border-red-300 dark:border-red-900",
      )}
    >
      <header className="mb-3 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-light-900 dark:text-dark-900">
          {label}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            className={iconButton}
            title={text.moveUp}
            aria-label={text.moveUp}
            disabled={isFirst}
            onClick={() => onMove(-1)}
          >
            <TbArrowUp size={16} />
          </button>
          <button
            type="button"
            className={iconButton}
            title={text.moveDown}
            aria-label={text.moveDown}
            disabled={isLast}
            onClick={() => onMove(1)}
          >
            <TbArrowDown size={16} />
          </button>
          <button
            type="button"
            className={iconButton}
            title={text.duplicateField}
            aria-label={text.duplicateField}
            disabled={!canAdd}
            onClick={onDuplicate}
          >
            <TbCopy size={16} />
          </button>
          <button
            type="button"
            className={twMerge(
              iconButton,
              "hover:text-red-600 dark:hover:text-red-400",
            )}
            title={text.deleteField}
            aria-label={text.deleteField}
            onClick={() =>
              warnOnDelete ? setConfirmingDelete(true) : onDelete()
            }
          >
            <TbTrash size={16} />
          </button>
        </div>
      </header>

      {confirmingDelete && (
        <div className="mb-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <p>{text.deleteAnswered}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className={buttonClass.danger}
              onClick={onDelete}
            >
              {copy.admin.confirm}
              {text.deleteField}
            </button>
            <button
              type="button"
              className={buttonClass.ghost}
              onClick={() => setConfirmingDelete(false)}
            >
              {copy.admin.cancel}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <label className="block">
          <span className={labelClass}>
            {isSection ? text.sectionTitle : text.questionTitle}
          </span>
          <input
            className={inputClass}
            maxLength={FORM_LIMITS.fieldTitle}
            value={field.title}
            onChange={(event) =>
              onChange({ ...field, title: event.target.value })
            }
          />
        </label>
        <label className="block">
          <span className={labelClass}>
            {isSection ? text.sectionBody : text.help}
          </span>
          <textarea
            className={`${inputClass} ${isSection ? "min-h-[88px]" : "min-h-[56px]"}`}
            maxLength={FORM_LIMITS.fieldHelp}
            value={field.help}
            onChange={(event) =>
              onChange({ ...field, help: event.target.value })
            }
          />
        </label>

        <FieldImages
          formId={formId}
          images={field.images}
          onChange={(images) => onChange({ ...field, images })}
        />

        {field.type === "short_text" && (
          <label className="block max-w-xs">
            <span className={labelClass}>{text.format}</span>
            <select
              className={inputClass}
              value={field.format}
              onChange={(event) => {
                const format = event.target.value as TextFormat;
                // Phone numbers and e-mail addresses are private by default.
                const onWall =
                  format === "email" || format === "phone"
                    ? false
                    : field.onWall;
                onChange({ ...field, format, onWall });
              }}
            >
              {textFormats.map((format) => (
                <option key={format} value={format}>
                  {copy.forms.textFormats[format]}
                </option>
              ))}
            </select>
          </label>
        )}

        {(field.type === "single_choice" || field.type === "multi_choice") && (
          <OptionsEditor formId={formId} field={field} onChange={onChange} />
        )}

        {field.type === "image" && (
          <label className="block max-w-xs">
            <span className={labelClass}>{text.maxImages}</span>
            <select
              className={inputClass}
              value={field.maxImages}
              onChange={(event) =>
                onChange({ ...field, maxImages: Number(event.target.value) })
              }
            >
              {Array.from(
                { length: FORM_LIMITS.answerImages },
                (_, i) => i + 1,
              ).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}

        {field.type !== "section" && (
          <div className="flex flex-wrap gap-x-6 gap-y-2 pt-1 text-sm text-light-1000 dark:text-dark-1000">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                className={checkClass}
                checked={field.required}
                onChange={(event) =>
                  onChange({ ...field, required: event.target.checked })
                }
              />
              {text.required}
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                className={checkClass}
                checked={field.onWall}
                onChange={(event) =>
                  onChange({ ...field, onWall: event.target.checked })
                }
              />
              {text.onWall}
              <span className="text-xs text-light-900 dark:text-dark-900">
                {text.onWallHint}
              </span>
            </label>
          </div>
        )}

        {problems.map((problem) => (
          <p
            key={problem}
            role="alert"
            className="text-sm text-red-600 dark:text-red-400"
          >
            {problem}
          </p>
        ))}
      </div>
    </section>
  );
}

function FieldImages({
  formId,
  images,
  onChange,
}: {
  formId: string;
  images: string[];
  onChange: (images: string[]) => void;
}) {
  return (
    <div>
      <span className={labelClass}>{text.images}</span>
      <div className="flex flex-wrap items-start gap-2">
        {images.map((id) => (
          <div key={id} className="relative">
            <FormImg id={id} className="h-20 w-20" />
            <button
              type="button"
              className="absolute -right-2 -top-2 inline-flex h-6 w-6 items-center justify-center rounded-full border border-light-400 bg-light-50 text-light-900 hover:text-red-600 dark:border-dark-400 dark:bg-dark-100 dark:text-dark-900"
              title={text.removeImage}
              aria-label={text.removeImage}
              onClick={() => onChange(images.filter((item) => item !== id))}
            >
              <TbX size={12} />
            </button>
          </div>
        ))}
        {images.length < FORM_LIMITS.fieldImages && (
          <AssetImageButton
            formId={formId}
            label={text.addImage}
            onUploaded={(id) => onChange([...images, id])}
          />
        )}
      </div>
    </div>
  );
}

function OptionsEditor({
  formId,
  field,
  onChange,
}: {
  formId: string;
  field: ChoiceField;
  onChange: (field: FormField) => void;
}) {
  const [bulk, setBulk] = useState<string | null>(null);
  const { options } = field;
  const room = FORM_LIMITS.options - options.length;

  const setOptions = (next: ChoiceOption[]) => {
    if (field.type === "multi_choice") {
      // Limits that the shorter list can no longer meet are dropped.
      const available = next.length + (field.allowOther ? 1 : 0);
      onChange({
        ...field,
        options: next,
        minSelect:
          field.minSelect !== null && field.minSelect > available
            ? null
            : field.minSelect,
        maxSelect:
          field.maxSelect !== null && field.maxSelect > available
            ? null
            : field.maxSelect,
      });
    } else {
      onChange({ ...field, options: next });
    }
  };

  return (
    <div>
      <span className={labelClass}>{text.options}</span>
      <ul className="space-y-2">
        {options.map((option, index) => (
          <li key={option.id} className="flex flex-wrap items-center gap-2">
            <span
              aria-hidden="true"
              className={twMerge(
                "h-4 w-4 shrink-0 border border-light-500 dark:border-dark-500",
                field.type === "single_choice" ? "rounded-full" : "rounded",
              )}
            />
            <input
              className={`${inputClass} min-w-0 flex-1`}
              maxLength={FORM_LIMITS.optionLabel}
              placeholder={text.optionPlaceholder(index + 1)}
              value={option.label}
              onChange={(event) =>
                setOptions(
                  options.map((item) =>
                    item.id === option.id
                      ? { ...item, label: event.target.value }
                      : item,
                  ),
                )
              }
            />
            {option.image ? (
              <span className="relative">
                <FormImg id={option.image} className="h-9 w-9" />
                <button
                  type="button"
                  className="absolute -right-1.5 -top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full border border-light-400 bg-light-50 text-light-900 hover:text-red-600 dark:border-dark-400 dark:bg-dark-100 dark:text-dark-900"
                  title={text.removeImage}
                  aria-label={text.removeImage}
                  onClick={() =>
                    setOptions(
                      options.map((item) =>
                        item.id === option.id ? { ...item, image: null } : item,
                      ),
                    )
                  }
                >
                  <TbX size={10} />
                </button>
              </span>
            ) : (
              <AssetImageButton
                formId={formId}
                compact
                label={text.optionImage}
                onUploaded={(id) =>
                  setOptions(
                    options.map((item) =>
                      item.id === option.id ? { ...item, image: id } : item,
                    ),
                  )
                }
              />
            )}
            <span className="flex">
              <button
                type="button"
                className={iconButton}
                title={text.moveUp}
                aria-label={text.moveUp}
                disabled={index === 0}
                onClick={() => setOptions(move(options, index, -1))}
              >
                <TbArrowUp size={14} />
              </button>
              <button
                type="button"
                className={iconButton}
                title={text.moveDown}
                aria-label={text.moveDown}
                disabled={index === options.length - 1}
                onClick={() => setOptions(move(options, index, 1))}
              >
                <TbArrowDown size={14} />
              </button>
              <button
                type="button"
                className={twMerge(iconButton, "hover:text-red-600")}
                title={text.removeOption}
                aria-label={text.removeOption}
                onClick={() =>
                  setOptions(options.filter((item) => item.id !== option.id))
                }
              >
                <TbX size={14} />
              </button>
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className={twMerge(buttonClass.ghost, "gap-1")}
          disabled={room <= 0}
          onClick={() => setOptions([...options, newOption()])}
        >
          <TbPlus size={14} aria-hidden="true" />
          {text.addOption}
        </button>
        {bulk === null && (
          <button
            type="button"
            className={buttonClass.ghost}
            disabled={room <= 0}
            onClick={() => setBulk("")}
          >
            {text.addOptionsBulk}
          </button>
        )}
      </div>

      {bulk !== null && (
        <div className="mt-2 space-y-2">
          <textarea
            autoFocus
            className={`${inputClass} min-h-[96px]`}
            placeholder={text.bulkHint}
            aria-label={text.bulkHint}
            value={bulk}
            onChange={(event) => setBulk(event.target.value)}
          />
          <div className="flex gap-2">
            <button
              type="button"
              className={buttonClass.primary}
              onClick={() => {
                // Empty placeholder options are replaced by the pasted ones.
                const kept = options.filter((item) => item.label || item.image);
                setOptions([
                  ...kept,
                  ...optionsFromLines(
                    bulk,
                    kept,
                    FORM_LIMITS.options - kept.length,
                  ),
                ]);
                setBulk(null);
              }}
            >
              {text.bulkAdd}
            </button>
            <button
              type="button"
              className={buttonClass.ghost}
              onClick={() => setBulk(null)}
            >
              {copy.forms.list.cancel}
            </button>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-light-1000 dark:text-dark-1000">
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            className={checkClass}
            checked={field.allowOther}
            onChange={(event) =>
              onChange({ ...field, allowOther: event.target.checked })
            }
          />
          {text.allowOther}
        </label>
        {field.type === "multi_choice" && (
          <SelectionLimits field={field} onChange={onChange} />
        )}
      </div>
    </div>
  );
}

function SelectionLimits({
  field,
  onChange,
}: {
  field: Extract<FormField, { type: "multi_choice" }>;
  onChange: (field: FormField) => void;
}) {
  const available = field.options.length + (field.allowOther ? 1 : 0);
  const counts = Array.from(
    { length: Math.max(available, 1) },
    (_, i) => i + 1,
  );
  const pick = (value: string) => (value === "" ? null : Number(value));

  return (
    <span className="inline-flex flex-wrap items-center gap-3">
      <label className="inline-flex items-center gap-2 whitespace-nowrap">
        {text.minSelect}
        <select
          className={`${inputClass} w-auto py-1`}
          value={field.minSelect ?? ""}
          onChange={(event) =>
            onChange({ ...field, minSelect: pick(event.target.value) })
          }
        >
          <option value="">{text.noLimit}</option>
          {counts.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label className="inline-flex items-center gap-2 whitespace-nowrap">
        {text.maxSelect}
        <select
          className={`${inputClass} w-auto py-1`}
          value={field.maxSelect ?? ""}
          onChange={(event) =>
            onChange({ ...field, maxSelect: pick(event.target.value) })
          }
        >
          <option value="">{text.noLimit}</option>
          {counts.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
    </span>
  );
}
