import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { useState } from "react";
import { TbBell, TbCheck } from "react-icons/tb";

import type { RouterOutputs } from "~/utils/api";
import { copy } from "~/hub/copy/zh";
import { buttonClass } from "~/hub/ui/admin-primitives";
import { api } from "~/utils/api";

type Person = RouterOutputs["hub"]["nudges"]["list"]["people"][number];

/** What happened to a nudge sent from this panel. */
type Sent =
  | { status: "sending" }
  | { status: "sent" }
  | { status: "unconfirmed" }
  | { status: "failed"; message: string };

const text = copy.nudges;

/** Resend takes two mails a second; 全部催一遍 stays under that. */
const NUDGE_ALL_GAP_MS = 600;

/**
 * The bell at the top of the home page: who has a task that has not moved
 * for days, and a button to send each of them an anonymous reminder. The list
 * loads when the panel opens.
 */
export function NudgeBell() {
  return (
    <Popover>
      <PopoverButton
        aria-label={text.bell}
        title={text.bell}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-light-400 text-light-1000 data-[open]:bg-light-200 hover:bg-light-200 focus:outline-none dark:border-dark-400 dark:text-dark-1000 dark:data-[open]:bg-dark-200 dark:hover:bg-dark-200"
      >
        <TbBell className="h-5 w-5" aria-hidden="true" />
      </PopoverButton>
      <PopoverPanel
        anchor={{ to: "bottom end", gap: 8 }}
        className="z-30 w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-light-300 bg-light-50 p-4 shadow-lg dark:border-dark-300 dark:bg-dark-100"
      >
        <NudgePanel />
      </PopoverPanel>
    </Popover>
  );
}

function NudgePanel() {
  const list = api.hub.nudges.list.useQuery(undefined, { retry: false });
  const send = api.hub.nudges.send.useMutation();
  const [sent, setSent] = useState<Record<string, Sent>>({});
  const [sendingAll, setSendingAll] = useState(false);

  const mark = (userId: string, state: Sent) =>
    setSent((old) => ({ ...old, [userId]: state }));

  async function nudge(userId: string): Promise<void> {
    mark(userId, { status: "sending" });
    try {
      const { delivery } = await send.mutateAsync({ userId });
      mark(userId, { status: delivery });
    } catch (cause) {
      mark(userId, {
        status: "failed",
        message: cause instanceof Error ? cause.message : text.failed,
      });
    }
  }

  const canNudge = (person: Person) =>
    list.data?.canSend === true &&
    !person.optedOut &&
    person.waitSeconds === null &&
    (sent[person.userId] === undefined ||
      sent[person.userId]?.status === "failed");
  const ready = list.data?.people.filter(canNudge) ?? [];

  async function nudgeAll(): Promise<void> {
    setSendingAll(true);
    for (const [index, person] of ready.entries()) {
      if (index > 0) {
        await new Promise((resolve) => setTimeout(resolve, NUDGE_ALL_GAP_MS));
      }
      await nudge(person.userId);
    }
    setSendingAll(false);
  }

  return (
    <div>
      <h2 className="text-sm font-semibold text-light-1000 dark:text-dark-1000">
        {text.title}
      </h2>
      <p className="mt-1 text-xs leading-5 text-light-900 dark:text-dark-900">
        {text.hint}
      </p>

      {list.error ? (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">
          {list.error.message}
        </p>
      ) : !list.data ? (
        <div
          aria-busy="true"
          className="mt-3 h-24 animate-pulse rounded-lg bg-light-200 dark:bg-dark-200"
        />
      ) : list.data.people.length === 0 ? (
        <p className="mt-3 text-sm text-light-900 dark:text-dark-900">
          {text.empty}
        </p>
      ) : (
        <>
          {!list.data.canSend && (
            <p className="mt-3 rounded-md bg-light-200 px-3 py-2 text-xs text-light-1000 dark:bg-dark-200 dark:text-dark-1000">
              {text.mailOff}
            </p>
          )}
          <ul className="mt-3 max-h-80 divide-y divide-light-300 overflow-y-auto border-t border-light-300 dark:divide-dark-300 dark:border-dark-300">
            {list.data.people.map((person) => (
              <li
                key={person.userId}
                className="flex items-center justify-between gap-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-light-1000 dark:text-dark-1000">
                    {person.name}
                    <span className="text-light-900 dark:text-dark-900">
                      {" · "}
                      {text.openCount(person.openCount)}
                    </span>
                  </p>
                  <p className="truncate text-xs text-light-900 dark:text-dark-900">
                    {person.headline.title}
                    {" · "}
                    {person.headline.stuck.kind === "overdue"
                      ? text.overdue
                      : text.idle(person.headline.stuck.days)}
                  </p>
                </div>
                <RowAction
                  person={person}
                  canSend={list.data.canSend}
                  sent={sent[person.userId]}
                  disabled={sendingAll}
                  onNudge={() => void nudge(person.userId)}
                />
              </li>
            ))}
          </ul>
          {ready.length > 1 && (
            <button
              type="button"
              className={`${buttonClass.ghost} mt-3 w-full`}
              disabled={sendingAll}
              onClick={() => void nudgeAll()}
            >
              {text.nudgeAll(ready.length)}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function RowAction({
  person,
  canSend,
  sent,
  disabled,
  onNudge,
}: {
  person: Person;
  canSend: boolean;
  sent: Sent | undefined;
  disabled: boolean;
  onNudge: () => void;
}) {
  const quiet = "shrink-0 text-xs text-light-900 dark:text-dark-900";

  if (!canSend) return null;
  if (sent?.status === "sending")
    return <span className={quiet}>{text.sending}</span>;
  if (sent?.status === "sent") {
    return (
      <span className={`${quiet} inline-flex items-center gap-1`}>
        <TbCheck className="h-3.5 w-3.5" aria-hidden="true" />
        {text.sent}
      </span>
    );
  }
  if (sent?.status === "unconfirmed") {
    return <span className={quiet}>{text.unconfirmed}</span>;
  }
  if (person.optedOut) return <span className={quiet}>{text.optedOut}</span>;
  if (person.waitSeconds !== null) {
    return (
      <span className={quiet}>
        {text.wait(Math.ceil(person.waitSeconds / 60))}
      </span>
    );
  }
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        className={buttonClass.ghost}
        disabled={disabled}
        onClick={onNudge}
      >
        {text.nudge}
      </button>
      {sent?.status === "failed" && (
        <span className="max-w-[10rem] text-right text-xs text-red-600 dark:text-red-400">
          {sent.message}
        </span>
      )}
    </div>
  );
}
