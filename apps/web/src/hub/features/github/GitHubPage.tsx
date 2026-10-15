import { useRouter } from "next/router";
import { TbBrandGithub, TbExternalLink, TbRefresh } from "react-icons/tb";

import type { RouterOutputs } from "~/utils/api";
import { PageHead } from "~/components/PageHead";
import { copy } from "~/hub/copy/zh";
import {
  buttonClass,
  Card,
  ConfirmButton,
  ErrorText,
  PageHeader,
  Pill,
} from "~/hub/ui/admin-primitives";
import { api } from "~/utils/api";
import { PersonalTabs } from "../personal/PersonalTabs";

type Summary = RouterOutputs["hub"]["github"]["summary"];
type SyncReport = RouterOutputs["hub"]["github"]["sync"];
type Kind = keyof Summary["counts"][30];

const text = copy.github;
const CONNECT_URL = "/api/hub/github/connect";
const kinds: Kind[] = ["commit", "pr_opened", "pr_merged", "issue_opened"];

const timeFormat = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const dayFormat = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
});

/** 个人 → GitHub: connect the account, sync, and see what you did where. */
export function GitHubPage() {
  const summary = api.hub.github.summary.useQuery(undefined, { retry: false });

  return (
    <div className="m-auto w-full max-w-[1100px] px-5 py-8 md:px-12 md:py-12">
      <PageHead title={`${text.title} · ${copy.brand}`} />
      <PersonalTabs />
      <PageHeader title={text.title} description={text.description} />
      <Outcome />
      <ErrorText message={summary.error?.message} />
      {summary.data ? (
        <GitHubContent summary={summary.data} />
      ) : (
        !summary.error && (
          <div className="h-40 animate-pulse rounded-xl bg-light-200 dark:bg-dark-200" />
        )
      )}
    </div>
  );
}

/** What happened on the way back from GitHub, from the `?github=` the routes add. */
function Outcome() {
  const { query } = useRouter();
  const outcome = typeof query.github === "string" ? query.github : null;
  if (!outcome || !(outcome in text.outcomes)) return null;
  const good = outcome === "connected";
  return (
    <p
      role="status"
      className={
        good
          ? "mb-4 rounded-lg border border-light-300 bg-light-50 px-4 py-3 text-sm text-light-1000 dark:border-dark-300 dark:bg-dark-100 dark:text-dark-1000"
          : "mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
      }
    >
      {text.outcomes[outcome as keyof typeof text.outcomes]}
    </p>
  );
}

