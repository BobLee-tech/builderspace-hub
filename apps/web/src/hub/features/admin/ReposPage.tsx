import { useState } from "react";
import { TbBrandGithub } from "react-icons/tb";

import { can } from "@kan/hub/public";

import type { RouterOutputs } from "~/utils/api";
import { copy } from "~/hub/copy/zh";
import {
  buttonClass,
  Card,
  ConfirmButton,
  ErrorText,
  inputClass,
  PageHeader,
} from "~/hub/ui/admin-primitives";
import { api } from "~/utils/api";
import { AdminLayout } from "./AdminLayout";

type ProjectRepos = RouterOutputs["hub"]["repos"]["list"][number];

const text = copy.admin.repos;

function ProjectCard({
  entry,
  mayEdit,
}: {
  entry: ProjectRepos;
  mayEdit: boolean;
}) {
  const utils = api.useUtils();
  const refresh = () => utils.hub.repos.list.invalidate();
  const add = api.hub.repos.add.useMutation({ onSuccess: refresh });
  const remove = api.hub.repos.remove.useMutation({ onSuccess: refresh });
  const [repo, setRepo] = useState("");

  return (
    <Card title={entry.project.name}>
      {entry.repos.length === 0 ? (
        <p className="text-sm text-light-900 dark:text-dark-900">{text.none}</p>
      ) : (
        <ul className="divide-y divide-light-200 dark:divide-dark-200">
          {entry.repos.map((linked) => (
            <li key={linked.publicId} className="flex items-center gap-3 py-2">
              <TbBrandGithub
                className="h-4 w-4 shrink-0 text-light-900 dark:text-dark-900"
                aria-hidden="true"
              />
              <a
                href={linked.url}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 truncate font-mono text-sm text-light-1000 underline-offset-2 hover:underline dark:text-dark-1000"
              >
                {linked.fullName}
              </a>
              {mayEdit && (
                <ConfirmButton
                  label={text.remove}
                  isPending={remove.isPending}
                  onConfirm={() =>
                    remove.mutate({ repoPublicId: linked.publicId })
                  }
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {mayEdit && (
        <form
          className="mt-4 flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            add.mutate(
              { projectPublicId: entry.project.publicId, repo },
              { onSuccess: () => setRepo("") },
            );
          }}
        >
          <input
            className={inputClass}
            value={repo}
            onChange={(event) => setRepo(event.target.value)}
            placeholder={text.placeholder}
            aria-label={`${entry.project.name}：${text.add}`}
          />
          <button
            type="submit"
            className={buttonClass.primary}
            disabled={add.isPending || repo.trim() === ""}
          >
            {text.add}
          </button>
        </form>
      )}
      <div className="mt-2">
        <ErrorText message={add.error?.message ?? remove.error?.message} />
      </div>
    </Card>
  );
}

function ReposContent() {
  const me = api.hub.me.get.useQuery();
  const projects = api.hub.repos.list.useQuery();
  const mayEdit = can(me.data?.role ?? null, "settings.manage");

  return (
    <>
      <PageHeader title={text.title} description={text.description} />
      <ErrorText message={projects.error?.message} />
      <div className="space-y-4">
        {projects.data?.map((entry) => (
          <ProjectCard
            key={entry.project.publicId}
            entry={entry}
            mayEdit={mayEdit}
          />
        ))}
      </div>
      {!mayEdit && me.data && (
        <p className="mt-4 text-xs text-light-900 dark:text-dark-900">
          {text.readOnly}
        </p>
      )}
    </>
  );
}

/** Back office → 项目仓库: which GitHub repositories each project is made of. */
export function ReposPage() {
  return (
    <AdminLayout title={text.title}>
      <ReposContent />
    </AdminLayout>
  );
}
