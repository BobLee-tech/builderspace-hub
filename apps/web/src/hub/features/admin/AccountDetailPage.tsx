import Link from "next/link";
import { useRouter } from "next/router";
import { format } from "date-fns";
import { useState } from "react";

import type { HubRole, SiteAccess } from "@kan/hub/public";
import { can, roleLabels, siteAccessLabels } from "@kan/hub/public";

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
  Pill,
} from "~/hub/ui/admin-primitives";
import { api } from "~/utils/api";
import { AdminLayout } from "./AdminLayout";
import { ProjectRolePicker } from "./ProjectRolePicker";

const text = copy.admin.account;

function AccountDetail({ userId }: { userId: string }) {
  const utils = api.useUtils();
  const me = api.hub.me.get.useQuery();
  const account = api.hub.accounts.get.useQuery({ userId });
  const projects = api.hub.projects.useQuery();

  const refresh = () =>
    Promise.all([
      utils.hub.accounts.get.invalidate({ userId }),
      utils.hub.accounts.list.invalidate(),
    ]);

  const rename = api.hub.accounts.rename.useMutation({ onSuccess: refresh });
  const setRole = api.hub.accounts.setRole.useMutation({ onSuccess: refresh });
  const setSiteAccess = api.hub.accounts.setSiteAccess.useMutation({
    onSuccess: async () => {
      await refresh();
      // Granting it to oneself opens the 官网 section right away.
      await utils.hub.me.get.invalidate();
    },
  });
  const setProjectRole = api.hub.accounts.setProjectRole.useMutation({
    onSuccess: refresh,
  });
  const resetPassword = api.hub.accounts.resetPassword.useMutation();
  const suspend = api.hub.accounts.suspend.useMutation({ onSuccess: refresh });
  const restore = api.hub.accounts.restore.useMutation({ onSuccess: refresh });

  const [name, setName] = useState<string | null>(null);

  if (account.isLoading) {
    return (
      <p className="text-sm text-light-900 dark:text-dark-900">
        {copy.admin.loading}
      </p>
    );
  }
  if (!account.data) {
    return <p className="text-sm">{text.notFound}</p>;
  }

  const data = account.data;
  const myRole = me.data?.role ?? null;
  const isSelf = me.data?.userId === data.userId;
  const canManage = can(myRole, "accounts.manage");
  const roleValue: Record<string, ProjectRole | null> = Object.fromEntries(
    data.projects.map((project) => [project.projectPublicId, project.role]),
  );
  const mutationError =
    rename.error ??
    setRole.error ??
    setSiteAccess.error ??
    setProjectRole.error ??
    resetPassword.error ??
    suspend.error ??
    restore.error;

  return (
    <>
      <PageHeader
        title={data.name ?? data.email}
        description={text.description}
      >
        <Link href="/admin/accounts" className={buttonClass.ghost}>
          {text.back}
        </Link>
      </PageHeader>

      <div className="mb-4">
        <ErrorText message={mutationError?.message} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <dl className="grid grid-cols-[6rem_1fr] gap-y-2 text-sm">
            <dt className="text-light-900 dark:text-dark-900">
              {text.facts.email}
            </dt>
            <dd>{data.email}</dd>
            <dt className="text-light-900 dark:text-dark-900">
              {text.facts.role}
            </dt>
            <dd>
              {data.role ? (
                <Pill tone="strong">{roleLabels[data.role]}</Pill>
              ) : (
                copy.admin.roles.none
              )}
            </dd>
            <dt className="text-light-900 dark:text-dark-900">
              {text.facts.status}
            </dt>
            <dd>
              <Pill tone={data.status === "suspended" ? "alert" : "neutral"}>
                {copy.admin.statuses[data.status]}
              </Pill>
            </dd>
            <dt className="text-light-900 dark:text-dark-900">
              {text.facts.createdAt}
            </dt>
            <dd>{format(data.createdAt, "yyyy-MM-dd HH:mm")}</dd>
          </dl>
          {canManage && (
            <form
              className="mt-4 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                rename.mutate({ userId, name: name ?? data.name ?? "" });
              }}
            >
              <input
                className={inputClass}
                aria-label={text.rename}
                maxLength={64}
                value={name ?? data.name ?? ""}
                onChange={(event) => setName(event.target.value)}
              />
              <button
                type="submit"
                className={buttonClass.ghost}
                disabled={rename.isPending}
              >
                {text.save}
              </button>
            </form>
          )}
        </Card>

        <Card title={text.roleHeading} hint={text.roleHint}>
          <select
            className={inputClass}
            value={data.role ?? ""}
            disabled={
              !can(myRole, "admins.manage") || isSelf || setRole.isPending
            }
            onChange={(event) =>
              setRole.mutate({
                userId,
                role: (event.target.value || null) as HubRole | null,
              })
            }
          >
            <option value="">{copy.admin.roles.none}</option>
            <option value="viewer">{roleLabels.viewer}</option>
            <option value="admin">{roleLabels.admin}</option>
            <option value="owner">{roleLabels.owner}</option>
          </select>
        </Card>

        <Card title={text.siteHeading} hint={text.siteHint}>
          <select
            className={inputClass}
            value={data.siteAccess ?? ""}
            disabled={!can(myRole, "admins.manage") || setSiteAccess.isPending}
            onChange={(event) =>
              setSiteAccess.mutate({
                userId,
                access: (event.target.value || null) as SiteAccess | null,
              })
            }
          >
            <option value="">{text.siteNone}</option>
            <option value="people">{siteAccessLabels.people}</option>
            <option value="manage">{siteAccessLabels.manage}</option>
          </select>
        </Card>

        <Card title={text.projectsHeading} hint={text.projectsHint}>
          <ProjectRolePicker
            projects={projects.data ?? []}
            value={roleValue}
            disabled={!canManage || setProjectRole.isPending}
            onChange={(projectPublicId, role) =>
              setProjectRole.mutate({ userId, projectPublicId, role })
            }
          />
        </Card>

        {canManage && !isSelf && (
          <Card title={text.passwordHeading} hint={text.passwordHint}>
            {resetPassword.data ? (
              <OneTimeSecret
                label={text.passwordDone}
                value={resetPassword.data.temporaryPassword}
              />
            ) : (
              <ConfirmButton
                label={text.passwordAction}
                isPending={resetPassword.isPending}
                onConfirm={() => resetPassword.mutate({ userId })}
              />
            )}
          </Card>
        )}

        {canManage && !isSelf && (
          <Card
            title={text.dangerHeading}
            hint={
              data.status === "suspended" ? text.restoreHint : text.suspendHint
            }
            danger
          >
            {data.status === "suspended" ? (
              <button
                type="button"
                className={buttonClass.primary}
                disabled={restore.isPending}
                onClick={() => restore.mutate({ userId })}
              >
                {text.restore}
              </button>
            ) : (
              <ConfirmButton
                label={text.suspend}
                isPending={suspend.isPending}
                onConfirm={() => suspend.mutate({ userId })}
              />
            )}
          </Card>
        )}
      </div>
    </>
  );
}

export function AccountDetailPage() {
  const { query, isReady } = useRouter();
  const userId = typeof query.userId === "string" ? query.userId : null;

  return (
    <AdminLayout title={copy.admin.accounts.title}>
      {isReady && userId ? <AccountDetail userId={userId} /> : null}
    </AdminLayout>
  );
}