function GitHubContent({ summary }: { summary: Summary }) {
  if (!summary.configured && !summary.connection) {
    return (
      <Card title={text.notConfigured.heading}>
        <p className="text-sm text-light-900 dark:text-dark-900">
          {text.notConfigured.body}
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {summary.connection ? (
        <Connected summary={summary} />
      ) : (
        <Card>
          <a href={CONNECT_URL} className={buttonClass.primary}>
            <TbBrandGithub className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {text.connect}
          </a>
        </Card>
      )}
      <Repos repos={summary.repos} />
    </div>
  );
}

function Connected({ summary }: { summary: Summary }) {
  const utils = api.useUtils();
  const refresh = () => utils.hub.github.summary.invalidate();
  const sync = api.hub.github.sync.useMutation({ onSuccess: refresh });
  const disconnect = api.hub.github.disconnect.useMutation({
    onSuccess: refresh,
  });
  const connection = summary.connection;
  if (!connection) return null;

  return (
    <>
      <Card>
        <div className="flex flex-col gap-4 md:flex-row md:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {connection.avatarUrl ? (
              // A 40px avatar from GitHub's CDN; next/image would need that
              // host added to the upstream next.config.js for no real gain.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={connection.avatarUrl}
                alt=""
                className="h-10 w-10 shrink-0 rounded-full"
              />
            ) : (
              <TbBrandGithub
                className="h-10 w-10 shrink-0"
                aria-hidden="true"
              />
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-light-1000 dark:text-dark-1000">
                {text.connectedAs(connection.login)}
              </p>
              <p className="text-xs text-light-900 dark:text-dark-900">
                {connection.lastSyncedAt
                  ? text.lastSynced(timeFormat.format(connection.lastSyncedAt))
                  : text.neverSynced}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              className={buttonClass.primary}
              disabled={sync.isPending}
              onClick={() => sync.mutate()}
            >
              <TbRefresh className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {sync.isPending ? text.syncing : text.sync}
            </button>
            <a href={CONNECT_URL} className={buttonClass.ghost}>
              {text.reconnect}
            </a>
            <ConfirmButton
              label={text.disconnect}
              isPending={disconnect.isPending}
              onConfirm={() => disconnect.mutate()}
            />
          </div>
        </div>
        <div className="mt-3 space-y-1">
          <ErrorText
            message={sync.error?.message ?? disconnect.error?.message}
          />
          {sync.data && <SyncResult report={sync.data} />}
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kinds.map((kind) => (
          <div
            key={kind}
            className="rounded-xl border border-light-300 bg-light-50 p-4 dark:border-dark-300 dark:bg-dark-100"
          >
            <p className="text-xs text-light-900 dark:text-dark-900">
              {text.kinds[kind]} · {text.windows[30]}
            </p>
            <p className="mt-1 text-3xl font-semibold tracking-tight text-light-1000 dark:text-dark-1000">
              {summary.counts[30][kind]}
            </p>
            <p className="mt-1 text-xs text-light-900 dark:text-dark-900">
              {text.windows[90]} {summary.counts[90][kind]}
            </p>
          </div>
        ))}
      </div>

      {summary.byProject.length > 0 && (
        <Card title={text.byProject}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-light-900 dark:text-dark-900">
                  <th className="py-1.5 pr-4 font-medium" scope="col" />
                  {kinds.map((kind) => (
                    <th
                      key={kind}
                      className="py-1.5 pr-4 text-right font-medium"
                      scope="col"
                    >
                      {text.kinds[kind]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {summary.byProject.map((row) => (
                  <tr
                    key={row.project.publicId}
                    className="border-t border-light-200 text-light-1000 dark:border-dark-200 dark:text-dark-1000"
                  >
                    <th className="py-2 pr-4 text-left font-medium" scope="row">
                      {row.project.name}
                    </th>
                    {kinds.map((kind) => (
                      <td
                        key={kind}
                        className="py-2 pr-4 text-right tabular-nums"
                      >
                        {row.counts[kind]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card title={text.recent.title}>
        {summary.recent.length === 0 ? (
          <p className="text-sm text-light-900 dark:text-dark-900">
            {text.recent.empty}
          </p>
        ) : (
          <ul className="divide-y divide-light-200 dark:divide-dark-200">
            {summary.recent.map((event) => (
              <li key={`${event.kind}-${event.url}`}>
                <a
                  href={event.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-3 py-2 hover:bg-light-200 dark:hover:bg-dark-200"
                >
                  <Pill>{text.kinds[event.kind]}</Pill>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-light-1000 dark:text-dark-1000">
                      {event.title}
                    </span>
                    <span className="block truncate font-mono text-xs text-light-900 dark:text-dark-900">
                      {event.repoFullName}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-light-900 dark:text-dark-900">
                    {dayFormat.format(event.occurredAt)}
                  </span>
                  <TbExternalLink
                    className="h-3.5 w-3.5 shrink-0 text-light-800 dark:text-dark-800"
                    aria-hidden="true"
                  />
                </a>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function SyncResult({ report }: { report: SyncReport }) {
  const problems = report.repos.filter((repo) => repo.status !== "ok");
  return (
    <div className="space-y-1 text-xs text-light-900 dark:text-dark-900">
      <p>{text.syncReport.done(report.events)}</p>
      {problems.map((repo) => (
        <p key={repo.fullName} className="text-amber-700 dark:text-amber-400">
          {repo.status === "no_access"
            ? text.syncReport.noAccess(repo.fullName)
            : text.syncReport.failed(repo.fullName)}
        </p>
      ))}
    </div>
  );
}

function Repos({ repos }: { repos: Summary["repos"] }) {
  return (
    <Card title={text.repos.title} hint={text.repos.hint}>
      {repos.length === 0 ? (
        <p className="text-sm text-light-900 dark:text-dark-900">
          {text.repos.none}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {repos.map((repo) => (
            <li key={repo.fullName} className="flex items-center gap-2 text-sm">
              <TbBrandGithub
                className="h-4 w-4 shrink-0 text-light-900 dark:text-dark-900"
                aria-hidden="true"
              />
              <a
                href={repo.url}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-light-1000 underline-offset-2 hover:underline dark:text-dark-1000"
              >
                {repo.fullName}
              </a>
              <span className="text-xs text-light-900 dark:text-dark-900">
                {repo.projects.join("、")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
