import { useState } from "react";

import type { VolunteerStatus } from "@kan/hub/public";
import {
  VOLUNTEER_NOTES_MAX,
  volunteerStatuses,
  volunteerStatusLabels,
} from "@kan/hub/public";

import type { RouterOutputs } from "~/utils/api";
import { copy } from "~/hub/copy/zh";
import { AdminLayout } from "~/hub/features/admin/AdminLayout";
import { usePageParam } from "~/hub/features/admin/use-page-param";
import {
  buttonClass,
  Card,
  ErrorText,
  inputClass,
  PageHeader,
  Pagination,
  Pill,
} from "~/hub/ui/admin-primitives";
import { api } from "~/utils/api";
import {
  ExportButton,
  ExternalLink,
  Facts,
  formatTime,
  labelOf,
  Segmented,
  SiteGate,
  useFilterParam,
} from "./site-ui";

const text = copy.admin.site.volunteers;

type Volunteer = RouterOutputs["hub"]["site"]["volunteers"]["items"][number];

const ALL = "all";
const filters = [ALL, ...volunteerStatuses] as const;

function VolunteerCard({ volunteer }: { volunteer: Volunteer }) {
  const utils = api.useUtils();
  const [notes, setNotes] = useState(volunteer.opsNotes ?? "");
  const [saved, setSaved] = useState(false);
  const update = api.hub.site.updateVolunteer.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.hub.site.volunteers.invalidate(),
        utils.hub.site.summary.invalidate(),
      ]);
    },
  });
  const notesChanged = notes.trim() !== (volunteer.opsNotes ?? "");

  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{volunteer.nickname}</h2>
          <p className="mt-0.5 text-xs text-light-900 dark:text-dark-900">
            {copy.admin.site.submittedAt} {formatTime(volunteer.createdAt)}
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm">
          <span className="whitespace-nowrap text-light-900 dark:text-dark-900">
            {text.status}
          </span>
          <select
            className={`${inputClass} w-auto`}
            value={volunteer.status}
            disabled={update.isPending}
            onChange={(event) =>
              update.mutate({
                id: volunteer.id,
                status: event.target.value as VolunteerStatus,
              })
            }
          >
            {volunteerStatuses.map((status) => (
              <option key={status} value={status}>
                {volunteerStatusLabels[status]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-3">
          <Facts
            rows={[
              [text.contact, volunteer.contact],
              [text.school, volunteer.schoolDegree],
              [
                text.positions,
                <span key="positions" className="flex flex-wrap gap-1">
                  {volunteer.positions.map((position) => (
                    <Pill key={position}>{labelOf("positions", position)}</Pill>
                  ))}
                </span>,
              ],
              [text.hours, labelOf("hours", volunteer.weeklyHours)],
              [
                text.portfolio,
                volunteer.portfolioUrl && (
                  <ExternalLink href={volunteer.portfolioUrl}>
                    {volunteer.portfolioUrl}
                  </ExternalLink>
                ),
              ],
              [text.channel, volunteer.channel],
            ]}
          />
          <div>
            <p className="text-xs text-light-900 dark:text-dark-900">
              {text.about}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-6">
              {volunteer.about}
            </p>
          </div>
        </div>

        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setSaved(false);
            update.mutate(
              { id: volunteer.id, notes },
              { onSuccess: () => setSaved(true) },
            );
          }}
        >
          <label
            htmlFor={`notes-${volunteer.id}`}
            className="text-xs text-light-900 dark:text-dark-900"
          >
            {text.notes}
          </label>
          <textarea
            id={`notes-${volunteer.id}`}
            className={`${inputClass} min-h-24 resize-y`}
            maxLength={VOLUNTEER_NOTES_MAX}
            placeholder={text.notesPlaceholder}
            value={notes}
            onChange={(event) => {
              setNotes(event.target.value);
              setSaved(false);
            }}
          />
          <div className="flex items-center justify-end gap-2">
            {saved && !notesChanged && (
              <span className="text-xs text-light-900 dark:text-dark-900">
                {text.saved}
              </span>
            )}
            <button
              type="submit"
              className={buttonClass.ghost}
              disabled={!notesChanged || update.isPending}
            >
              {text.saveNotes}
            </button>
          </div>
          <ErrorText message={update.error?.message} />
        </form>
      </div>
    </Card>
  );
}

function SiteVolunteers() {
  const [filter, setFilter] = useFilterParam("status", filters, ALL);
  const [page, setPage] = usePageParam();
  const volunteers = api.hub.site.volunteers.useQuery({
    status: filter === ALL ? null : filter,
    page,
  });

  return (
    <>
      <PageHeader title={text.title} description={text.description}>
        <ExportButton
          request={{
            kind: "volunteers",
            status: filter === ALL ? null : filter,
          }}
        />
      </PageHeader>
      <div className="mb-4">
        <Segmented
          label={text.status}
          value={filter}
          onChange={setFilter}
          options={filters.map((value) => ({
            value,
            label: value === ALL ? text.all : volunteerStatusLabels[value],
          }))}
        />
      </div>
      <ErrorText message={volunteers.error?.message} />

      {volunteers.isLoading ? (
        <p className="text-sm text-light-900 dark:text-dark-900">
          {copy.admin.loading}
        </p>
      ) : (
        <div className="space-y-3">
          {volunteers.data?.items.map((volunteer) => (
            <VolunteerCard key={volunteer.id} volunteer={volunteer} />
          ))}
          {volunteers.data?.items.length === 0 && (
            <p className="rounded-xl border border-dashed border-light-400 px-4 py-8 text-center text-sm text-light-900 dark:border-dark-400 dark:text-dark-900">
              {text.empty}
            </p>
          )}
        </div>
      )}
      {volunteers.data && (
        <Pagination
          page={page}
          pageSize={volunteers.data.pageSize}
          total={volunteers.data.total}
          onChange={setPage}
        />
      )}
    </>
  );
}

export function SiteVolunteersPage() {
  return (
    <AdminLayout title={text.title} site="site.people">
      <SiteGate>
        <SiteVolunteers />
      </SiteGate>
    </AdminLayout>
  );
}
