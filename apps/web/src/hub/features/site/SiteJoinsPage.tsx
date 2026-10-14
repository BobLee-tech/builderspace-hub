import { copy } from "~/hub/copy/zh";
import { AdminLayout } from "~/hub/features/admin/AdminLayout";
import { usePageParam } from "~/hub/features/admin/use-page-param";
import {
  ErrorText,
  PageHeader,
  Pagination,
  tableClass,
} from "~/hub/ui/admin-primitives";
import { api } from "~/utils/api";
import {
  ExportButton,
  formatTime,
  labelOf,
  labelsOf,
  SiteGate,
  useFilterParam,
} from "./site-ui";

const text = copy.admin.site.joins;
const columns = text.columns;

const supporterFilter = ["0", "1"] as const;

function SiteJoins() {
  const [supporters, setSupporters] = useFilterParam(
    "supporters",
    supporterFilter,
    "0",
  );
  const [page, setPage] = usePageParam();
  const joins = api.hub.site.joins.useQuery({
    supportersOnly: supporters === "1",
    page,
  });

  return (
    <>
      <PageHeader title={text.title} description={text.description}>
        <ExportButton
          request={{ kind: "joins", supportersOnly: supporters === "1" }}
        />
      </PageHeader>
      <label className="mb-4 inline-flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={supporters === "1"}
          onChange={(event) => setSupporters(event.target.checked ? "1" : "0")}
        />
        {text.supportersOnly}
      </label>
      <ErrorText message={joins.error?.message} />

      <div className={tableClass.wrap}>
        <table className={tableClass.table}>
          <thead>
            <tr>
              {[
                columns.name,
                columns.school,
                columns.skills,
                columns.hours,
                columns.interest,
                columns.availability,
                columns.source,
                columns.supporter,
                columns.createdAt,
              ].map((label) => (
                <th key={label} className={tableClass.th}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-light-300 dark:divide-dark-300">
            {joins.data?.items.map((join) => (
              <tr key={join.id}>
                <td className={tableClass.td}>
                  {join.nickname}
                  {join.idea && (
                    <div className={`${tableClass.sub} max-w-xs`}>
                      {join.idea}
                    </div>
                  )}
                </td>
                <td className={tableClass.td}>
                  {join.schoolDegree}
                  <div className={tableClass.sub}>{join.major}</div>
                </td>
                <td className={tableClass.td}>
                  {labelsOf("skills", join.skills)}
                </td>
                <td className={`${tableClass.td} whitespace-nowrap`}>
                  {labelOf("hours", join.weeklyHours)}
                </td>
                <td className={`${tableClass.td} whitespace-nowrap`}>
                  {labelOf("interest", join.nextEventInterest)}
                </td>
                <td className={tableClass.td}>
                  {labelsOf("availability", join.availability) || "–"}
                </td>
                <td className={tableClass.td}>
                  {labelOf("referral", join.referralSource)}
                  {join.channel && (
                    <div className={tableClass.sub}>{join.channel}</div>
                  )}
                </td>
                <td className={tableClass.td}>
                  {join.affiliationSupport ? (
                    <>
                      {join.fullName}
                      <div className={tableClass.sub}>{join.zid}</div>
                    </>
                  ) : (
                    <span className={tableClass.sub}>–</span>
                  )}
                </td>
                <td
                  className={`${tableClass.td} ${tableClass.sub} whitespace-nowrap`}
                >
                  {formatTime(join.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {joins.data?.items.length === 0 && (
          <p className="px-4 py-6 text-sm text-light-900 dark:text-dark-900">
            {text.empty}
          </p>
        )}
      </div>
      {joins.data && (
        <Pagination
          page={page}
          pageSize={joins.data.pageSize}
          total={joins.data.total}
          onChange={setPage}
        />
      )}
    </>
  );
}

export function SiteJoinsPage() {
  return (
    <AdminLayout title={text.title} site="site.people">
      <SiteGate>
        <SiteJoins />
      </SiteGate>
    </AdminLayout>
  );
}
