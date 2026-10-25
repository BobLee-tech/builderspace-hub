import { useMemo, useState } from "react";
import { TbChevronDown, TbChevronRight, TbX } from "react-icons/tb";
import { twMerge } from "tailwind-merge";

import type { RouterInputs, RouterOutputs } from "~/utils/api";
import { copy } from "~/hub/copy/zh";
import { ErrorText, inputClass } from "~/hub/ui/admin-primitives";
import { api } from "~/utils/api";

export type AudienceChoice = NonNullable<
  RouterInputs["hub"]["documents"]["update"]["audience"]
>;
type Selected = Extract<AudienceChoice, { kind: "selected" }>;
type Group = Selected["groups"][number];
type Options = RouterOutputs["hub"]["documents"]["audienceOptions"];
type Detail = RouterOutputs["hub"]["documents"]["get"];
export type ReaderList = NonNullable<Detail["readers"]>;

const text = copy.documents.audience;
const kinds = ["all", "selected", "editors"] as const;

/** The picker's starting value for a document as it is now. */
export function audienceFrom(detail: {
  audience: Detail["audience"];
  readers: ReaderList | null;
}): AudienceChoice {
  if (detail.audience !== "selected") return { kind: detail.audience };
  return {
    kind: "selected",
    userIds: detail.readers?.users.map((u) => u.userId) ?? [],
    groups:
      detail.readers?.groups.map((g) => ({
        projectPublicId: g.projectPublicId,
        departmentPublicId: g.departmentPublicId,
      })) ?? [],
  };
}

/** Nothing picked yet under 指定的人: the form should not be sent like that. */
export function isEmptySelection(value: AudienceChoice): boolean {
  return (
    value.kind === "selected" &&
    value.userIds.length === 0 &&
    value.groups.length === 0
  );
}

/**
 * 谁能看: every member, 指定的人 (projects, departments of a project and single
 * members, in any mix), or only the people who can edit the document.
 * `known` names what is already chosen, for entries the options no longer list.
 */
export function AudiencePicker({
  value,
  onChange,
  known,
}: {
  value: AudienceChoice;
  onChange: (value: AudienceChoice) => void;
  known?: ReaderList | null;
}) {
  return (
    <fieldset className="text-sm">
      <legend className="text-sm">{text.label}</legend>
      <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
        {kinds.map((kind) => (
          <label
            key={kind}
            className={twMerge(
              "flex cursor-pointer gap-2 rounded-lg border border-light-300 p-2.5 dark:border-dark-300",
              value.kind === kind && "border-light-1000 dark:border-dark-1000",
            )}
          >
            <input
              type="radio"
              name="audience"
              className="mt-0.5"
              checked={value.kind === kind}
              onChange={() =>
                onChange(
                  kind === "selected"
                    ? { kind, userIds: [], groups: [] }
                    : { kind },
                )
              }
            />
            <span>
              <span className="block font-medium">
                {text.options[kind].label}
              </span>
              <span className="block text-xs text-light-900 dark:text-dark-900">
                {text.options[kind].hint}
              </span>
            </span>
          </label>
        ))}
      </div>
      {value.kind === "selected" && (
        <SelectionEditor value={value} onChange={onChange} known={known} />
      )}
    </fieldset>
  );
}

const groupKey = (group: Group) =>
  `${group.projectPublicId}:${group.departmentPublicId ?? ""}`;

