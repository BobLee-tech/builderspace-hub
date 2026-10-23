import { copy } from "~/hub/copy/zh";
import { Card, ErrorText, Pill } from "~/hub/ui/admin-primitives";
import { api } from "~/utils/api";

const text = copy.forms.summary;

const percent = (count: number, of: number) =>
  of === 0 ? 0 : Math.round((count / of) * 100);

/** The 统计 tab: per question, how many answered and what they chose. */
export function SummaryPanel({ formId }: { formId: string }) {
  const summary = api.hub.forms.summary.useQuery(
    { formPublicId: formId },
    { retry: false },
  );
  const data = summary.data;

  if (summary.isLoading) {
    return (
      <p className="text-sm text-light-900 dark:text-dark-900">
        {copy.forms.loading}
      </p>
    );
  }
  if (!data) return <ErrorText message={summary.error?.message} />;
  if (data.total === 0) {
    return (
      <p className="rounded-xl border border-dashed border-light-400 p-8 text-center text-sm text-light-900 dark:border-dark-400 dark:text-dark-900">
        {text.empty}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {data.truncated && (
        <p className="text-sm text-amber-700 dark:text-amber-300">
          {text.truncated}
        </p>
      )}
      {data.questions.map((question) => (
        <Card key={question.fieldId}>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-light-1000 dark:text-dark-1000">
              {question.title}
              {question.removed && (
                <Pill>{copy.forms.responses.removedQuestion}</Pill>
              )}
            </h3>
            <span className="text-xs text-light-900 dark:text-dark-900">
              {text.answered(question.answered, data.total)}
            </span>
          </div>

          {question.type === "choice" && (
            <ul className="space-y-2">
              {question.options.map((option) => {
                const share = percent(option.count, question.answered);
                return (
                  <li key={option.id}>
                    <div className="mb-1 flex items-center justify-between gap-2 text-sm text-light-1000 dark:text-dark-1000">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate">{option.label || "🖼"}</span>
                        {option.removed && <Pill>{text.removedOption}</Pill>}
                      </span>
                      <span className="shrink-0 tabular-nums text-light-900 dark:text-dark-900">
                        {option.count} · {share}%
                      </span>
                    </div>
                    <div
                      className="h-2 overflow-hidden rounded-full bg-light-200 dark:bg-dark-200"
                      role="presentation"
                    >
                      <div
                        className="h-full rounded-full bg-light-1000 dark:bg-dark-1000"
                        style={{ width: `${share}%` }}
                      />
                    </div>
                  </li>
                );
              })}
              {question.other.count > 0 && (
                <li>
                  <div className="mb-1 flex items-center justify-between gap-2 text-sm text-light-1000 dark:text-dark-1000">
                    <span>{text.other}</span>
                    <span className="tabular-nums text-light-900 dark:text-dark-900">
                      {question.other.count} ·{" "}
                      {percent(question.other.count, question.answered)}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-light-200 dark:bg-dark-200">
                    <div
                      className="h-full rounded-full bg-light-800 dark:bg-dark-800"
                      style={{
                        width: `${percent(question.other.count, question.answered)}%`,
                      }}
                    />
                  </div>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {question.other.latest.map((value, index) => (
                      <li key={index}>
                        <Pill>{value}</Pill>
                      </li>
                    ))}
                  </ul>
                </li>
              )}
            </ul>
          )}

          {question.type === "text" && question.latest.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-light-900 dark:text-dark-900">
                {text.latest}
              </p>
              <ul className="space-y-1">
                {question.latest.map((value, index) => (
                  <li
                    key={index}
                    className="line-clamp-2 break-words rounded-md bg-light-100 px-3 py-1.5 text-sm text-light-1000 dark:bg-dark-200 dark:text-dark-1000"
                  >
                    {value}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {question.type === "images" && (
            <p className="text-sm text-light-1000 dark:text-dark-1000">
              {text.images(question.images)}
            </p>
          )}
        </Card>
      ))}
    </div>
  );
}
