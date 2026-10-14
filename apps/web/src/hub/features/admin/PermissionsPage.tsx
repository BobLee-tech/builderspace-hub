import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useRef } from "react";
import { TbCheck } from "react-icons/tb";
import { twMerge } from "tailwind-merge";

import type { EditableProjectRole } from "@kan/hub/public";
import {
  can,
  editableProjectRoles,
  permissionGroupLabels,
  permissionGroups,
  permissionLabels,
  projectRoleLabels,
} from "@kan/hub/public";

import type { RouterOutputs } from "~/utils/api";
import { copy } from "~/hub/copy/zh";
import {
  Card,
  ErrorText,
  PageHeader,
  tableClass,
} from "~/hub/ui/admin-primitives";
import { api } from "~/utils/api";
import { AdminLayout } from "./AdminLayout";

type Matrix = RouterOutputs["hub"]["permissions"]["get"];
type Permission = (typeof permissionGroups)[number]["permissions"][number];

const text = copy.admin.permissions;

/** How many of the projects in view give `role` this permission. */
function coverage(
  projects: Matrix["projects"],
  role: EditableProjectRole,
  permission: Permission,
): "all" | "none" | "some" {
  const granted = projects.filter((p) =>
    p.roles[role].includes(permission),
  ).length;
  if (granted === 0) return "none";
  return granted === projects.length ? "all" : "some";
}

function Toggle({
  state,
  disabled,
  label,
  onChange,
}: {
  state: "all" | "none" | "some";
  disabled: boolean;
  label: string;
  onChange: (granted: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "some";
  }, [state]);

  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      title={state === "some" ? text.mixed : undefined}
      className="h-4 w-4 cursor-pointer rounded border-light-600 text-light-1000 focus:ring-light-1000 disabled:cursor-not-allowed disabled:opacity-50 dark:border-dark-600 dark:bg-dark-200"
      checked={state === "all"}
      disabled={disabled}
      // Mixed or off → turn on everywhere; on → turn off.
      onChange={() => onChange(state !== "all")}
    />
  );
}

function PermissionsContent() {
  const router = useRouter();
  const scopeId =
    typeof router.query.project === "string" ? router.query.project : null;
  const me = api.hub.me.get.useQuery();
  const matrix = api.hub.permissions.get.useQuery();
  const utils = api.useUtils();
  const set = api.hub.permissions.set.useMutation({
    onSettled: () => utils.hub.permissions.get.invalidate(),
  });
  const mayEdit = can(me.data?.role ?? null, "permissions.manage");

  const all = matrix.data?.projects ?? [];
  const inView = scopeId
    ? all.filter((p) => p.project.publicId === scopeId)
    : all;

  const scopes = [
    { publicId: null, name: text.allProjects },
    ...all.map((p) => ({ publicId: p.project.publicId, name: p.project.name })),
  ];

  return (
    <>
      <PageHeader title={text.title} description={text.description} />

      <nav className="mb-4 flex flex-wrap gap-1" aria-label={text.title}>
        {scopes.map((scope) => {
          const selected = scope.publicId === scopeId;
          return (
            <Link
              key={scope.publicId ?? "all"}
              href={
                scope.publicId
                  ? `/admin/permissions?project=${encodeURIComponent(scope.publicId)}`
                  : "/admin/permissions"
              }
              title={scope.publicId ? undefined : text.allProjectsHint}
              className={twMerge(
                "rounded-full border px-3 py-1 text-sm font-medium transition-colors",
                selected
                  ? "border-light-1000 bg-light-1000 text-light-50 dark:border-dark-1000 dark:bg-dark-1000 dark:text-dark-50"
                  : "border-light-300 text-light-1000 hover:border-light-600 dark:border-dark-300 dark:text-dark-1000",
              )}
            >
              {scope.name}
            </Link>
          );
        })}
      </nav>

      {!mayEdit && me.data && (
        <p className="mb-3 text-xs text-light-900 dark:text-dark-900">
          {text.readOnly}
        </p>
      )}
      <ErrorText message={set.error?.message} />

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className={tableClass.wrap}>
          <table className={tableClass.table}>
            <thead>
              <tr>
                <th className={tableClass.th}>{text.permission}</th>
                <th className={`${tableClass.th} w-20 text-center`}>
                  {projectRoleLabels.admin}
                </th>
                {editableProjectRoles.map((role) => (
                  <th
                    key={role}
                    className={`${tableClass.th} w-20 text-center`}
                  >
                    {projectRoleLabels[role]}
                  </th>
                ))}
              </tr>
            </thead>
            {inView.length > 0 &&
              permissionGroups.map((group) => (
                <tbody
                  key={group.key}
                  className="divide-y divide-light-200 dark:divide-dark-200"
                >
                  <tr className="bg-light-100 dark:bg-dark-100">
                    <th
                      colSpan={2 + editableProjectRoles.length}
                      className="px-4 py-1.5 text-left text-xs font-semibold text-light-900 dark:text-dark-900"
                    >
                      {permissionGroupLabels[group.key]}
                    </th>
                  </tr>
                  {group.permissions.map((permission) => (
                    <tr key={permission}>
                      <td className={tableClass.td}>
                        {permissionLabels[permission]}
                      </td>
                      <td className={`${tableClass.td} text-center`}>
                        <TbCheck
                          className="inline h-4 w-4 text-light-800 dark:text-dark-800"
                          aria-label={projectRoleLabels.admin}
                        />
                      </td>
                      {editableProjectRoles.map((role) => (
                        <td
                          key={role}
                          className={`${tableClass.td} text-center`}
                        >
                          <Toggle
                            state={coverage(inView, role, permission)}
                            disabled={!mayEdit || set.isPending}
                            label={`${projectRoleLabels[role]} · ${permissionLabels[permission]}`}
                            onChange={(granted) =>
                              set.mutate({
                                projectPublicId: scopeId,
                                role,
                                permission,
                                granted,
                              })
                            }
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              ))}
          </table>
        </div>

        <div className="space-y-4">
          <Card title={text.fixedTitle} hint={text.fixedHint}>
            <ul className="list-disc space-y-1 pl-4 text-sm text-light-1000 dark:text-dark-1000">
              {text.fixed.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
          </Card>
          <p className="text-xs leading-5 text-light-900 dark:text-dark-900">
            {text.homeHint}
          </p>
        </div>
      </div>
    </>
  );
}

export function PermissionsPage() {
  return (
    <AdminLayout title={text.title}>
      <PermissionsContent />
    </AdminLayout>
  );
}
