import type { ReviewDecision, ReviewStatus } from "@kan/hub/public";
import { reviewStatuses, reviewStatusLabels } from "@kan/hub/public";

import type { RouterOutputs } from "~/utils/api";
import { copy } from "~/hub/copy/zh";
import { AdminLayout } from "~/hub/features/admin/AdminLayout";
import { usePageParam } from "~/hub/features/admin/use-page-param";
import {
  buttonClass,
  Card,
  ErrorText,
  PageHeader,
  Pagination,
  Pill,
} from "~/hub/ui/admin-primitives";
import { api } from "~/utils/api";
import {
  ExternalLink,
  Facts,
  formatTime,
  labelOf,
  labelsOf,
  Segmented,
  SiteGate,
  useFilterParam,
} from "./site-ui";

const text = copy.admin.site.projects;

type ProjectRow = RouterOutputs["hub"]["site"]["projects"]["items"][number];
type UpdateRow = RouterOutputs["hub"]["site"]["updates"]["items"][number];

const tabs = ["projects", "updates"] as const;

const duration = (seconds: number) => {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

/**
 * The buttons for a record in a given state: a pending one can go either way,
 * an approved one can be taken down, a rejected one approved after all.
 */
function Decisions({
  review,
  isPending,
  onDecide,
}: {
  review: ReviewStatus;
  isPending: boolean;
  onDecide: (decision: ReviewDecision) => void;
}) {
  return (
    <div className="flex gap-2">
      {review !== "approved" && (
        <button
          type="button"
          className={buttonClass.primary}
          disabled={isPending}
          onClick={() => onDecide("approved")}
        >
          {text.approve}
        </button>
      )}
      {review !== "rejected" && (
        <button
          type="button"
          className={
            review === "approved" ? buttonClass.dangerText : buttonClass.ghost
          }
          disabled={isPending}
          onClick={() => onDecide("rejected")}
        >
          {review === "approved" ? text.takeDown : text.reject}
        </button>
      )}
    </div>
  );
}

function ProjectCard({
  project,
  isPending,
  onDecide,
}: {
  project: ProjectRow;
  isPending: boolean;
  onDecide: (decision: ReviewDecision) => void;
}) {
  const f = text.fields;
  const media = [
    project.coverPath && text.cover,
    project.videoSeconds !== null && text.video(duration(project.videoSeconds)),
  ].filter(Boolean);

  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold">
            {project.name}
            <Pill>{labelOf("projectStatus", project.status)}</Pill>
          </h2>
          <p className="mt-0.5 text-xs text-light-900 dark:text-dark-900">
            {text.submittedAt} {formatTime(project.createdAt)}
          </p>
        </div>
        <Decisions
          review={project.reviewStatus}
          isPending={isPending}
          onDecide={onDecide}
        />
      </div>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-6">
        {project.problem}
      </p>
      <div className="mt-4">
        <Facts
          rows={[
            [f.owner, project.ownerName],
            [f.targetUser, project.targetUser],
            [f.needed, labelsOf("roles", project.neededRoles)],
            [f.nextStep, project.nextStep],
            [f.contact, project.contact],
            [
              f.links,
              (project.repoUrl ?? project.demoUrl) && (
                <span className="flex flex-col gap-0.5">
                  <ExternalLink href={project.repoUrl}>
                    {text.repo} · {project.repoUrl}
                  </ExternalLink>
                  <ExternalLink href={project.demoUrl}>
                    {text.demo} · {project.demoUrl}
                  </ExternalLink>
                </span>
              ),
            ],
            [
              f.media,
              media.length > 0 ? (
                <span>
                  {media.join(" · ")}
                  <span className="block text-xs text-light-900 dark:text-dark-900">
                    {text.mediaHint}
                  </span>
                </span>
              ) : (
                text.noMedia
              ),
            ],
          ]}
        />
      </div>
    </Card>
  );
}