function SelectionEditor({
  value,
  onChange,
  known,
}: {
  value: Selected;
  onChange: (value: AudienceChoice) => void;
  known?: ReaderList | null;
}) {
  const options = api.hub.documents.audienceOptions.useQuery(undefined, {
    retry: false,
    staleTime: 60_000,
  });
  const [search, setSearch] = useState("");

  const chosenGroups = new Set(value.groups.map(groupKey));
  const chosenUsers = new Set(value.userIds);
  const wholeProjects = new Set(
    value.groups
      .filter((g) => g.departmentPublicId === null)
      .map((g) => g.projectPublicId),
  );

  const toggleGroup = (group: Group) => {
    const key = groupKey(group);
    if (chosenGroups.has(key)) {
      onChange({
        ...value,
        groups: value.groups.filter((g) => groupKey(g) !== key),
      });
      return;
    }
    // A whole project already holds its departments.
    const others =
      group.departmentPublicId === null
        ? value.groups.filter(
            (g) => g.projectPublicId !== group.projectPublicId,
          )
        : value.groups;
    onChange({ ...value, groups: [...others, group] });
  };
  const toggleUser = (userId: string) =>
    onChange({
      ...value,
      userIds: chosenUsers.has(userId)
        ? value.userIds.filter((id) => id !== userId)
        : [...value.userIds, userId],
    });

  const chips = useChips(value, options.data, known);

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-light-300 p-3 dark:border-dark-300">
      <div>
        <p className="text-xs text-light-900 dark:text-dark-900">
          {chips.length === 0 ? text.noneChosen : text.chosen(chips.length)}
        </p>
        {chips.length > 0 && (
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <li
                key={chip.key}
                className="inline-flex items-center gap-1 rounded-full bg-light-200 py-0.5 pl-2.5 pr-1 text-xs dark:bg-dark-200"
              >
                {chip.label}
                <button
                  type="button"
                  aria-label={`${text.remove} ${chip.label}`}
                  className="rounded-full p-0.5 hover:bg-light-300 dark:hover:bg-dark-300"
                  onClick={() =>
                    chip.group ? toggleGroup(chip.group) : toggleUser(chip.key)
                  }
                >
                  <TbX size={12} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <input
        className={inputClass}
        aria-label={text.search}
        placeholder={text.search}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />

      <ErrorText message={options.error?.message} />
      {options.isLoading && (
        <p className="text-xs text-light-900 dark:text-dark-900">
          {text.loading}
        </p>
      )}
      {options.data &&
        (search.trim() ? (
          <SearchResults
            options={options.data}
            search={search.trim().toLowerCase()}
            chosen={chosenUsers}
            onToggle={toggleUser}
          />
        ) : (
          <div className="space-y-2">
            {options.data.projects.map((project) => (
              <ProjectBlock
                key={project.publicId}
                project={project}
                departments={options.data.departments}
                whole={wholeProjects.has(project.publicId)}
                chosenGroups={chosenGroups}
                chosenUsers={chosenUsers}
                onToggleGroup={toggleGroup}
                onToggleUser={toggleUser}
              />
            ))}
            <p className="text-xs text-light-900 dark:text-dark-900">
              {text.departmentsWhere}
            </p>
          </div>
        ))}
    </div>
  );
}

interface Chip {
  key: string;
  label: string;
  /** Set for a project or department; a person otherwise. */
  group?: Group;
}

/** What is chosen, named from the options, or from `known` when they lack it. */
function useChips(
  value: Selected,
  options: Options | undefined,
  known: ReaderList | null | undefined,
): Chip[] {
  return useMemo(() => {
    const projectName = new Map(
      options?.projects.map((p) => [p.publicId, p.name]),
    );
    const departmentName = new Map(
      options?.departments.map((d) => [d.publicId, d.name]),
    );
    const personName = new Map<string, string>();
    for (const project of options?.projects ?? []) {
      for (const member of project.members) {
        personName.set(member.userId, member.name);
      }
    }
    const knownGroup = new Map(
      known?.groups.map((g) => [groupKey(g), g.label]),
    );
    const knownUser = new Map(known?.users.map((u) => [u.userId, u.name]));

    return [
      ...value.groups.map((group) => {
        const project = projectName.get(group.projectPublicId);
        const department =
          group.departmentPublicId === null
            ? null
            : departmentName.get(group.departmentPublicId);
        const label =
          project && department !== undefined
            ? department === null
              ? project
              : `${project} · ${department}`
            : (knownGroup.get(groupKey(group)) ?? "…");
        return { key: groupKey(group), label, group };
      }),
      ...value.userIds.map((userId) => ({
        key: userId,
        label: personName.get(userId) ?? knownUser.get(userId) ?? "…",
      })),
    ];
  }, [value, options, known]);
}

function Check({
  checked,
  disabled,
  onChange,
  children,
  className,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label
      className={twMerge(
        "inline-flex cursor-pointer items-center gap-1.5",
        disabled && "cursor-default opacity-60",
        className,
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
      {children}
    </label>
  );
}

function ProjectBlock({
  project,
  departments,
  whole,
  chosenGroups,
  chosenUsers,
  onToggleGroup,
  onToggleUser,
}: {
  project: Options["projects"][number];
  departments: Options["departments"];
  whole: boolean;
  chosenGroups: Set<string>;
  chosenUsers: Set<string>;
  onToggleGroup: (group: Group) => void;
  onToggleUser: (userId: string) => void;
}) {
  const somethingChosen =
    whole ||
    project.departments.some((d) =>
      chosenGroups.has(
        groupKey({
          projectPublicId: project.publicId,
          departmentPublicId: d.publicId,
        }),
      ),
    ) ||
    project.members.some((m) => chosenUsers.has(m.userId));
  const [open, setOpen] = useState(somethingChosen);
  const countOf = new Map(
    project.departments.map((d) => [d.publicId, d.memberIds.length]),
  );

  return (
    <div className="rounded-md border border-light-200 dark:border-dark-200">
      <div className="flex items-center justify-between gap-2 px-2.5 py-2">
        <button
          type="button"
          className="flex min-w-0 items-center gap-1 text-left font-medium"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? (
            <TbChevronDown size={14} aria-hidden="true" />
          ) : (
            <TbChevronRight size={14} aria-hidden="true" />
          )}
          <span className="truncate">{project.name}</span>
          <span className="shrink-0 text-xs font-normal text-light-900 dark:text-dark-900">
            · {text.people(project.members.length)}
          </span>
        </button>
        <Check
          checked={whole}
          onChange={() =>
            onToggleGroup({
              projectPublicId: project.publicId,
              departmentPublicId: null,
            })
          }
          className="shrink-0 text-xs"
        >
          {text.wholeProject}
        </Check>
      </div>
      {open && (
        <div className="space-y-2.5 border-t border-light-200 px-2.5 py-2.5 dark:border-dark-200">
          <div>
            <p className="text-xs text-light-900 dark:text-dark-900">
              {text.departments}
              {whole && ` · ${text.inWholeProject}`}
            </p>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1.5">
              {departments.map((department) => {
                const group = {
                  projectPublicId: project.publicId,
                  departmentPublicId: department.publicId,
                };
                return (
                  <Check
                    key={department.publicId}
                    checked={whole || chosenGroups.has(groupKey(group))}
                    disabled={whole}
                    onChange={() => onToggleGroup(group)}
                  >
                    {department.name}
                    <span className="text-xs text-light-900 dark:text-dark-900">
                      {text.people(countOf.get(department.publicId) ?? 0)}
                    </span>
                  </Check>
                );
              })}
            </div>
          </div>
          <div>
            <p className="text-xs text-light-900 dark:text-dark-900">
              {text.members}
              {whole && ` · ${text.inWholeProject}`}
            </p>
            {project.members.length === 0 ? (
              <p className="mt-1 text-xs text-light-900 dark:text-dark-900">
                {text.noMembers}
              </p>
            ) : (
              <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-3">
                {project.members.map((member) => (
                  <Check
                    key={member.userId}
                    checked={whole || chosenUsers.has(member.userId)}
                    disabled={whole}
                    onChange={() => onToggleUser(member.userId)}
                    className="min-w-0"
                  >
                    <span className="truncate">{member.name}</span>
                  </Check>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Members of any project whose name matches, each listed once. */
function SearchResults({
  options,
  search,
  chosen,
  onToggle,
}: {
  options: Options;
  search: string;
  chosen: Set<string>;
  onToggle: (userId: string) => void;
}) {
  const people = new Map<string, { name: string; projects: string[] }>();
  for (const project of options.projects) {
    for (const member of project.members) {
      if (!member.name.toLowerCase().includes(search)) continue;
      const entry = people.get(member.userId) ?? {
        name: member.name,
        projects: [],
      };
      entry.projects.push(project.name);
      people.set(member.userId, entry);
    }
  }
  if (people.size === 0) {
    return (
      <p className="text-xs text-light-900 dark:text-dark-900">
        {text.noMatch}
      </p>
    );
  }
  return (
    <ul className="space-y-1.5">
      {[...people].map(([userId, person]) => (
        <li key={userId}>
          <Check checked={chosen.has(userId)} onChange={() => onToggle(userId)}>
            {person.name}
            <span className="text-xs text-light-900 dark:text-dark-900">
              {person.projects.join("、")}
            </span>
          </Check>
        </li>
      ))}
    </ul>
  );
}
