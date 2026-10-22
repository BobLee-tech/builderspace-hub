import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  AnswerInput,
  FillView,
  FormDefinition,
  Jsonified,
  SubmitResult,
} from "@kan/hub/public";
import { checkAnswers, closedReasonText, isQuestion } from "@kan/hub/public";

import type { AnswerUpdate } from "./FieldInput";
import { copy } from "~/hub/copy/zh";
import {
  clearDraft,
  formApi,
  FormApiError,
  loadDraft,
  rememberEditToken,
  saveDraft,
} from "~/hub/lib/form-client";
import { buttonClass, ErrorText } from "~/hub/ui/admin-primitives";
import { fieldAnchor, FieldBlock } from "./FieldInput";
import { formatDateTime } from "./form-display";
import { FormImg, PhasePill, RichText } from "./form-ui";
import { FormShell, Notice, panelClass } from "./FormShell";

const text = copy.forms.fill;

type View = Jsonified<FillView>;
type Values = Record<string, AnswerInput>;
/** Filling in a new answer, looking at the one sent, or changing it. */
type Mode = "fill" | "done" | "edit";

const hasValues = (values: Values | null): values is Values =>
  values !== null &&
  typeof values === "object" &&
  !Array.isArray(values) &&
  Object.keys(values).length > 0;

const errorMessage = (error: unknown) =>
  error instanceof FormApiError ? error.message : text.networkError;

/**
 * The page a form's link opens, for anyone: signed in or not, on a phone
 * first. It never calls tRPC (see form-client.ts). Unsent answers are kept
 * in this browser as they are typed, so a reload loses nothing.
 */
