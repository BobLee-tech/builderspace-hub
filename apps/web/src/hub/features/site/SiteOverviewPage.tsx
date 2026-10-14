import Link from "next/link";

import { copy } from "~/hub/copy/zh";
import { AdminLayout } from "~/hub/features/admin/AdminLayout";
import { Card, ErrorText, PageHeader } from "~/hub/ui/admin-primitives";
import { api } from "~/utils/api";
import { SiteGate } from "./site-ui";

const text = copy.admin.site.overview;

function Stat({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value?: number;
  hint?: string;
  href: string;
}) {
  return (
    <Link href={href}>
      <Card className="h-full transition-colors hover:border-light-600 dark:hover:border-dark-600">
        <p className="text-xs text-light-900 dark:text-dark-900">{label}</p>
        <p className="mt-2 text-3xl font-semibold tabular-nums">
          {value ?? "–"}
        </p>
        {hint && (
          <p className="mt-1 text-xs text-light-900 dark:text-dark-900">
            {hint}
          </p>
        )}
      </Card>
    </Link>
  );
}

function SiteOverview() {
  const summary = api.hub.site.summary.useQuery();
  const data = summary.data;

  return (
    <>
      <PageHeader title={text.title} description={text.description} />
      <ErrorText message={summary.error?.message} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data?.reviews && (
          <>
            <Stat
              label={text.pendingProjects}
              value={data.reviews.pendingProjects}
              href="/admin/site/projects"
            />
            <Stat
              label={text.pendingUpdates}
              value={data.reviews.pendingUpdates}
              href="/admin/site/projects?tab=updates"
            />
          </>
        )}
        <Stat
          label={text.newVolunteers}
          value={data?.people.newVolunteers}
          hint={data && text.volunteersTotal(data.people.volunteers)}
          href="/admin/site/volunteers?status=new"
        />
        <Stat
          label={text.joins}
          value={data?.people.joins}
          hint={
            data && text.recentJoins(data.people.recentJoins, data.recentDays)
          }
          href="/admin/site/joins"
        />
        <Stat
          label={text.supporters}
          value={data?.people.supporters}
          href="/admin/site/joins?supporters=1"
        />
      </div>
    </>
  );
}

export function SiteOverviewPage() {
  return (
    <AdminLayout title={text.title} site="site.people">
      <SiteGate>
        <SiteOverview />
      </SiteGate>
    </AdminLayout>
  );
}
