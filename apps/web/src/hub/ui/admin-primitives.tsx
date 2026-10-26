import { useState } from "react";
import { twMerge } from "tailwind-merge";

import { copy } from "~/hub/copy/zh";

/**
 * Small building blocks for back-office pages, in the calm monochrome style
 * of the rest of the app. Kept together because they are always used together.
 */

export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="max-w-2xl">
        <h1 className="text-xl font-bold tracking-tight text-light-1000 dark:text-dark-1000">
          {title}
        </h1>
        <p className="mt-1 text-sm leading-6 text-light-900 dark:text-dark-900">
          {description}
        </p>
      </div>
      {children && <div className="flex shrink-0 gap-2">{children}</div>}
    </div>
  );
}

export function Card({
  title,
  hint,
  danger,
  children,
  className,
}: {
  title?: string;
  hint?: string;
  danger?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={twMerge(
        "rounded-xl border border-light-300 bg-light-50 p-5 dark:border-dark-300 dark:bg-dark-100",
        danger && "border-red-300 dark:border-red-900",
        className,
      )}
    >
      {title && (
        <h2 className="text-sm font-semibold text-light-1000 dark:text-dark-1000">
          {title}
        </h2>
      )}
      {hint && (
        <p className="mt-1 text-xs leading-5 text-light-900 dark:text-dark-900">
          {hint}
        </p>
      )}
      <div className={twMerge((title ?? hint) && "mt-4")}>{children}</div>
    </section>
  );
}

export function Pill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "strong" | "alert";
}) {
  return (
    <span
      className={twMerge(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        tone === "neutral" &&
          "bg-light-200 text-light-1000 dark:bg-dark-200 dark:text-dark-1000",
        tone === "strong" &&
          "bg-light-1000 text-light-50 dark:bg-dark-1000 dark:text-dark-50",
        tone === "alert" &&
          "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
      )}
    >
      {children}
    </span>
  );
}

const buttonBase =
  "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50";

export const buttonClass = {
  primary: `${buttonBase} bg-light-1000 text-light-50 hover:opacity-90 dark:bg-dark-1000 dark:text-dark-50`,
  ghost: `${buttonBase} border border-light-400 text-light-1000 hover:bg-light-200 dark:border-dark-400 dark:text-dark-1000 dark:hover:bg-dark-200`,
  danger: `${buttonBase} bg-red-600 text-white hover:bg-red-700`,
  dangerText: `${buttonBase} border border-red-300 text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950`,
};

export const inputClass =
  "block w-full rounded-md border border-light-400 bg-light-50 px-3 py-1.5 text-sm text-light-1000 placeholder:text-light-800 focus:border-light-900 focus:outline-none dark:border-dark-400 dark:bg-dark-50 dark:text-dark-1000 dark:placeholder:text-dark-800";

/**
 * A destructive action needs two clicks: the first turns the button into
 * "确认" + "取消". No browser dialog.
 */
export function ConfirmButton({
  label,
  onConfirm,
  disabled,
  isPending,
}: {
  label: string;
  onConfirm: () => void;
  disabled?: boolean;
  isPending?: boolean;
}) {
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <button
        type="button"
        className={buttonClass.dangerText}
        disabled={disabled ?? isPending}
        onClick={() => setArmed(true)}
      >
        {label}
      </button>
    );
  }

  return (
    <span className="inline-flex gap-2">
      <button
        type="button"
        className={buttonClass.danger}
        disabled={isPending}
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
      >
        {copy.admin.confirm}
        {label}
      </button>
      <button
        type="button"
        className={buttonClass.ghost}
        onClick={() => setArmed(false)}
      >
        {copy.admin.cancel}
      </button>
    </span>
  );
}

/**
 * A password, link or token the server returned once, with a copy button.
 * `note` replaces the default line about passing it on privately.
 */
export function OneTimeSecret({
  label,
  value,
  note = copy.admin.oneTime,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950">
      <p className="text-xs font-medium text-amber-900 dark:text-amber-200">
        {label}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 select-all break-all rounded bg-white px-2 py-1 font-mono text-sm text-light-1000 dark:bg-dark-50 dark:text-dark-1000">
          {value}
        </code>
        <button
          type="button"
          className={buttonClass.ghost}
          onClick={() => {
            void navigator.clipboard
              .writeText(value)
              .then(() => setCopied(true));
          }}
        >
          {copied ? copy.admin.copied : copy.admin.copy}
        </button>
      </div>
      <p className="mt-2 text-xs text-amber-900 dark:text-amber-200">{note}</p>
    </div>
  );
}

export function ErrorText({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-red-600 dark:text-red-400">
      {message}
    </p>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;

  return (
    <div className="mt-4 flex items-center justify-end gap-3 text-sm text-light-900 dark:text-dark-900">
      <button
        type="button"
        className={buttonClass.ghost}
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        {copy.admin.pagination.previous}
      </button>
      <span>
        {page} / {pages} · {total}
      </span>
      <button
        type="button"
        className={buttonClass.ghost}
        disabled={page >= pages}
        onClick={() => onChange(page + 1)}
      >
        {copy.admin.pagination.next}
      </button>
    </div>
  );
}

export const tableClass = {
  wrap: "overflow-x-auto rounded-xl border border-light-300 dark:border-dark-300",
  table: "min-w-full divide-y divide-light-300 text-sm dark:divide-dark-300",
  th: "bg-light-100 px-4 py-2 text-left text-xs font-medium text-light-900 dark:bg-dark-200 dark:text-dark-900",
  td: "px-4 py-2.5 align-top text-light-1000 dark:text-dark-1000",
  sub: "text-xs text-light-900 dark:text-dark-900",
};