function UpdateCard({
  update,
  isPending,
  onDecide,
}: {
  update: UpdateRow;
  isPending: boolean;
  onDecide: (decision: ReviewDecision) => void;
}) {
  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold">
            {text.updateOf(update.projectName ?? text.unknownProject)}
            <Pill>{labelOf("updateKinds", update.kind)}</Pill>
          </h2>
          <p className="mt-0.5 text-xs text-light-900 dark:text-dark-900">
            {text.submittedAt} {formatTime(update.createdAt)}
          </p>
        </div>
        <Decisions
          review={update.reviewStatus}
          isPending={isPending}
          onDecide={onDecide}
        />
      </div>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-6">
        {update.body}
      </p>
      {update.url && (
        <p className="mt-2 text-sm">
          <ExternalLink href={update.url}>{update.url}</ExternalLink>
        </p>
      )}
    </Card>
  );
}

function Empty() {
  return (
    <p className="rounded-xl border border-dashed border-light-400 px-4 py-8 text-center text-sm text-light-900 dark:border-dark-400 dark:text-dark-900">
      {text.empty}
    </p>
  );
}

function SiteProjects() {
  const utils = api.useUtils();
  const [tab, setTab] = useFilterParam("tab", tabs, "projects");
  const [review, setReview] = useFilterParam(
    "review",
    reviewStatuses,
    "pending",
  );
  const [page, setPage] = usePageParam();

  const projects = api.hub.site.projects.useQuery(
    { review, page },
    { enabled: tab === "projects" },
  );
  const updates = api.hub.site.updates.useQuery(
    { review, page },
    { enabled: tab === "updates" },
  );
  const refresh = () =>
    Promise.all([
      utils.hub.site.projects.invalidate(),
      utils.hub.site.updates.invalidate(),
      utils.hub.site.summary.invalidate(),
    ]);
  const reviewProject = api.hub.site.reviewProject.useMutation({
    onSuccess: refresh,
  });
  const reviewUpdate = api.hub.site.reviewUpdate.useMutation({
    onSuccess: refresh,
  });

  const list = tab === "projects" ? projects : updates;

  return (
    <>
      <PageHeader title={text.title} description={text.description} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          label={text.title}
          value={tab}
          onChange={setTab}
          options={tabs.map((value) => ({ value, label: text.tabs[value] }))}
        />
        <Segmented
          label={copy.admin.site.volunteers.status}
          value={review}
          onChange={setReview}
          options={reviewStatuses.map((value) => ({
            value,
            label: reviewStatusLabels[value],
          }))}
        />
      </div>
      <div className="mb-4">
        <ErrorText
          message={
            list.error?.message ??
            reviewProject.error?.message ??
            reviewUpdate.error?.message
          }
        />
      </div>

      {list.isLoading ? (
        <p className="text-sm text-light-900 dark:text-dark-900">
          {copy.admin.loading}
        </p>
      ) : (
        <div className="space-y-3">
          {tab === "projects"
            ? projects.data?.items.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  isPending={reviewProject.isPending}
                  onDecide={(decision) =>
                    reviewProject.mutate({ id: project.id, decision })
                  }
                />
              ))
            : updates.data?.items.map((update) => (
                <UpdateCard
                  key={update.id}
                  update={update}
                  isPending={reviewUpdate.isPending}
                  onDecide={(decision) =>
                    reviewUpdate.mutate({ id: update.id, decision })
                  }
                />
              ))}
          {list.data?.items.length === 0 && <Empty />}
        </div>
      )}
      {list.data && (
        <Pagination
          page={page}
          pageSize={list.data.pageSize}
          total={list.data.total}
          onChange={setPage}
        />
      )}
    </>
  );
}

export function SiteProjectsPage() {
  return (
    <AdminLayout title={text.title} site="site.review">
      <SiteGate>
        <SiteProjects />
      </SiteGate>
    </AdminLayout>
  );
}
