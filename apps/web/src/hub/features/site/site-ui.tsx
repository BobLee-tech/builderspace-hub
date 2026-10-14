import { useRouter } from "next/router";
import { format } from "date-fns";
import { useState } from "react";
import { twMerge } from "tailwind-merge";

import { volunteerStatusLabels } from "@kan/hub/public";

import type { RouterInputs, RouterOutputs } from "~/utils/api";
import { copy } from "~/hub/copy/zh";
import { downloadCsv, toCsv } from "~/hub/lib/csv";
import { buttonClass, ErrorText } from "~/hub/ui/admin-primitives";
import { api } from "~/utils/api";

/**
 * Pieces the 官网 pages share: the "not connected yet" state, the website's
 * option labels, a segmented filter and the export button.
 */

const text = copy.admin.site;
const labels = text.labels;

/** The website's label for one of its keys; an unknown key is shown as is. */
export const labelOf = (
  table: keyof typeof labels,
  key: string | null | undefined,
): string => (key ? (labels[table][key] ?? key) : "–");

export const labelsOf = (table: keyof typeof labels, keys: string[]) =>
  keys.map((key) => labelOf(table, key)).join("、");

export const formatTime = (date: Date) => format(date, "yyyy-MM-dd HH:mm");

/**
 * Renders the page only once the website's database is connected; until
 * then, says what is missing. Access itself is checked by `AdminLayout`.
 */
export function SiteGate({ children }: { children: React.ReactNode }) {
  const status = api.hub.site.status.useQuery();
  if (status.isLoading) {
    return (
      <p className="text-sm text-light-900 dark:text-dark-900">
        {copy.admin.loading}
      </p>
    );
  }
  if (!status.data?.connected) {
    return (
      <div className="max-w-md">
        <h1 className="text-xl font-bold">{text.notConnected.heading}</h1>
        <p className="mt-2 text-sm text-light-900 dark:text-dark-900">
          {text.notConnected.body}
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex flex-wrap gap-1 rounded-lg border border-light-300 bg-light-50 p-1 dark:border-dark-300 dark:bg-dark-100"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
          className={twMerge(
            "rounded-md px-3 py-1 text-sm text-light-900 hover:text-light-1000 dark:text-dark-900 dark:hover:text-dark-1000",
            option.value === value &&
              "bg-light-1000 text-light-50 hover:text-light-50 dark:bg-dark-1000 dark:text-dark-50 dark:hover:text-dark-50",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

type SiteExport = RouterOutputs["hub"]["site"]["export"];

const sheetName = {
  volunteers: text.volunteers.title,
  joins: text.joins.title,
} as const;

/** One spreadsheet row per record, with the same labels the pages show. */
function toSheet(result: SiteExport): string {
  if (result.kind === "volunteers") {
    const t = text.volunteers;
    return toCsv(
      [
        "昵称",
        t.contact,
        t.school,
        t.positions,
        t.hours,
        t.about,
        t.portfolio,
        t.channel,
        t.status,
        t.notes,
        text.submittedAt,
      ],
      result.rows.map((row) => [
        row.nickname,
        row.contact,
        row.schoolDegree,
        labelsOf("positions", row.positions),
        labelOf("hours", row.weeklyHours),
        row.about,
        row.portfolioUrl,
        row.channel,
        volunteerStatusLabels[row.status],
        row.opsNotes,
        formatTime(row.createdAt),
      ]),
    );
  }
  const c = text.joins.columns;
  return toCsv(
    [
      c.name,
      "学校 / 学位",
      "专业",
      c.skills,
      c.hours,
      c.interest,
      c.availability,
      c.source,
      "渠道",
      c.supporter,
      "姓名",
      "zID",
      "想法",
      c.createdAt,
    ],
    result.rows.map((row) => [
      row.nickname,
      row.schoolDegree,
      row.major,
      labelsOf("skills", row.skills),
      labelOf("hours", row.weeklyHours),
      labelOf("interest", row.nextEventInterest),
      labelsOf("availability", row.availability),
      labelOf("referral", row.referralSource),
      row.channel,
      row.affiliationSupport ? "是" : "否",
      row.fullName,
      row.zid,
      row.idea,
      formatTime(row.createdAt),
    ]),
  );
}

type ExportRequest = RouterInputs["hub"]["site"]["export"];

/** Downloads the list, filtered as on the page, as a spreadsheet. The export is logged. */
export function ExportButton({ request }: { request: ExportRequest }) {
  const [done, setDone] = useState<number | null>(null);
  const exportList = api.hub.site.export.useMutation({
    onSuccess: (result) => {
      downloadCsv(
        `官网-${sheetName[result.kind]}-${format(new Date(), "yyyy-MM-dd")}.csv`,
        toSheet(result),
      );
      setDone(result.rows.length);
    },
  });

  return (
    <span className="inline-flex items-center gap-2">
      {done !== null && (
        <span className="text-xs text-light-900 dark:text-dark-900">
          {text.exported(done)}
        </span>
      )}
      <ErrorText message={exportList.error?.message} />
      <button
        type="button"
        className={buttonClass.ghost}
        disabled={exportList.isPending}
        onClick={() => exportList.mutate(request)}
      >
        {exportList.isPending ? text.exporting : text.export}
      </button>
    </span>
  );
}

/**
 * A filter kept in the URL (`?status=new`), so a refresh or a shared link shows
 * the same list. Changing it goes back to the first page.
 */
export function useFilterParam<T extends string>(
  name: string,
  allowed: readonly T[],
  fallback: T,
): [T, (next: T) => void] {
  const router = useRouter();
  const raw = router.query[name];
  const value = allowed.find((option) => option === raw) ?? fallback;

  const setValue = (next: T) => {
    const { page: _page, ...rest } = router.query;
    void router.push(
      {
        pathname: router.pathname,
        query: { ...rest, [name]: next === fallback ? undefined : next },
      },
      undefined,
      { shallow: true },
    );
  };

  return [value, setValue];
}

/**
 * A visitor typed this URL into a public form: only http(s) becomes a link,
 * so a `javascript:` URL can never run in the back office.
 */
export function ExternalLink({
  href,
  children,
}: {
  href: string | null;
  children: React.ReactNode;
}) {
  if (!href) return null;
  if (!/^https?:\/\//i.test(href)) {
    return <span className="break-all">{href}</span>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="break-all underline underline-offset-2 hover:text-light-900 dark:hover:text-dark-900"
    >
      {children}
    </a>
  );
}

/** A label/value grid for one record. Rows whose value is empty are left out. */
export function Facts({
  rows,
}: {
  rows: [label: string, value: React.ReactNode][];
}) {
  return (
    <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
      {rows
        .filter(
          ([, value]) => value !== null && value !== undefined && value !== "",
        )
        .map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-light-900 dark:text-dark-900">{label}</dt>
            <dd className="min-w-0 break-words">{value}</dd>
          </div>
        ))}
    </dl>
  );
}
