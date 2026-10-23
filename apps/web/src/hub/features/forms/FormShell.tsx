import { twMerge } from "tailwind-merge";

import { PageHead } from "~/components/PageHead";
import { copy } from "~/hub/copy/zh";

/**
 * The frame of the pages people open from a shared link (the fill page and
 * the results wall): no sidebar, one centred column, made for phones first.
 */
export function FormShell({
  title,
  children,
  wide = false,
}: {
  /** Browser tab title, without the brand. */
  title: string;
  children: React.ReactNode;
  /** The wall shows cards side by side, so it may be wider. */
  wide?: boolean;
}) {
  return (
    <>
      <PageHead title={`${title} | ${copy.brand}`} />
      <main className="min-h-screen bg-light-100 text-light-1000 dark:bg-dark-50 dark:text-dark-1000">
        <div
          className={twMerge(
            "mx-auto w-full px-4 pb-16 pt-6 sm:pt-10",
            wide ? "max-w-4xl" : "max-w-2xl",
          )}
        >
          {children}
          <footer className="mt-12 text-center text-xs text-light-800 dark:text-dark-800">
            {copy.brand}
          </footer>
        </div>
      </main>
    </>
  );
}

/** A plain panel on the form page: the cover card, a question, a notice. */
export const panelClass =
  "rounded-xl border border-light-300 bg-light-50 p-4 sm:p-5 dark:border-dark-300 dark:bg-dark-100";

/** A one-line notice above the questions. */
export function Notice({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "warn";
}) {
  return (
    <div
      className={twMerge(
        "rounded-lg border px-3 py-2.5 text-sm leading-6",
        tone === "neutral" &&
          "border-light-300 bg-light-50 text-light-900 dark:border-dark-300 dark:bg-dark-100 dark:text-dark-900",
        tone === "warn" &&
          "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
      )}
    >
      {children}
    </div>
  );
}
