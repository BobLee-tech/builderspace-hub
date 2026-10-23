import Link from "next/link";
import { useRouter } from "next/router";
import { useState } from "react";

import { FORM_LIMITS, formHref } from "@kan/hub/public";

import { PageHead } from "~/components/PageHead";
import { copy } from "~/hub/copy/zh";
import {
  buttonClass,
  Card,
  ErrorText,
  inputClass,
  PageHeader,
  Pill,
  tableClass,
} from "~/hub/ui/admin-primitives";
import { api } from "~/utils/api";
import { formatDate } from "../documents/document-display";
import { formatDateTime } from "./form-display";
import { CopyLinkButton, PhasePill } from "./form-ui";

const text = copy.forms;

const manageHref = (publicId: string) => `${formHref(publicId)}/manage`;

/** 表单: the forms someone manages, and the open ones waiting for their answer. */
export function FormsPage() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");

  const list = api.hub.forms.list.useQuery(undefined, { retry: false });
  const create = api.hub.forms.create.useMutation({
    onSuccess: ({ publicId }) => void router.push(manageHref(publicId)),
  });
  const data = list.data;

  return (
    <>
      <PageHead title={`${text.title} | ${copy.brand}`} />
      <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6">
        <PageHeader title={text.title} description={text.description}>
          {data?.canCreate && !creating && (
            <button
              type="button"
              className={buttonClass.primary}
              onClick={() => setCreating(true)}
            >
              {text.list.newForm}
            </button>
          )}
        </PageHeader>

        {creating && (
          <form
            className="mb-6 flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate({ title });
            }}
          >
            <input
              autoFocus
              className={`${inputClass} max-w-md`}
              aria-label={text.list.titlePlaceholder}
              placeholder={text.list.titlePlaceholder}
              maxLength={FORM_LIMITS.title}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
            <button
              type="submit"
              className={buttonClass.primary}
              disabled={create.isPending || !title.trim()}
            >
              {text.list.create}
            </button>
            <button
              type="button"
              className={buttonClass.ghost}
              onClick={() => setCreating(false)}
            >
              {text.list.cancel}
            </button>
            <ErrorText message={create.error?.message} />
          </form>
        )}

        <ErrorText message={list.error?.message} />
        {list.isLoading && (
          <p className="text-sm text-light-900 dark:text-dark-900">
            {text.loading}
          </p>
        )}

        {data && data.toFill.length > 0 && (
          <Card title={text.list.toFill} className="mb-6">
            <ul className="divide-y divide-light-200 dark:divide-dark-200">
              {data.toFill.map((form) => (
                <li
                  key={form.publicId}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-light-1000 dark:text-dark-1000">
                      {form.title}
                    </span>
                    {form.closesAt && (
                      <span className={tableClass.sub}>
                        {text.list.closesAt(formatDateTime(form.closesAt))}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-2">
                    {form.answered && <Pill>{text.list.answered}</Pill>}
                    <Link
                      href={formHref(form.publicId)}
                      className={buttonClass.ghost}
                    >
                      {text.list.open}
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {data && (data.canCreate || data.managed.length > 0) && (
          <section>
            <h2 className="mb-3 text-sm font-semibold text-light-1000 dark:text-dark-1000">
              {text.list.managed}
            </h2>
            {data.managed.length === 0 ? (
              <p className="rounded-xl border border-dashed border-light-400 p-8 text-center text-sm text-light-900 dark:border-dark-400 dark:text-dark-900">
                {text.list.empty} {data.canCreate && text.list.emptyCreator}
              </p>
            ) : (
              <div className={tableClass.wrap}>
                <table className={tableClass.table}>
                  <thead>
                    <tr>
                      <th className={tableClass.th}>
                        {text.list.columns.title}
                      </th>
                      <th className={tableClass.th}>
                        {text.list.columns.status}
                      </th>
                      <th className={tableClass.th}>
                        {text.list.columns.access}
                      </th>
                      <th className={tableClass.th}>
                        {text.list.columns.responses}
                      </th>
                      <th className={tableClass.th}>
                        {text.list.columns.updated}
                      </th>
                      <th className={tableClass.th} />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-light-200 dark:divide-dark-200">
                    {data.managed.map((form) => (
                      <tr key={form.publicId}>
                        <td className={tableClass.td}>
                          <Link
                            href={manageHref(form.publicId)}
                            className="font-medium hover:underline"
                          >
                            {form.title}
                          </Link>
                          {form.closesAt && (
                            <p className={tableClass.sub}>
                              {text.list.closesAt(
                                formatDateTime(form.closesAt),
                              )}
                            </p>
                          )}
                        </td>
                        <td className={tableClass.td}>
                          <PhasePill phase={form.phase} />
                        </td>
                        <td className={`${tableClass.td} whitespace-nowrap`}>
                          {text.accessShort[form.access]}
                        </td>
                        <td className={`${tableClass.td} whitespace-nowrap`}>
                          {text.list.responses(
                            form.responseCount,
                            form.maxResponses,
                          )}
                        </td>
                        <td className={`${tableClass.td} whitespace-nowrap`}>
                          {formatDate(form.updatedAt)}
                        </td>
                        <td className={`${tableClass.td} text-right`}>
                          {form.phase.phase !== "draft" && (
                            <CopyLinkButton publicId={form.publicId} />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {data &&
          !data.canCreate &&
          data.managed.length === 0 &&
          data.toFill.length === 0 && (
            <p className="rounded-xl border border-dashed border-light-400 p-8 text-center text-sm text-light-900 dark:border-dark-400 dark:text-dark-900">
              {text.list.emptyToFill}
            </p>
          )}
      </div>
    </>
  );
}
