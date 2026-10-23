import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  TbChartBar,
  TbChevronLeft,
  TbEye,
  TbListDetails,
  TbMessages,
  TbSettings,
} from "react-icons/tb";
import { twMerge } from "tailwind-merge";

import { checkDefinition, formHref } from "@kan/hub/public";

import type { FormDraft } from "./form-draft";
import { PageHead } from "~/components/PageHead";
import { copy } from "~/hub/copy/zh";
import {
  buttonClass,
  ConfirmButton,
  ErrorText,
} from "~/hub/ui/admin-primitives";
import { api } from "~/utils/api";
import { formatDateTime } from "./form-display";
import { baseAfterStatusChange, draftOf, sameDraft } from "./form-draft";
import { CopyLinkButton, PhasePill } from "./form-ui";
import { FormBuilder } from "./FormBuilder";
import { FormSettingsPanel } from "./FormSettingsPanel";
import { ResponsesPanel } from "./ResponsesPanel";
import { SummaryPanel } from "./SummaryPanel";

const text = copy.forms.manage;

const TABS = [
  { key: "questions", icon: TbListDetails },
  { key: "settings", icon: TbSettings },
  { key: "responses", icon: TbMessages },
  { key: "summary", icon: TbChartBar },
] as const;
type Tab = (typeof TABS)[number]["key"];

const isTab = (value: unknown): value is Tab =>
  TABS.some((tab) => tab.key === value);

/** The draft being edited, and the saved form it started from. */
interface Editing {
  formId: string;
  base: FormDraft;
  draft: FormDraft;
  /** The `updatedAt` `base` was read at: the save is refused if it changed since. */
  baseUpdatedAt: string;
}

/**
 * One form for the people who manage it: build it, set who may answer,
 * open and close it, and read the answers. 题目 and 设置 edit one draft
 * that is saved in one go.
 */
