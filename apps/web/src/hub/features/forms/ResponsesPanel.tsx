import { useState } from "react";
import { TbDownload } from "react-icons/tb";
import { twMerge } from "tailwind-merge";

import type { FormDefinition, StoredAnswer } from "@kan/hub/public";
import { isQuestion } from "@kan/hub/public";

import { copy } from "~/hub/copy/zh";
import { downloadCsv } from "~/hub/lib/csv";
import {
  buttonClass,
  ConfirmButton,
  ErrorText,
  Pagination,
  Pill,
} from "~/hub/ui/admin-primitives";
import { api } from "~/utils/api";
import { csvFilename, formatDateTime, responsesCsv } from "./form-display";
import { AnswerView } from "./form-ui";

const text = copy.forms.responses;

/** How many answers the export reads at most (EXPORT_LIMIT on the server). */
const EXPORT_LIMIT = 5000;

type Sort = "newest" | "likes";

/**
 * A response's answers in reading order: today's questions first, then
 * answers to questions deleted since, under the title they had.
 */
export function orderedAnswers(
  definition: FormDefinition,
  answers: Record<string, StoredAnswer>,
): {
  fieldId: string;
  title: string;
  removed: boolean;
  answer: StoredAnswer;
}[] {
  const current = definition.fields.filter(isQuestion);
  const known = new Set(current.map((field) => field.id));
  return [
    ...current.flatMap((field) => {
      const answer = answers[field.id];
      return answer
        ? [{ fieldId: field.id, title: field.title, removed: false, answer }]
        : [];
    }),
    ...Object.entries(answers)
      .filter(([fieldId]) => !known.has(fieldId))
      .map(([fieldId, answer]) => ({
        fieldId,
        title: answer.title,
        removed: true,
        answer,
      })),
  ];
}

/** The 回答 tab: every answer as a card, newest or most liked first, and the CSV export. */
export function ResponsesPanel({
  formId,
  title,
  definition,
  showLikes,
}: {
  formId: string;
  title: string;
  definition: FormDefinition;
  showLikes: boolean;
}) {
  const utils = api.useUtils();
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<Sort>("newest");
  const responses = api.hub.forms.responses.useQuery(
    { formPublicId: formId, page, sort },
    { retry: false, placeholderData: (previous) => previous },
  );
  const remove = api.hub.forms.deleteResponse.useMutation({
    onSuccess: () => {
      void utils.hub.forms.responses.invalidate({ formPublicId: formId });
      void utils.hub.forms.get.invalidate({ formPublicId: formId });
      void utils.hub.forms.summary.invalidate({ formPublicId: formId });
    },
  });

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  async function exportCsv() {
    setExporting(true);
    setExportError(null);
    try {
      const data = await utils.hub.forms.export.fetch({ formPublicId: formId });
      setTruncated(data.truncated);
      const csv = responsesCsv(
        {
          title: data.title,
          columns: data.columns,
          items: data.items.map((item) => ({
            ...item,
            createdAt: item.createdAt.toISOString(),
            updatedAt: item.updatedAt.toISOString(),
          })),
        },
        window.location.origin,
      );
      downloadCsv(csvFilename(title), csv);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error));
    } finally {
      setExporting(false);
    }
  }

  const data = responses.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="group"
          className="inline-flex rounded-md border border-light-400 p-0.5 dark:border-dark-400"
        >
          {(["newest", "likes"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={sort === value}
              className={twMerge(
                "rounded px-3 py-1 text-sm text-light-900 dark:text-dark-900",
                sort === value &&
                  "bg-light-1000 text-light-50 dark:bg-dark-1000 dark:text-dark-50",
              )}
              onClick={() => {
                setSort(value);
                setPage(1);
              }}
            >
              {text.sort[value]}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={twMerge(buttonClass.ghost, "gap-1.5")}
          disabled={exporting || !data || data.total === 0}
          onClick={() => void exportCsv()}
        >
          <TbDownload size={16} aria-hidden="true" />
          {exporting ? text.exporting : text.export}
        </button>
      </div>
      {truncated && (
        <p className="text-sm text-amber-700 dark:text-amber-300">
          {text.truncated(EXPORT_LIMIT)}
        </p>
      )}
      <ErrorText
        message={
          exportError ?? responses.error?.message ?? remove.error?.message
        }
      />

      {responses.isLoading && (
        <p className="text-sm text-light-900 dark:text-dark-900">
          {copy.forms.loading}
        </p>
      )}
      {data && data.total === 0 && (
        <p className="rounded-xl border border-dashed border-light-400 p-8 text-center text-sm text-light-900 dark:border-dark-400 dark:text-dark-900">
          {text.empty}
        </p>
      )}

      <ul className="space-y-3">
        {data?.items.map((item) => (
          <li
            key={item.publicId}
            className="rounded-xl border border-light-300 bg-light-50 p-4 dark:border-dark-300 dark:bg-dark-100"
          >
            <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-light-1000 dark:text-dark-1000">
                  {item.respondent ??
                    (item.signedIn ? text.deletedAccount : text.anonymous)}
                  {item.respondentEmail && (
                    <span className="ml-2 text-xs font-normal text-light-900 dark:text-dark-900">
                      {item.respondentEmail}
                    </span>
                  )}
                </p>
                <p className="text-xs text-light-900 dark:text-dark-900">
                  {text.submittedAt(formatDateTime(item.createdAt))}
                  {item.updatedAt.getTime() !== item.createdAt.getTime() &&
                    ` · ${text.editedAt(formatDateTime(item.updatedAt))}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {(showLikes || item.likes > 0) && (
                  <Pill>{text.likes(item.likes)}</Pill>
                )}
                <ConfirmButton
                  label={text.delete}
                  isPending={remove.isPending}
                  onConfirm={() =>
                    remove.mutate({
                      formPublicId: formId,
                      responsePublicId: item.publicId,
                    })
                  }
                />
              </div>
            </header>
            <dl className="space-y-3">
              {orderedAnswers(definition, item.answers).map((entry) => (
                <div key={entry.fieldId}>
                  <dt className="mb-1 flex items-center gap-2 text-xs font-medium text-light-900 dark:text-dark-900">
                    {entry.title}
                    {entry.removed && <Pill>{text.removedQuestion}</Pill>}
                  </dt>
                  <dd>
                    <AnswerView answer={entry.answer} />
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>

      {data && (
        <Pagination
          page={page}
          pageSize={data.pageSize}
          total={data.total}
          onChange={setPage}
        />
      )}
    </div>
  );
}
