import { useEffect, useState } from "react";

import type { FormAccess, LikeMode, WallMode } from "@kan/hub/public";
import {
  FORM_LIMITS,
  formAccessLevels,
  likeModes,
  roleLabels,
  wallModes,
} from "@kan/hub/public";

import type { FormDraft } from "./form-draft";
import { copy } from "~/hub/copy/zh";
import {
  buttonClass,
  Card,
  ErrorText,
  inputClass,
  Pill,
  tableClass,
} from "~/hub/ui/admin-primitives";
import { api } from "~/utils/api";
import { fromLocalInput, toLocalInput } from "./form-display";

const text = copy.forms.settings;

const labelClass =
  "mb-1 block text-xs font-medium text-light-900 dark:text-dark-900";
const hintClass = "text-xs leading-5 text-light-900 dark:text-dark-900";
const checkClass =
  "h-4 w-4 rounded border-light-500 text-light-1000 focus:ring-0 disabled:opacity-40 dark:border-dark-500";
const optionRow =
  "flex items-start gap-2 text-sm text-light-1000 dark:text-dark-1000";

/** The 设置 tab: who may answer, limits, the results wall, and who manages the form. */
export function FormSettingsPanel({
  formId,
  draft,
  onChange,
  projects,
  managers,
  canShare,
  isManager,
}: {
  formId: string;
  draft: FormDraft;
  onChange: (draft: FormDraft) => void;
  projects: { publicId: string; name: string }[];
  managers: { userId: string; name: string; email: string }[];
  canShare: boolean;
  /** The person looking is one of the managers (needed to hide the form). */
  isManager: boolean;
}) {
  const { settings } = draft;
  const set = (patch: Partial<FormDraft["settings"]>) =>
    onChange({ ...draft, settings: { ...settings, ...patch } });

  const setAccess = (access: FormAccess) =>
    onChange({
      ...draft,
      access,
      settings: {
        ...settings,
        // Anonymous likes only exist on public forms.
        likes:
          access !== "public" && settings.likes === "anyone"
            ? "signed_in"
            : settings.likes,
      },
    });

  const toggleProject = (publicId: string, on: boolean) =>
    set({
      projectIds: on
        ? [...settings.projectIds, publicId]
        : settings.projectIds.filter((id) => id !== publicId),
    });

  const shownLikeModes = likeModes.filter(
    (mode) => mode !== "anyone" || draft.access === "public",
  );

  return (
    <div className="space-y-4">
      <Card title={text.access} hint={text.accessHint}>
        <fieldset className="space-y-2">
          <legend className="sr-only">{text.access}</legend>
          {formAccessLevels.map((access) => (
            <label key={access} className={optionRow}>
              <input
                type="radio"
                name="form-access"
                className="mt-0.5"
                checked={draft.access === access}
                onChange={() => setAccess(access)}
              />
              {copy.forms.access[access]}
            </label>
          ))}
        </fieldset>
        {draft.access === "projects" && (
          <fieldset className="mt-3 rounded-lg border border-light-300 p-3 dark:border-dark-300">
            <legend className="px-1 text-xs font-medium text-light-900 dark:text-dark-900">
              {text.projects}
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {projects.map((project) => (
                <label key={project.publicId} className={optionRow}>
                  <input
                    type="checkbox"
                    className={`${checkClass} mt-0.5`}
                    checked={settings.projectIds.includes(project.publicId)}
                    disabled={
                      !settings.projectIds.includes(project.publicId) &&
                      settings.projectIds.length >= FORM_LIMITS.projects
                    }
                    onChange={(event) =>
                      toggleProject(project.publicId, event.target.checked)
                    }
                  />
                  {project.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}
      </Card>

      <Card>
        <div className="space-y-4">
          <div>
            <label className={optionRow}>
              <input
                type="checkbox"
                className={`${checkClass} mt-0.5`}
                checked={settings.limitOne}
                onChange={(event) =>
                  set({
                    limitOne: event.target.checked,
                    allowEdit: event.target.checked && settings.allowEdit,
                  })
                }
              />
              {text.limitOne}
            </label>
            <p className={`${hintClass} ml-6`}>{text.limitOneHint}</p>
          </div>
          <label className={optionRow}>
            <input
              type="checkbox"
              className={`${checkClass} mt-0.5`}
              checked={settings.allowEdit}
              disabled={!settings.limitOne}
              onChange={(event) => set({ allowEdit: event.target.checked })}
            />
            {text.allowEdit}
          </label>

          <div>
            <span className={labelClass}>{text.closesAt}</span>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="datetime-local"
                className={`${inputClass} w-auto`}
                value={toLocalInput(draft.closesAt)}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    closesAt: fromLocalInput(event.target.value),
                  })
                }
              />
              {draft.closesAt && (
                <button
                  type="button"
                  className={buttonClass.ghost}
                  onClick={() => onChange({ ...draft, closesAt: null })}
                >
                  {text.clearDeadline}
                </button>
              )}
            </div>
            <p className={`${hintClass} mt-1`}>{text.closesAtHint}</p>
          </div>

          <div>
            <label className="block max-w-[12rem]">
              <span className={labelClass}>{text.maxResponses}</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={FORM_LIMITS.maxResponses}
                className={inputClass}
                value={draft.maxResponses ?? ""}
                onChange={(event) => {
                  const raw = event.target.value.trim();
                  if (raw === "") {
                    onChange({ ...draft, maxResponses: null });
                    return;
                  }
                  const value = Math.floor(Number(raw));
                  if (Number.isFinite(value) && value >= 1) {
                    onChange({
                      ...draft,
                      maxResponses: Math.min(value, FORM_LIMITS.maxResponses),
                    });
                  }
                }}
              />
            </label>
            <p className={`${hintClass} mt-1`}>{text.maxResponsesHint}</p>
          </div>
        </div>
      </Card>

      <Card title={text.wall} hint={text.wallHint}>
        <div className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="sr-only">{text.wall}</legend>
            {wallModes.map((mode: WallMode) => (
              <label key={mode} className={optionRow}>
                <input
                  type="radio"
                  name="form-wall"
                  className="mt-0.5"
                  checked={settings.wall === mode}
                  onChange={() => set({ wall: mode })}
                />
                {copy.forms.wallModes[mode]}
              </label>
            ))}
          </fieldset>
          <div>
            <label className={optionRow}>
              <input
                type="checkbox"
                className={`${checkClass} mt-0.5`}
                checked={settings.wallShowNames}
                disabled={settings.wall === "off"}
                onChange={(event) =>
                  set({ wallShowNames: event.target.checked })
                }
              />
              {text.wallShowNames}
            </label>
            <p className={`${hintClass} ml-6`}>{text.wallShowNamesHint}</p>
          </div>
          <fieldset className="space-y-2" disabled={settings.wall === "off"}>
            <legend className={labelClass}>{text.likes}</legend>
            {shownLikeModes.map((mode: LikeMode) => (
              <label
                key={mode}
                className={`${optionRow} ${settings.wall === "off" ? "opacity-50" : ""}`}
              >
                <input
                  type="radio"
                  name="form-likes"
                  className="mt-0.5"
                  checked={settings.likes === mode}
                  onChange={() => set({ likes: mode })}
                />
                {copy.forms.likeModes[mode]}
              </label>
            ))}
          </fieldset>
        </div>
      </Card>

      <Card title={text.confirmation}>
        <textarea
          className={`${inputClass} min-h-[72px]`}
          maxLength={FORM_LIMITS.confirmation}
          placeholder={text.confirmationPlaceholder}
          value={settings.confirmation}
          onChange={(event) => set({ confirmation: event.target.value })}
        />
      </Card>

      <ManagersCard
        formId={formId}
        managers={managers}
        canShare={canShare}
        managersOnly={settings.managersOnly === true}
        // Turning it on is refused for someone not on the list: it would
        // hide the form from them. Turning it off is always possible.
        canHide={isManager}
        onManagersOnlyChange={(managersOnly) => set({ managersOnly })}
      />
    </div>
  );
}

function ManagersCard({
  formId,
  managers,
  canShare,
  managersOnly,
  canHide,
  onManagersOnlyChange,
}: {
  formId: string;
  managers: { userId: string; name: string; email: string }[];
  canShare: boolean;
  managersOnly: boolean;
  canHide: boolean;
  onManagersOnlyChange: (managersOnly: boolean) => void;
}) {
  const utils = api.useUtils();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const candidates = api.hub.forms.candidates.useQuery(
    { formPublicId: formId, search },
    { enabled: canShare && search.length > 0, retry: false },
  );
  const refresh = () => {
    void utils.hub.forms.get.invalidate({ formPublicId: formId });
    void utils.hub.forms.candidates.invalidate();
  };
  const add = api.hub.forms.addManager.useMutation({
    onSuccess: () => {
      setSearchInput("");
      setSearch("");
      refresh();
    },
  });
  const remove = api.hub.forms.removeManager.useMutation({
    onSuccess: refresh,
  });

  return (
    <Card title={text.managers} hint={text.managersHint}>
      <div className="mb-3 rounded-lg border border-light-300 p-3 dark:border-dark-300">
        <label className={optionRow}>
          <input
            type="checkbox"
            className={`${checkClass} mt-0.5`}
            checked={managersOnly}
            disabled={!managersOnly && !canHide}
            onChange={(event) => onManagersOnlyChange(event.target.checked)}
          />
          {text.managersOnly}
        </label>
        <p className={`${hintClass} ml-6 mt-1`}>
          {!managersOnly && !canHide
            ? text.managersOnlyNeedsYou
            : text.managersOnlyHint}
        </p>
      </div>
      <ul className="divide-y divide-light-200 dark:divide-dark-200">
        {managers.map((manager) => (
          <li
            key={manager.userId}
            className="flex items-center justify-between gap-3 py-2"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm text-light-1000 dark:text-dark-1000">
                {manager.name}
              </span>
              <span className={tableClass.sub}>{manager.email}</span>
            </span>
            {canShare && (
              <button
                type="button"
                className={buttonClass.dangerText}
                disabled={remove.isPending}
                onClick={() =>
                  remove.mutate({
                    formPublicId: formId,
                    userId: manager.userId,
                  })
                }
              >
                {text.removeManager}
              </button>
            )}
          </li>
        ))}
      </ul>

      {canShare ? (
        <div className="mt-3">
          <input
            type="search"
            className={inputClass}
            placeholder={text.addManager}
            aria-label={text.addManager}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
          {(candidates.data?.length ?? 0) > 0 && (
            <ul className="mt-2 divide-y divide-light-200 rounded-lg border border-light-300 dark:divide-dark-200 dark:border-dark-300">
              {candidates.data?.map((candidate) => (
                <li key={candidate.userId}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-light-100 dark:hover:bg-dark-200"
                    disabled={add.isPending}
                    onClick={() =>
                      add.mutate({
                        formPublicId: formId,
                        userId: candidate.userId,
                      })
                    }
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-light-1000 dark:text-dark-1000">
                        {candidate.name}
                      </span>
                      <span className={tableClass.sub}>{candidate.email}</span>
                    </span>
                    {candidate.hubRole && (
                      <Pill>{roleLabels[candidate.hubRole]}</Pill>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className={`${hintClass} mt-3`}>{text.cannotShare}</p>
      )}
      <div className="mt-2">
        <ErrorText
          message={
            add.error?.message ??
            remove.error?.message ??
            candidates.error?.message
          }
        />
      </div>
    </Card>
  );
}
