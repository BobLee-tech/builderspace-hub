import { format } from "date-fns";
import { useState } from "react";

import type { HubRole } from "@kan/hub/public";
import { buildJoinLink, can, roleLabels } from "@kan/hub/public";

import type { ProjectRole } from "./ProjectRolePicker";
import { copy } from "~/hub/copy/zh";
import {
  buttonClass,
  Card,
  ConfirmButton,
  ErrorText,
  inputClass,
  OneTimeSecret,
  PageHeader,
  Pagination,
  Pill,
  tableClass,
} from "~/hub/ui/admin-primitives";
import { api } from "~/utils/api";
import { AdminLayout } from "./AdminLayout";
import { ProjectRolePicker } from "./ProjectRolePicker";
import { usePageParam } from "./use-page-param";

const text = copy.admin.grants;

function IssueGrantForm({ myRole }: { myRole: HubRole | null }) {
  const utils = api.useUtils();
  const projects = api.hub.projects.useQuery();
  const issue = api.hub.grants.issue.useMutation({
    onSuccess: () => utils.hub.grants.list.invalidate(),
  });

  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [hubRole, setHubRole] = useState<HubRole | "">("");
  const [roles, setRoles] = useState<Record<string, ProjectRole | null>>({});

  if (issue.data) {
    return (
      <Card title={text.issue}>
        <div className="space-y-3">
          <p className="text-sm">{issue.data.email}</p>
          <OneTimeSecret
            label={text.issued}
            value={buildJoinLink(window.location.origin, issue.data.token)}
          />
          <button
            type="button"
            className={buttonClass.ghost}
            onClick={() => {
              issue.reset();
              setEmail("");
              setNote("");
              setHubRole("");
              setRoles({});
            }}
          >
            {text.issue}
          </button>
        </div>
      </Card>
    );
  }

  return (
    <Card title={text.issue}>
      <form
        className="grid gap-4 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          issue.mutate({
            email,
            hubRole: hubRole || null,
            note: note.trim() || null,
            projects: Object.entries(roles).flatMap(
              ([projectPublicId, role]) =>
                role ? [{ projectPublicId, role }] : [],
            ),
          });
        }}
      >
        <div className="space-y-3">
          <label className="block text-sm">
            {text.email}
            <input
              className={`${inputClass} mt-1`}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            {text.note}
            <input
              className={`${inputClass} mt-1`}
              maxLength={280}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          {can(myRole, "admins.manage") && (
            <label className="block text-sm">
              {text.hubRole}
              <select
                className={`${inputClass} mt-1`}
                value={hubRole}
                onChange={(e) => setHubRole(e.target.value as HubRole | "")}
              >
                <option value="">{copy.admin.roles.none}</option>
                <option value="viewer">{roleLabels.viewer}</option>
                <option value="admin">{roleLabels.admin}</option>
                <option value="owner">{roleLabels.owner}</option>
              </select>
            </label>
          )}
        </div>
        <div>
          <p className="mb-2 text-sm">{text.projects}</p>
          <ProjectRolePicker
            projects={projects.data ?? []}
            value={roles}
            onChange={(id, role) =>
              setRoles((current) => ({ ...current, [id]: role }))
            }
          />
        </div>
        <div className="space-y-2 md:col-span-2">
          <ErrorText message={issue.error?.message} />
          <button
            type="submit"
            className={buttonClass.primary}
            disabled={issue.isPending}
          >
            {text.submit}
          </button>
        </div>
      </form>
    </Card>
  );
}

function GrantsContent() {
  const [page, setPage] = usePageParam();
  const [showForm, setShowForm] = useState(false);
  const utils = api.useUtils();
  const me = api.hub.me.get.useQuery();
  const grants = api.hub.grants.list.useQuery({ page });
  const revoke = api.hub.grants.revoke.useMutation({
    onSuccess: () => utils.hub.grants.list.invalidate(),
  });
  const canIssue = can(me.data?.role ?? null, "access.manage");

  return (
    <>
      <PageHeader title={text.title} description={text.description}>
        {canIssue && (
          <button
            type="button"
            className={buttonClass.primary}
            onClick={() => setShowForm((v) => !v)}
          >
            {text.issue}
          </button>
        )}
      </PageHeader>

      {showForm && canIssue && (
        <div className="mb-6">
          <IssueGrantForm myRole={me.data?.role ?? null} />
        </div>
      )}

      <ErrorText message={revoke.error?.message} />
      <div className={tableClass.wrap}>
        <table className={tableClass.table}>
          <thead>
            <tr>
              <th className={tableClass.th}>{text.columns.email}</th>
              <th className={tableClass.th}>{text.columns.projects}</th>
              <th className={tableClass.th}>{text.columns.state}</th>
              <th className={tableClass.th}>{text.columns.createdAt}</th>
              <th className={tableClass.th}>{text.columns.expiresAt}</th>
              <th className={tableClass.th} />
            </tr>
          </thead>
          <tbody className="divide-y divide-light-300 dark:divide-dark-300">
            {grants.data?.items.map((grant) => (
              <tr key={grant.publicId}>
                <td className={tableClass.td}>
                  {grant.email}
                  <div className={tableClass.sub}>
                    {grant.hubRole ? `${roleLabels[grant.hubRole]} · ` : ""}
                    {grant.note ?? ""}
                  </div>
                </td>
                <td className={tableClass.td}>
                  <div className="flex flex-wrap gap-1">
                    {grant.projects.map((project) => (
                      <Pill key={project.projectName}>
                        {project.projectName} ·{" "}
                        {copy.admin.projectRoles[project.role]}
                      </Pill>
                    ))}
                  </div>
                </td>
                <td className={tableClass.td}>
                  <Pill tone={grant.state === "pending" ? "strong" : "neutral"}>
                    {copy.admin.grantStates[grant.state]}
                  </Pill>
                </td>
                <td className={`${tableClass.td} ${tableClass.sub}`}>
                  {format(grant.createdAt, "yyyy-MM-dd HH:mm")}
                </td>
                <td className={`${tableClass.td} ${tableClass.sub}`}>
                  {format(grant.expiresAt, "yyyy-MM-dd HH:mm")}
                </td>
                <td className={tableClass.td}>
                  {canIssue && grant.state === "pending" && (
                    <ConfirmButton
                      label={text.revoke}
                      isPending={revoke.isPending}
                      onConfirm={() =>
                        revoke.mutate({ grantPublicId: grant.publicId })
                      }
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {grants.data?.items.length === 0 && (
          <p className="px-4 py-6 text-sm text-light-900 dark:text-dark-900">
            {text.empty}
          </p>
        )}
      </div>
      {grants.data && (
        <Pagination
          page={page}
          pageSize={grants.data.pageSize}
          total={grants.data.total}
          onChange={setPage}
        />
      )}
    </>
  );
}

export function GrantsPage() {
  return (
    <AdminLayout title={text.title}>
      <GrantsContent />
    </AdminLayout>
  );
}
