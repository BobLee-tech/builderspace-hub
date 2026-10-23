import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useRef, useState } from "react";
import { TbArrowLeft, TbThumbUp, TbThumbUpFilled } from "react-icons/tb";
import { twMerge } from "tailwind-merge";

import type { Jsonified, Wall } from "@kan/hub/public";

import { copy } from "~/hub/copy/zh";
import { formApi, FormApiError } from "~/hub/lib/form-client";
import { ErrorText, Pill } from "~/hub/ui/admin-primitives";
import { formatDateTime } from "./form-display";
import { AnswerView } from "./form-ui";
import { FormShell, panelClass } from "./FormShell";

const text = copy.forms.wall;

type WallData = Jsonified<Wall>;
type Entry = WallData["entries"][number];
type Sort = "newest" | "likes";

const errorMessage = (error: unknown) =>
  error instanceof FormApiError
    ? error.status === 404
      ? copy.forms.fill.notFound
      : error.message
    : copy.forms.fill.networkError;

/**
 * 结果墙: everyone's answers to a form, as far as the form shows them, with
 * 👍. Like the fill page it works without signing in (for public forms) and
 * never calls tRPC.
 */
export function WallPage() {
  const router = useRouter();
  const formId =
    router.isReady && typeof router.query.publicId === "string"
      ? router.query.publicId
      : null;

  const [sort, setSort] = useState<Sort>("newest");
  const [wall, setWall] = useState<WallData | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [likeError, setLikeError] = useState<string | null>(null);
  // Responses to an older request (another sort) are dropped.
  const requestId = useRef(0);

  const load = useCallback(
    async (nextPage: number, nextSort: Sort, append: boolean) => {
      if (!formId) return;
      const id = (requestId.current += 1);
      setLoading(true);
      try {
        const data = await formApi<WallData>(formId, ["wall"], {
          query: { page: String(nextPage), sort: nextSort },
        });
        if (id !== requestId.current) return;
        setWall(data);
        setPage(nextPage);
        setLoadError(null);
        setEntries((previous) => {
          if (!append) return data.entries;
          const seen = new Set(previous.map((entry) => entry.publicId));
          return [
            ...previous,
            ...data.entries.filter((entry) => !seen.has(entry.publicId)),
          ];
        });
      } catch (error) {
        if (id === requestId.current) setLoadError(errorMessage(error));
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [formId],
  );

  useEffect(() => {
    void load(1, sort, false);
  }, [load, sort]);

  async function like(entry: Entry) {
    if (!formId) return;
    const want = !entry.liked;
    const patch = (liked: boolean, likes: number) =>
      setEntries((list) =>
        list.map((item) =>
          item.publicId === entry.publicId ? { ...item, liked, likes } : item,
        ),
      );
    setLikeError(null);
    patch(want, entry.likes + (want ? 1 : -1));
    try {
      const result = await formApi<{ liked: boolean; likes: number }>(
        formId,
        ["responses", entry.publicId, "like"],
        { method: "PUT", json: { like: want } },
      );
      patch(result.liked, result.likes);
    } catch (error) {
      patch(entry.liked, entry.likes);
      setLikeError(errorMessage(error));
    }
  }

  const backHref = formId ? `/forms/${formId}` : "/";
  const back = (
    <Link
      href={backHref}
      className="inline-flex items-center gap-1 text-sm text-light-900 hover:text-light-1000 dark:text-dark-900 dark:hover:text-dark-1000"
    >
      <TbArrowLeft size={16} aria-hidden="true" />
      {text.back}
    </Link>
  );

  if (loadError && !wall) {
    return (
      <FormShell title={text.title}>
        <div className={panelClass}>
          <p className="text-sm leading-6 text-light-900 dark:text-dark-900">
            {loadError}
          </p>
          {formId && <div className="mt-3">{back}</div>}
        </div>
      </FormShell>
    );
  }
  if (!wall) {
    return (
      <FormShell title={text.title}>
        <p className="text-sm text-light-900 dark:text-dark-900">
          {copy.forms.loading}
        </p>
      </FormShell>
    );
  }

  const showLikes = wall.likes !== "off";
  const hasMore =
    entries.length < wall.total && page * wall.pageSize < wall.total;

  return (
    <FormShell title={`${wall.title} · ${text.title}`} wide>
      <div className="mb-3">{back}</div>
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-light-1000 dark:text-dark-1000 sm:text-2xl">
            {wall.title}
          </h1>
          <p className="mt-1 text-sm text-light-900 dark:text-dark-900">
            {text.title} · {text.count(wall.total)}
          </p>
        </div>
        <div
          role="tablist"
          aria-label={text.title}
          className="inline-flex rounded-lg border border-light-300 bg-light-50 p-0.5 dark:border-dark-300 dark:bg-dark-100"
        >
          {(["newest", "likes"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={sort === option}
              onClick={() => setSort(option)}
              className={twMerge(
                "min-h-[36px] rounded-md px-3 text-sm",
                sort === option
                  ? "bg-light-1000 font-medium text-light-50 dark:bg-dark-1000 dark:text-dark-50"
                  : "text-light-900 hover:text-light-1000 dark:text-dark-900 dark:hover:text-dark-1000",
              )}
            >
              {text.sort[option]}
            </button>
          ))}
        </div>
      </header>

      <ErrorText message={likeError ?? loadError} />

      {entries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-light-400 p-8 text-center text-sm text-light-900 dark:border-dark-400 dark:text-dark-900">
          {text.empty}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {entries.map((entry) => (
            <li key={entry.publicId} className={`${panelClass} flex flex-col`}>
              <div className="mb-3 flex items-center gap-2 text-sm">
                <span className="min-w-0 truncate font-medium text-light-1000 dark:text-dark-1000">
                  {entry.name ?? text.anonymous}
                </span>
                {entry.mine && <Pill tone="strong">{text.mine}</Pill>}
                <span className="ml-auto shrink-0 text-xs text-light-800 dark:text-dark-800">
                  {formatDateTime(entry.createdAt)}
                </span>
              </div>
              <dl className="flex flex-1 flex-col gap-3">
                {entry.answers.map((item) => (
                  <div key={item.fieldId}>
                    <dt className="mb-1 text-xs text-light-900 dark:text-dark-900">
                      {item.title}
                    </dt>
                    <dd>
                      <AnswerView
                        answer={item.answer}
                        tokenFormId={formId ?? undefined}
                      />
                    </dd>
                  </div>
                ))}
              </dl>
              {showLikes && (
                <div className="mt-4 flex justify-end">
                  <LikeButton
                    entry={entry}
                    wall={wall}
                    onLike={() => void like(entry)}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {hasMore && (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            disabled={loading}
            onClick={() => void load(page + 1, sort, true)}
            className="min-h-[44px] rounded-md border border-light-400 px-6 text-sm font-medium text-light-1000 hover:bg-light-200 disabled:opacity-50 dark:border-dark-400 dark:text-dark-1000 dark:hover:bg-dark-200"
          >
            {loading ? copy.forms.loading : text.loadMore}
          </button>
        </div>
      )}
    </FormShell>
  );
}

function LikeButton({
  entry,
  wall,
  onLike,
}: {
  entry: Entry;
  wall: WallData;
  onLike: () => void;
}) {
  const blocked = entry.mine || !wall.canLike;
  const hint =
    !entry.mine && !wall.canLike && wall.likes === "signed_in"
      ? text.signInToLike
      : entry.liked
        ? text.liked
        : text.like;
  const Icon = entry.liked ? TbThumbUpFilled : TbThumbUp;
  return (
    <button
      type="button"
      aria-pressed={entry.liked}
      aria-label={`${hint} ${entry.likes}`}
      title={hint}
      disabled={blocked}
      onClick={onLike}
      className={twMerge(
        "inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed",
        entry.liked
          ? "border-light-1000 bg-light-1000 text-light-50 dark:border-dark-1000 dark:bg-dark-1000 dark:text-dark-50"
          : "border-light-400 text-light-1000 hover:bg-light-200 dark:border-dark-400 dark:text-dark-1000 dark:hover:bg-dark-200",
        blocked &&
          !entry.liked &&
          "opacity-60 hover:bg-transparent dark:hover:bg-transparent",
      )}
    >
      <Icon size={16} aria-hidden="true" />
      {entry.likes}
    </button>
  );
}
