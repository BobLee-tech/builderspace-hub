import Link from "next/link";

import { PageHead } from "~/components/PageHead";
import { copy } from "~/hub/copy/zh";
import {
  buttonClass,
  Card,
  ErrorText,
  PageHeader,
} from "~/hub/ui/admin-primitives";
import { api } from "~/utils/api";
import { documentHref, documentsHref, formatDate } from "./document-display";

const text = copy.documents.requests;

/** Pending requests for edit rights that the signed-in person may decide. */
export function RequestsPage() {
  const utils = api.useUtils();
  const requests = api.hub.documents.requests.useQuery(undefined, {
    retry: false,
  });
  const decide = api.hub.documents.decideRequest.useMutation({
    onSuccess: () => {
      void utils.hub.documents.requests.invalidate();
      void utils.hub.documents.get.invalidate();
      void utils.hub.documents.library.invalidate();
    },
  });

  return (
    <>
      <PageHead title={`${text.title} | ${copy.brand}`} />
      <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6">
        <PageHeader title={text.title} description={text.description}>
          <Link href={documentsHref()} className={buttonClass.ghost}>
            {text.back}
          </Link>
        </PageHeader>

        <ErrorText message={requests.error?.message ?? decide.error?.message} />

        {requests.data?.length === 0 && (
          <p className="rounded-xl border border-dashed border-light-400 p-8 text-center text-sm text-light-900 dark:border-dark-400 dark:text-dark-900">
            {text.empty}
          </p>
        )}

        <div className="space-y-3">
          {requests.data?.map((item) => (
            <Card key={item.publicId}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 text-sm">
                  <p className="font-medium">
                    {text.wants(item.requester.name)}
                    <Link
                      href={documentHref(item.document.publicId)}
                      className="ml-1 underline"
                    >
                      {item.document.title}
                    </Link>
                  </p>
                  <p className="mt-0.5 text-xs text-light-900 dark:text-dark-900">
                    {item.requester.email} · {formatDate(item.createdAt)}
                  </p>
                  {item.note && (
                    <p className="mt-2 text-light-900 dark:text-dark-900">
                      {item.note}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    className={buttonClass.primary}
                    disabled={decide.isPending}
                    onClick={() =>
                      decide.mutate({
                        requestPublicId: item.publicId,
                        approve: true,
                      })
                    }
                  >
                    {copy.documents.access.approve}
                  </button>
                  <button
                    type="button"
                    className={buttonClass.ghost}
                    disabled={decide.isPending}
                    onClick={() =>
                      decide.mutate({
                        requestPublicId: item.publicId,
                        approve: false,
                      })
                    }
                  >
                    {copy.documents.access.deny}
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}