export function FillPage() {
  const router = useRouter();
  const formId =
    router.isReady && typeof router.query.publicId === "string"
      ? router.query.publicId
      : null;

  const [view, setView] = useState<View | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("fill");
  const [justSent, setJustSent] = useState(false);
  const [values, setValues] = useState<Values>({});
  const [restored, setRestored] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // One key per answer being sent: a retry after a dropped connection reuses
  // it, so the server does not count the answer twice.
  const submissionKey = useRef<string | null>(null);
  const started = useRef(false);

  const refresh = useCallback(async () => {
    if (!formId) return null;
    const next = await formApi<View>(formId, formId);
    setView(next);
    return next;
  }, [formId]);

  useEffect(() => {
    if (!formId || started.current) return;
    started.current = true;
    refresh()
      .then((first) => {
        if (!first) return;
        if (first.mine && !first.canSubmit) {
          setMode("done");
          return;
        }
        const draft = loadDraft<Values>(formId);
        if (first.form && first.canSubmit && hasValues(draft)) {
          setValues(draft);
          setRestored(true);
        }
      })
      .catch((error: unknown) => setLoadError(errorMessage(error)));
  }, [formId, refresh]);

  // Keep what is typed, a moment after typing stops. Only for a new answer:
  // changes to a sent answer are not drafts.
  useEffect(() => {
    if (!formId || mode !== "fill" || !view?.form) return;
    const timer = setTimeout(() => {
      if (Object.keys(values).length > 0) saveDraft(formId, values);
    }, 500);
    return () => clearTimeout(timer);
  }, [formId, mode, values, view?.form]);

  const definition = useMemo<FormDefinition | null>(
    () =>
      view?.form
        ? ({
            description: view.form.description,
            coverImage: view.form.coverImage,
            fields: view.form.fields,
          } as FormDefinition)
        : null,
    [view?.form],
  );

  const attached = useMemo(
    () =>
      new Set(
        Object.values(view?.mine?.answers ?? {}).flatMap((answer) =>
          Array.isArray(answer) ? answer : [],
        ),
      ),
    [view?.mine],
  );

  const update = useCallback((fieldId: string, change: AnswerUpdate) => {
    setValues((previous) => {
      const next = change(previous[fieldId]);
      const copyOf = { ...previous };
      if (next === undefined) delete copyOf[fieldId];
      else copyOf[fieldId] = next;
      return copyOf;
    });
    setFieldErrors((errors) => {
      if (!(fieldId in errors)) return errors;
      const rest = { ...errors };
      delete rest[fieldId];
      return rest;
    });
  }, []);

  if (loadError) {
    return (
      <FormShell title={copy.forms.title}>
        <div className={panelClass}>
          <p className="text-sm text-light-900 dark:text-dark-900">
            {loadError}
          </p>
        </div>
      </FormShell>
    );
  }
  if (!view || !formId) {
    return (
      <FormShell title={copy.forms.title}>
        <p className="text-sm text-light-900 dark:text-dark-900">
          {text.loading}
        </p>
      </FormShell>
    );
  }

  const phase = view.phase;
  const isDraft = phase.phase === "draft";
  const editing = mode === "edit";
  const open = phase.phase === "open";
  const canSend = editing ? view.canEdit : view.canSubmit;
  const inputsDisabled = sending || (!isDraft && !canSend);
  const wallHref = `/forms/${formId}/wall`;

  function showErrors(errors: Record<string, string>) {
    setFieldErrors(errors);
    const fields = view?.form?.fields ?? [];
    const first = fields.find((field) => field.id in errors);
    if (first) {
      document
        .getElementById(fieldAnchor(first.id))
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  async function send() {
    if (!definition || !formId) return;
    setSubmitError(null);
    const checked = checkAnswers(definition, values);
    if (!checked.ok) {
      showErrors(checked.errors);
      setSubmitError(text.fixErrors);
      return;
    }
    setSending(true);
    try {
      if (editing) {
        await formApi(formId, `${formId}/responses/mine`, {
          method: "PUT",
          json: { answers: values },
        });
      } else {
        submissionKey.current ??= crypto.randomUUID();
        const result = await formApi<SubmitResult>(
          formId,
          `${formId}/responses`,
          {
            method: "POST",
            json: { answers: values, submissionKey: submissionKey.current },
          },
        );
        rememberEditToken(formId, result.editToken);
        submissionKey.current = null;
        clearDraft(formId);
      }
      setFieldErrors({});
      setRestored(false);
      await refresh().catch(() => undefined);
      setJustSent(true);
      setMode("done");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      if (
        error instanceof FormApiError &&
        Object.keys(error.fieldErrors).length > 0
      ) {
        showErrors(error.fieldErrors);
        setSubmitError(error.message);
      } else {
        setSubmitError(errorMessage(error));
        // The form may have closed or filled up meanwhile: show it as it is now.
        if (error instanceof FormApiError && error.status === 409) {
          void refresh().catch(() => undefined);
        }
      }
    } finally {
      setSending(false);
    }
  }

  const startEdit = () => {
    setValues(view.mine?.answers ?? {});
    setFieldErrors({});
    setSubmitError(null);
    setMode("edit");
  };

  const startAgain = () => {
    setValues({});
    setFieldErrors({});
    setSubmitError(null);
    setJustSent(false);
    submissionKey.current = null;
    setMode("fill");
  };

  let questionNumber = 0;

  return (
    <FormShell title={view.title}>
      {view.isManager && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-light-300 bg-light-50 px-3 py-2 text-sm text-light-900 dark:border-dark-300 dark:bg-dark-100 dark:text-dark-900">
          <span>{text.managerHint}</span>
          <span className="flex gap-3">
            <Link
              href={wallHref}
              className="font-medium underline underline-offset-2"
            >
              {copy.forms.wall.title}
            </Link>
            <Link
              href={`/forms/${formId}/manage`}
              className="font-medium text-light-1000 underline underline-offset-2 dark:text-dark-1000"
            >
              {text.manage}
            </Link>
          </span>
        </div>
      )}

      <header className={`${panelClass} overflow-hidden p-0 sm:p-0`}>
        {view.form?.coverImage && (
          <FormImg
            id={view.form.coverImage}
            className="aspect-[3/1] w-full rounded-none border-0 border-b"
          />
        )}
        <div className="p-4 sm:p-6">
          <h1 className="text-xl font-bold tracking-tight text-light-1000 dark:text-dark-1000 sm:text-2xl">
            {view.title}
          </h1>
          {view.form && (
            <RichText
              text={view.form.description}
              className="mt-2 text-sm leading-6 text-light-900 dark:text-dark-900"
            />
          )}
          <StatusLine view={view} />
        </div>
      </header>

      <div className="mt-4 flex flex-col gap-3">
        {view.blocked === "sign_in" && (
          <div className={panelClass}>
            <p className="text-sm leading-6 text-light-900 dark:text-dark-900">
              {text.signInHint}
            </p>
            <Link
              href={`/login?next=${encodeURIComponent(`/forms/${formId}`)}`}
              className={`${buttonClass.primary} mt-3 px-5 py-2.5`}
            >
              {text.signIn}
            </Link>
          </div>
        )}
        {view.blocked === "not_in_project" && (
          <Notice tone="warn">{text.notInProject}</Notice>
        )}
        {isDraft && <Notice tone="warn">{text.draftPreview}</Notice>}
        {phase.phase === "closed" && mode !== "done" && (
          <Notice tone="warn">{closedReasonText[phase.reason]}</Notice>
        )}

        {mode === "done" && view.form && (
          <div className={panelClass}>
            <p className="text-base font-semibold text-light-1000 dark:text-dark-1000">
              {justSent ? text.submitted : text.alreadyAnswered}
            </p>
            {justSent && (
              <RichText
                text={view.settings.confirmation || text.thanks}
                className="mt-1 text-sm leading-6 text-light-900 dark:text-dark-900"
              />
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {view.canSeeWall && (
                <Link
                  href={wallHref}
                  className={`${buttonClass.primary} px-4 py-2`}
                >
                  {text.seeWall}
                </Link>
              )}
              {view.canEdit && view.mine && (
                <button
                  type="button"
                  className={`${buttonClass.ghost} px-4 py-2`}
                  onClick={startEdit}
                >
                  {text.edit}
                </button>
              )}
              {!view.settings.limitOne && view.canSubmit && (
                <button
                  type="button"
                  className={`${buttonClass.ghost} px-4 py-2`}
                  onClick={startAgain}
                >
                  {text.submitAgain}
                </button>
              )}
            </div>
          </div>
        )}

        {mode !== "done" && view.form && (
          <form
            noValidate
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            {restored && mode === "fill" && (
              <Notice>
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span>{text.draftRestored}</span>
                  <button
                    type="button"
                    className="font-medium underline underline-offset-2"
                    onClick={() => {
                      clearDraft(formId);
                      setValues({});
                      setFieldErrors({});
                      setRestored(false);
                    }}
                  >
                    {text.clearDraft}
                  </button>
                </span>
              </Notice>
            )}

            {view.form.fields.map((field) => {
              const number = isQuestion(field) ? (questionNumber += 1) : null;
              return (
                <FieldBlock
                  key={field.id}
                  field={field}
                  number={number}
                  value={values[field.id]}
                  update={(change) => update(field.id, change)}
                  error={fieldErrors[field.id]}
                  context={{
                    formId,
                    disabled: inputsDisabled,
                    signedIn: view.signedInAs !== null,
                    attached,
                  }}
                />
              );
            })}

            {(canSend || isDraft) && (
              <div className="mt-2 flex flex-col gap-3">
                <ErrorText message={submitError} />
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="submit"
                    className={`${buttonClass.primary} min-h-[44px] flex-1 px-6 text-base sm:flex-none`}
                    disabled={sending || isDraft || !open}
                  >
                    {sending
                      ? text.submitting
                      : editing
                        ? text.update
                        : text.submit}
                  </button>
                  {editing && (
                    <button
                      type="button"
                      className={`${buttonClass.ghost} min-h-[44px] px-5`}
                      disabled={sending}
                      onClick={() => {
                        setFieldErrors({});
                        setSubmitError(null);
                        setMode("done");
                      }}
                    >
                      {text.cancelEdit}
                    </button>
                  )}
                </div>
              </div>
            )}
          </form>
        )}
      </div>
    </FormShell>
  );
}

/** Deadline, places left, and who the answer will be sent as. */
function StatusLine({ view }: { view: View }) {
  const items: React.ReactNode[] = [];
  if (view.phase.phase !== "open") {
    items.push(<PhasePill key="phase" phase={view.phase} />);
  }
  if (view.closesAt) {
    items.push(
      <span key="deadline">
        {text.closesAt(formatDateTime(view.closesAt))}
      </span>,
    );
  }
  if (view.remaining !== null && view.phase.phase === "open") {
    items.push(<span key="remaining">{text.remaining(view.remaining)}</span>);
  }
  if (view.form) {
    if (view.signedInAs !== null) {
      items.push(<span key="who">{text.signedInAs(view.signedInAs)}</span>);
    } else if (view.form.access === "public") {
      items.push(<span key="who">{text.anonymousNote}</span>);
    }
  }
  if (items.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs leading-5 text-light-900 dark:text-dark-900">
      {items}
    </div>
  );
}