export function FormManagePage() {
  const router = useRouter();
  const formId =
    typeof router.query.publicId === "string" ? router.query.publicId : null;
  const tab: Tab = isTab(router.query.tab) ? router.query.tab : "questions";

  const utils = api.useUtils();
  const query = api.hub.forms.get.useQuery(
    { formPublicId: formId ?? "" },
    { enabled: router.isReady && !!formId, retry: false },
  );
  const detail = query.data;

  const [editing, setEditing] = useState<Editing | null>(null);
  // A fresh copy of the form replaces the draft unless the draft has
  // unsaved changes; a different form always replaces it.
  useEffect(() => {
    if (!detail) return;
    setEditing((previous) => {
      if (
        previous &&
        previous.formId === detail.publicId &&
        !sameDraft(previous.draft, previous.base)
      ) {
        return previous;
      }
      const fresh = draftOf(detail);
      return {
        formId: detail.publicId,
        base: fresh,
        draft: fresh,
        baseUpdatedAt: detail.updatedAt.toISOString(),
      };
    });
  }, [detail]);

  const current = editing?.formId === formId ? editing : null;
  const dirty = current ? !sameDraft(current.draft, current.base) : false;
  const setDraft = (draft: FormDraft) =>
    setEditing((previous) => (previous ? { ...previous, draft } : previous));

  const leaveWarning = useLeaveWarning(dirty);

  const [showProblems, setShowProblems] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const definitionCheck = useMemo(
    () => (current ? checkDefinition(current.draft.definition) : null),
    [current],
  );
  const problems = useMemo(() => {
    const byField = new Map<string, string[]>();
    const general: string[] = [];
    if (!current)
      return {
        byField,
        general,
        all: [] as { fieldId?: string; message: string }[],
      };
    const all: { fieldId?: string; message: string }[] = [];
    if (!current.draft.title.trim()) {
      all.push({ message: copy.forms.builder.titleRequired });
    }
    if (
      current.draft.access === "projects" &&
      current.draft.settings.projectIds.length === 0
    ) {
      all.push({ message: copy.forms.settings.projectsRequired });
    }
    if (definitionCheck && !definitionCheck.ok)
      all.push(...definitionCheck.problems);
    for (const problem of all) {
      if (problem.fieldId) {
        byField.set(problem.fieldId, [
          ...(byField.get(problem.fieldId) ?? []),
          problem.message,
        ]);
      } else {
        general.push(problem.message);
      }
    }
    return { byField, general, all };
  }, [current, definitionCheck]);

  const save = api.hub.forms.save.useMutation();
  const setStatus = api.hub.forms.setStatus.useMutation({
    onSuccess: (result, sent) => {
      // Before the fresh copy arrives: a draft with changes keeps its time,
      // so it must already be the one this change left the form at.
      setEditing((previous) =>
        previous &&
        previous.formId === sent.formPublicId &&
        sent.expectedUpdatedAt
          ? {
              ...previous,
              baseUpdatedAt: baseAfterStatusChange(
                previous.baseUpdatedAt,
                sent.expectedUpdatedAt,
                result.updatedAt,
              ),
            }
          : previous,
      );
      void utils.hub.forms.get.invalidate({ formPublicId: formId ?? "" });
      void utils.hub.forms.list.invalidate();
    },
  });
  const duplicate = api.hub.forms.duplicate.useMutation({
    onSuccess: ({ publicId }) => {
      void utils.hub.forms.list.invalidate();
      void router.push(`/forms/${publicId}/manage`);
    },
  });
  const remove = api.hub.forms.delete.useMutation({
    onSuccess: () => {
      // The draft went with the form: nothing left to warn about.
      leaveWarning.current = false;
      void utils.hub.forms.list.invalidate();
      void router.push("/forms");
    },
  });

  useEffect(() => {
    if (!justSaved) return;
    const timer = setTimeout(() => setJustSaved(false), 2000);
    return () => clearTimeout(timer);
  }, [justSaved]);

  function onSave() {
    if (!current || !formId) return;
    setShowProblems(true);
    if (problems.all.length > 0) return;
    const submitted = current.draft;
    save.mutate(
      {
        formPublicId: formId,
        title: submitted.title,
        access: submitted.access,
        definition: submitted.definition,
        settings: submitted.settings,
        closesAt: submitted.closesAt,
        maxResponses: submitted.maxResponses,
        expectedUpdatedAt: current.baseUpdatedAt,
      },
      {
        onSuccess: (result) => {
          // What was sent is now saved; the server's tidied copy replaces
          // the draft when it arrives, unless editing went on meanwhile.
          setEditing((previous) =>
            previous && previous.formId === formId
              ? {
                  ...previous,
                  base: submitted,
                  baseUpdatedAt: result.updatedAt.toISOString(),
                }
              : previous,
          );
          setShowProblems(false);
          setJustSaved(true);
          void utils.hub.forms.get.invalidate({ formPublicId: formId });
          void utils.hub.forms.list.invalidate();
        },
      },
    );
  }

  const setTab = (next: Tab) =>
    void router.push(
      { pathname: router.pathname, query: { ...router.query, tab: next } },
      undefined,
      { shallow: true },
    );

  const jumpTo = (fieldId: string) => {
    if (tab !== "questions") setTab("questions");
    setTimeout(() => {
      document
        .getElementById(`field-${fieldId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  };

  const notFound = query.error?.data?.code === "NOT_FOUND";

  return (
    <>
      <PageHead
        title={`${detail?.title ?? copy.forms.title} | ${copy.brand}`}
      />
      <div className="mx-auto w-full max-w-4xl px-4 pt-6 md:px-6">
        <Link
          href="/forms"
          className="mb-3 inline-flex items-center gap-1 text-sm text-light-900 hover:underline dark:text-dark-900"
        >
          <TbChevronLeft size={14} aria-hidden="true" />
          {text.back}
        </Link>

        {notFound ? (
          <p className="rounded-xl border border-dashed border-light-400 p-8 text-center text-sm text-light-900 dark:border-dark-400 dark:text-dark-900">
            {text.notFound}
          </p>
        ) : (
          <ErrorText message={query.error?.message} />
        )}
        {query.isLoading && (
          <p className="text-sm text-light-900 dark:text-dark-900">
            {copy.forms.loading}
          </p>
        )}

        {detail && formId && current && (
          <>
            <header className="mb-5">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-light-1000 dark:text-dark-1000">
                  {detail.title}
                </h1>
                <PhasePill phase={detail.phase} />
              </div>
              <p className="mt-1 text-sm text-light-900 dark:text-dark-900">
                {[
                  text.responseCount(detail.responseCount),
                  detail.maxResponses !== null &&
                    text.remaining(
                      Math.max(0, detail.maxResponses - detail.responseCount),
                    ),
                  detail.closesAt &&
                    text.closesAt(formatDateTime(detail.closesAt)),
                  copy.forms.accessShort[detail.access],
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {detail.status === "draft" && (
                <p className="mt-1 text-xs text-light-900 dark:text-dark-900">
                  {text.draftHint}
                </p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <StatusActions
                  status={detail.status}
                  responseCount={detail.responseCount}
                  dirty={dirty}
                  isPending={setStatus.isPending}
                  onChange={(status) =>
                    setStatus.mutate({
                      formPublicId: formId,
                      status,
                      expectedUpdatedAt: current.baseUpdatedAt,
                    })
                  }
                />
                {detail.status !== "draft" && (
                  <CopyLinkButton publicId={formId} />
                )}
                <a
                  href={formHref(formId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={twMerge(buttonClass.ghost, "gap-1.5")}
                >
                  <TbEye size={16} aria-hidden="true" />
                  {text.preview}
                </a>
                {detail.settings.wall !== "off" && (
                  <a
                    href={`${formHref(formId)}/wall`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={buttonClass.ghost}
                  >
                    {text.wall}
                  </a>
                )}
                <button
                  type="button"
                  className={buttonClass.ghost}
                  title={dirty ? text.saveFirst : text.duplicateHint}
                  disabled={dirty || duplicate.isPending}
                  onClick={() => duplicate.mutate({ formPublicId: formId })}
                >
                  {text.duplicate}
                </button>
                {detail.canShare && (
                  <span title={text.deleteHint}>
                    <ConfirmButton
                      label={text.delete}
                      isPending={remove.isPending}
                      onConfirm={() => remove.mutate({ formPublicId: formId })}
                    />
                  </span>
                )}
              </div>
              <div className="mt-2">
                <ErrorText
                  message={
                    setStatus.error?.message ??
                    duplicate.error?.message ??
                    remove.error?.message
                  }
                />
              </div>
            </header>

            <nav
              role="tablist"
              className="mb-5 flex gap-1 overflow-x-auto border-b border-light-300 dark:border-dark-300"
            >
              {TABS.map(({ key, icon: Icon }) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  className={twMerge(
                    "-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 border-transparent px-3 py-2 text-sm font-medium text-light-900 hover:text-light-1000 dark:text-dark-900 dark:hover:text-dark-1000",
                    tab === key &&
                      "border-light-1000 text-light-1000 dark:border-dark-1000 dark:text-dark-1000",
                  )}
                  onClick={() => setTab(key)}
                >
                  <Icon size={16} aria-hidden="true" />
                  {text.tabs[key]}
                  {key === "responses" && detail.responseCount > 0 && (
                    <span className="text-xs text-light-900 dark:text-dark-900">
                      {detail.responseCount}
                    </span>
                  )}
                </button>
              ))}
            </nav>

            {tab === "questions" && (
              <FormBuilder
                formId={formId}
                draft={current.draft}
                onChange={setDraft}
                problems={showProblems ? problems.byField : new Map()}
                formProblems={showProblems ? problems.general : []}
                savedFieldIds={
                  new Set(detail.definition.fields.map((field) => field.id))
                }
                hasResponses={detail.responseCount > 0}
              />
            )}
            {tab === "settings" && (
              <FormSettingsPanel
                formId={formId}
                draft={current.draft}
                onChange={setDraft}
                projects={detail.projects}
                managers={detail.managers}
                canShare={detail.canShare}
                isManager={detail.isManager}
              />
            )}
            {tab === "responses" && (
              <ResponsesPanel
                formId={formId}
                title={detail.title}
                definition={detail.definition}
                showLikes={detail.settings.likes !== "off"}
              />
            )}
            {tab === "summary" && <SummaryPanel formId={formId} />}

            {(tab === "questions" || tab === "settings") && (
              <div className="sticky bottom-0 z-10 -mx-4 mt-6 border-t border-light-300 bg-light-50/95 px-4 py-3 backdrop-blur dark:border-dark-300 dark:bg-dark-50/95 md:-mx-6 md:px-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span
                    className={twMerge(
                      "text-sm text-light-900 dark:text-dark-900",
                      showProblems &&
                        problems.all.length > 0 &&
                        "text-red-600 dark:text-red-400",
                    )}
                    aria-live="polite"
                  >
                    {save.isPending
                      ? text.saving
                      : showProblems && problems.all.length > 0
                        ? text.problems(problems.all.length)
                        : dirty
                          ? text.unsaved
                          : justSaved
                            ? text.saved
                            : ""}
                  </span>
                  <button
                    type="button"
                    className={buttonClass.primary}
                    disabled={!dirty || save.isPending}
                    onClick={onSave}
                  >
                    {save.isPending ? text.saving : text.save}
                  </button>
                </div>
                {showProblems && problems.all.length > 0 && (
                  <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto text-sm text-red-600 dark:text-red-400">
                    {problems.all
                      .slice(0, 8)
                      .map(({ fieldId, message }, index) => (
                        <li key={index}>
                          {fieldId ? (
                            <button
                              type="button"
                              className="text-left hover:underline"
                              onClick={() => jumpTo(fieldId)}
                            >
                              {message}
                            </button>
                          ) : (
                            message
                          )}
                        </li>
                      ))}
                  </ul>
                )}
                <div className="mt-1">
                  <ErrorText message={save.error?.message} />
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {/* Room below the last card so the sticky bar never covers it. */}
      <div className="h-6" />
    </>
  );
}

function StatusActions({
  status,
  responseCount,
  dirty,
  isPending,
  onChange,
}: {
  status: "draft" | "open" | "closed";
  responseCount: number;
  dirty: boolean;
  isPending: boolean;
  onChange: (status: "draft" | "open" | "closed") => void;
}) {
  if (status === "draft") {
    return (
      <button
        type="button"
        className={buttonClass.primary}
        title={dirty ? text.saveFirst : text.publishHint}
        disabled={dirty || isPending}
        onClick={() => onChange("open")}
      >
        {dirty ? text.saveFirst : text.publish}
      </button>
    );
  }
  return (
    <>
      {status === "open" ? (
        <button
          type="button"
          className={buttonClass.ghost}
          disabled={isPending}
          onClick={() => onChange("closed")}
        >
          {text.close}
        </button>
      ) : (
        <button
          type="button"
          className={buttonClass.primary}
          title={dirty ? text.saveFirst : undefined}
          disabled={dirty || isPending}
          onClick={() => onChange("open")}
        >
          {text.reopen}
        </button>
      )}
      {responseCount === 0 && (
        <button
          type="button"
          className={buttonClass.ghost}
          disabled={isPending}
          onClick={() => onChange("draft")}
        >
          {text.backToDraft}
        </button>
      )}
    </>
  );
}

/**
 * Asks before leaving the page with unsaved changes: closing or reloading
 * the tab, and following a link inside the app. Switching tabs on this page
 * keeps the draft, so it does not ask. Returns a switch the page can turn
 * off when leaving is expected (the form was just deleted).
 */
function useLeaveWarning(dirty: boolean) {
  const router = useRouter();
  const enabled = useRef(true);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current || !enabled.current) return;
      event.preventDefault();
      // Older browsers need a value to show their own prompt.
      event.returnValue = "";
    };
    const onRouteChangeStart = (url: string) => {
      if (!dirtyRef.current || !enabled.current) return;
      const next = new URL(url, window.location.href);
      if (next.pathname === window.location.pathname) return;
      if (window.confirm(text.leaveWarning)) return;
      router.events.emit("routeChangeError");
      // Next.js has no other way to cancel a route change from here.
      throw new Error("Route change cancelled: the form has unsaved changes");
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    router.events.on("routeChangeStart", onRouteChangeStart);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      router.events.off("routeChangeStart", onRouteChangeStart);
    };
  }, [router]);

  return enabled;
}
