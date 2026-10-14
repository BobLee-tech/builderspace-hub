import Link from "next/link";

import { copy } from "~/hub/copy/zh";
import { Card, PageHeader } from "~/hub/ui/admin-primitives";
import { api } from "~/utils/api";
import { AdminLayout } from "./AdminLayout";

const text = copy.admin.overview;

function Stat({
  label,
  value,
  href,
}: {
  label: string;
  value?: number;
  href: string;
}) {
  return (
    <Link href={href}>
      <Card className="transition-colors hover:border-light-600 dark:hover:border-dark-600">
        <p className="text-xs text-light-900 dark:text-dark-900">{label}</p>
        <p className="mt-2 text-3xl font-semibold tabular-nums">
          {value ?? "–"}
        </p>
      </Card>
    </Link>
  );
}

function OverviewContent() {
  const overview = api.hub.overview.useQuery();

  return (
    <>
      <PageHeader title={text.title} description={text.description} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label={text.accounts}
          value={overview.data?.accounts}
          href="/admin/accounts"
        />
        <Stat
          label={text.projects}
          value={overview.data?.projects}
          href="/boards"
        />
        <Stat
          label={text.openGrants}
          value={overview.data?.openGrants}
          href="/admin/grants"
        />
      </div>
    </>
  );
}

export function OverviewPage() {
  return (
    <AdminLayout title={text.title}>
      <OverviewContent />
    </AdminLayout>
  );
}
