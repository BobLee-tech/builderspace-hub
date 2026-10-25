import { useState } from "react";
import { TbArrowDown, TbArrowUp } from "react-icons/tb";

import type { RouterOutputs } from "~/utils/api";
import { copy } from "~/hub/copy/zh";
import {
  buttonClass,
  Card,
  ErrorText,
  inputClass,
  PageHeader,
  tableClass,
} from "~/hub/ui/admin-primitives";
import { api } from "~/utils/api";
import { AdminLayout } from "./AdminLayout";

type Directory = RouterOutputs["hub"]["departments"]["directory"];

const text = copy.admin.departments;

/**
 * 部门: the club's departments (one list for every project) and, per project,
 * who is in which. Departments can be added and renamed, not deleted.
 */
function Departments() {
  const directory = api.hub.departments.directory.useQuery();
  const [search, setSearch] = useState("");

  if (directory.isLoading) {
    return (
      <p className="text-sm text-light-900 dark:text-dark-900">
        {copy.admin.loading}
      </p>
    );
  }
  if (!directory.data) {
    return <ErrorText message={directory.error?.message} />;
  }
  const data = directory.data;

  return (
    <div className="space-y-4">
      <DepartmentList data={data} />
      {!data.canManage && (
        <p className="text-sm text-light-900 dark:text-dark-900">
          {text.readOnly}
        </p>
      )}
      <input
        className={`${inputClass} max-w-xs`}
        aria-label={text.search}
        placeholder={text.search}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      {data.projects.map((project) => (
        <ProjectTable
          key={project.publicId}
          project={project}
          departments={data.departments}
          canManage={data.canManage}
          search={search.trim().toLowerCase()}
        />
      ))}
    </div>
  );
}

function DepartmentList({ data }: { data: Directory }) {
  const utils = api.useUtils();
  const refresh = () => utils.hub.departments.directory.invalidate();
  const [name, setName] = useState("");
  const create = api.hub.departments.create.useMutation({
    onSuccess: async () => {
      setName("");
      await refresh();
    },
  });
  const move = api.hub.departments.move.useMutation({ onSuccess: refresh });

  return (
    <Card title={text.listTitle} hint={text.listHint}>
      <ul className="mt-3 divide-y divide-light-200 dark:divide-dark-200">
        {data.departments.map((department, index) => (
          <li
            key={department.publicId}
            className="flex items-center justify-between gap-3 py-2 text-sm"
          >
            <DepartmentName
              department={department}
              canManage={data.canManage}
            />
            {data.canManage && (
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  className={buttonClass.ghost}
                  aria-label={`${text.up} ${department.name}`}
                  title={text.up}
                  disabled={index === 0 || move.isPending}
                  onClick={() =>
                    move.mutate({
                      departmentPublicId: department.publicId,
                      direction: "up",
                    })
                  }
                >
                  <TbArrowUp size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={buttonClass.ghost}
                  aria-label={`${text.down} ${department.name}`}
                  title={text.down}
                  disabled={
                    index === data.departments.length - 1 || move.isPending
                  }
                  onClick={() =>
                    move.mutate({
                      departmentPublicId: department.publicId,
                      direction: "down",
                    })
                  }
                >
                  <TbArrowDown size={14} aria-hidden="true" />
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {data.canManage && (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate({ name });
          }}
        >
          <input
            className={`${inputClass} max-w-xs`}
            aria-label={text.namePlaceholder}
            placeholder={text.namePlaceholder}
            maxLength={20}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button
            type="submit"
            className={buttonClass.primary}
            disabled={create.isPending || !name.trim()}
          >
            {text.create}
          </button>
        </form>
      )}
      <div className="mt-2">
        <ErrorText message={create.error?.message ?? move.error?.message} />
      </div>
    </Card>
  );
}

function DepartmentName({
  department,
  canManage,
}: {
  department: Directory["departments"][number];
  canManage: boolean;
}) {
  const utils = api.useUtils();
  const [editing, setEditing] = useState<string | null>(null);
  const rename = api.hub.departments.rename.useMutation({
    onSuccess: async () => {
      setEditing(null);
      await Promise.all([
        utils.hub.departments.directory.invalidate(),
        utils.hub.documents.audienceOptions.invalidate(),
      ]);
    },
  });

  if (editing !== null) {
    return (
      <form
        className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          rename.mutate({
            departmentPublicId: department.publicId,
            name: editing,
          });
        }}
      >
        <input
          className={`${inputClass} max-w-[12rem]`}
          aria-label={text.rename}
          maxLength={20}
          autoFocus
          value={editing}
          onChange={(event) => setEditing(event.target.value)}
        />
        <button
          type="submit"
          className={buttonClass.primary}
          disabled={rename.isPending || !editing.trim()}
        >
          {text.save}
        </button>
        <button
          type="button"
          className={buttonClass.ghost}
          onClick={() => setEditing(null)}
        >
          {text.cancel}
        </button>
        <ErrorText message={rename.error?.message} />
      </form>
    );
  }
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="truncate font-medium">{department.name}</span>
      <span className={tableClass.sub}>
        {text.count(department.memberCount)}
      </span>
      {canManage && (
        <button
          type="button"
          className="text-xs text-light-900 underline-offset-2 hover:underline dark:text-dark-900"
          onClick={() => setEditing(department.name)}
        >
          {text.rename}
        </button>
      )}
    </div>
  );
}

