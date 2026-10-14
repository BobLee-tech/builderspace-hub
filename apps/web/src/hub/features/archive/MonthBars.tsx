import { useState } from "react";
import { twMerge } from "tailwind-merge";

import { copy } from "~/hub/copy/zh";

const text = copy.archive.months;

/** Height of the plot area; the month labels sit below it, outside. */
const PLOT_HEIGHT = 112;

interface MonthCount {
  /** "2026-10" */
  month: string;
  count: number;
}

function parseMonth(month: string): { year: number; month: number } {
  const [year, value] = month.split("-").map(Number);
  return { year: year ?? 0, month: value ?? 0 };
}

/**
 * Finished tasks per month, one column each, the current month last. One
 * series, so one ink and no legend; the heading names it. Only the current
 * month carries its number on the cap; the rest are read by hover or focus,
 * and the hidden table gives every value to screen readers.
 */
export function MonthBars({ months }: { months: MonthCount[] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...months.map((m) => m.count));
  const lastIndex = months.length - 1;

  return (
    <figure>
      <div
        className="relative flex items-end border-b border-light-400 dark:border-dark-400"
        style={{ height: PLOT_HEIGHT }}
        onMouseLeave={() => setActive(null)}
      >
        {months.map((entry, index) => {
          const { year, month } = parseMonth(entry.month);
          const height = (entry.count / max) * (PLOT_HEIGHT - 18);
          const isCurrent = index === lastIndex;
          const label = text.tooltip(year, month, entry.count);
          return (
            // The whole column is the hover and focus target, not the thin bar.
            <div
              key={entry.month}
              tabIndex={0}
              aria-label={label}
              className="relative flex h-full flex-1 items-end justify-center outline-none focus-visible:bg-light-200 dark:focus-visible:bg-dark-200"
              onMouseEnter={() => setActive(index)}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
            >
              {isCurrent && entry.count > 0 && (
                <span
                  className="absolute text-xs font-medium text-light-1000 dark:text-dark-1000"
                  style={{ bottom: height + 4 }}
                >
                  {entry.count}
                </span>
              )}
              {entry.count > 0 && (
                <span
                  className={twMerge(
                    "block w-3/5 max-w-6 rounded-t transition-colors",
                    isCurrent || active === index
                      ? "bg-light-1000 dark:bg-dark-1000"
                      : "bg-light-600 dark:bg-dark-600",
                  )}
                  style={{ height }}
                />
              )}
              {active === index && (
                <span
                  role="tooltip"
                  className="pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-md bg-light-1000 px-2 py-1 text-xs text-light-50 shadow dark:bg-dark-1000 dark:text-dark-50"
                >
                  {label}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex" aria-hidden="true">
        {months.map((entry, index) => (
          <span
            key={entry.month}
            className={twMerge(
              "flex-1 text-center text-[11px] text-light-800 dark:text-dark-800",
              index === lastIndex &&
                "font-medium text-light-1000 dark:text-dark-1000",
            )}
          >
            {text.axis(parseMonth(entry.month).month)}
          </span>
        ))}
      </div>

      <table className="sr-only">
        <caption>{text.tableCaption}</caption>
        <thead>
          <tr>
            <th scope="col">{text.monthColumn}</th>
            <th scope="col">{text.countColumn}</th>
          </tr>
        </thead>
        <tbody>
          {months.map((entry) => {
            const { year, month } = parseMonth(entry.month);
            return (
              <tr key={entry.month}>
                <td>{`${year}-${month}`}</td>
                <td>{entry.count}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </figure>
  );
}
