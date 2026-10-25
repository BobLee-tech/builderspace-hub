import { useState } from "react";

import type { ImportedDocument } from "@kan/hub/documents/file-import";

import type { AudienceChoice } from "./AudiencePicker";
import { copy } from "~/hub/copy/zh";
import { buttonClass, ErrorText, inputClass } from "~/hub/ui/admin-primitives";
import { api } from "~/utils/api";
import { AudiencePicker, isEmptySelection } from "./AudiencePicker";

const text = copy.documents.newText;

type Format = keyof typeof text.formats;
const formats = Object.keys(text.formats) as Format[];

/**
 * Write a text document in the page and save it into the library. With
 * `initial` it starts from an uploaded file, which can still be changed.
 */
export function NewDocumentDialog({
  folderPublicId,
  folderName,
  initial,
  onClose,
  onCreated,
}: {
  folderPublicId?: string | null;
  folderName?: string | null;
  initial?: ImportedDocument | null;
  onClose: () => void;
  onCreated: (publicId: string) => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [format, setFormat] = useState<Format>(initial?.format ?? "md");
  const [content, setContent] = useState(initial?.content ?? "");
  const [audience, setAudience] = useState<AudienceChoice>({ kind: "all" });
  const create = api.hub.documents.createText.useMutation({
    onSuccess: (created) => onCreated(created.publicId),
  });

  const name = title.trim().replace(/[\\/]+/g, "-");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={text.title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <form
        className="max-h-full w-full max-w-2xl overflow-y-auto rounded-xl border border-light-300 bg-light-50 p-5 shadow-xl dark:border-dark-300 dark:bg-dark-100"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate({
            title,
            filename: `${name || "untitled"}.${format}`,
            content,
            folderPublicId: folderPublicId ?? null,
            audience,
          });
        }}
      >
        <h2 className="text-base font-semibold text-light-1000 dark:text-dark-1000">
          {text.title}
        </h2>
        <p className="mt-1 text-xs leading-5 text-light-900 dark:text-dark-900">
          {text.destination}：{folderName ?? text.topLevel}。{text.hint}
        </p>
        {initial && (
          <p className="mt-2 text-xs leading-5 text-light-1000 dark:text-dark-1000">
            {text.fromFile(initial.fileName)}
            {initial.droppedImages > 0 &&
              ` ${text.droppedImages(initial.droppedImages)}`}
          </p>
        )}

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="block text-sm sm:col-span-2">
            {text.titleLabel}
            <input
              className={`${inputClass} mt-1`}
              maxLength={120}
              required
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            {text.formatLabel}
            <select
              className={`${inputClass} mt-1`}
              value={format}
              onChange={(event) => setFormat(event.target.value as Format)}
            >
              {formats.map((key) => (
                <option key={key} value={key}>
                  {text.formats[key]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="mt-4 block text-sm">
          {text.contentLabel}
          <textarea
            className={`${inputClass} mt-1 min-h-72 font-mono text-[13px] leading-6`}
            required
            spellCheck={false}
            placeholder={text.contentPlaceholder}
            value={content}
            onChange={(event) => setContent(event.target.value)}
          />
        </label>

        <div className="mt-4">
          <AudiencePicker value={audience} onChange={setAudience} />
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <ErrorText message={create.error?.message} />
          <button
            type="button"
            className={buttonClass.ghost}
            disabled={create.isPending}
            onClick={onClose}
          >
            {copy.documents.actions.cancel}
          </button>
          <button
            type="submit"
            className={buttonClass.primary}
            disabled={
              create.isPending ||
              !title.trim() ||
              !content ||
              isEmptySelection(audience)
            }
          >
            {text.create}
          </button>
        </div>
      </form>
    </div>
  );
}