function ProjectTable({
  project,
  departments,
  canManage,
  search,
}: {
  project: Directory["projects"][number];
  departments: Directory["departments"];
  canManage: boolean;
  search: string;
}) {
  const utils = api.useUtils();
  const setMember = api.hub.departments.setMember.useMutation({
    onSuccess: () =>
      Promise.all([
        utils.hub.departments.directory.invalidate(),
        utils.hub.documents.audienceOptions.invalidate(),
      ]),
  });
  const members = search
    ? project.members.filter((m) =>
        `${m.name} ${m.email}`.toLowerCase().includes(search),
      )
    : project.members;

  return (
    <Card title={project.name} hint={text.projectHint}>
      {project.members.length === 0 ? (
        <p className="mt-2 text-sm text-light-900 dark:text-dark-900">
          {text.noMembers}
        </p>
      ) : members.length === 0 ? (
        <p className="mt-2 text-sm text-light-900 dark:text-dark-900">
          {text.noMatch}
        </p>
      ) : (
        <div className={`${tableClass.wrap} mt-3`}>
          <table className={tableClass.table}>
            <thead>
              <tr>
                <th className={tableClass.th}>{text.member}</th>
                {departments.map((d) => (
                  <th
                    key={d.publicId}
                    className={`${tableClass.th} text-center`}
                  >
                    {d.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-light-200 dark:divide-dark-200">
              {members.map((member) => (
                <tr key={member.userId}>
                  <td className={tableClass.td}>
                    <div>{member.name}</div>
                    <div className={tableClass.sub}>{member.email}</div>
                  </td>
                  {departments.map((d) => {
                    const inIt = member.departments.includes(d.publicId);
                    return (
                      <td
                        key={d.publicId}
                        className={`${tableClass.td} text-center`}
                      >
                        <input
                          type="checkbox"
                          aria-label={`${member.name} · ${d.name}`}
                          checked={inIt}
                          disabled={!canManage || setMember.isPending}
                          onChange={() =>
                            setMember.mutate({
                              departmentPublicId: d.publicId,
                              projectPublicId: project.publicId,
                              userId: member.userId,
                              member: !inIt,
                            })
                          }
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-2">
        <ErrorText message={setMember.error?.message} />
      </div>
    </Card>
  );
}

export function DepartmentsPage() {
  return (
    <AdminLayout title={text.title}>
      <PageHeader title={text.title} description={text.description} />
      <Departments />
    </AdminLayout>
  );
}
