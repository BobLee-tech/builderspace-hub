import Link from "next/link";
import { useRouter } from "next/router";
import { useState } from "react";
import { TbChevronRight } from "react-icons/tb";

import { PageHead } from "~/components/PageHead";
import { copy } from "~/hub/copy/zh";
import {
  buttonClass,
  Card,
  ConfirmButton,
  ErrorText,
  inputClass,
  Pill,
} from "~/hub/ui/admin-primitives";
import { api } from "~/utils/api";
import { AccessPanel } from "./AccessPanel";
import {
  documentFileUrl,
  documentsHref,
  formatBytes,
  formatDate,
} from "./document-display";
import { DocumentViewer } from "./DocumentViewer";
import { UploadDialog } from "./UploadDialog";

const text = copy.documents;

/** One document: its details, a live preview, and who may change it. */
export function DocumentPage() {
  const router = useRouter();
  const publicId =
    typeof router.query.publicId === "string" ? router.query.publicId : null;

  const utils = api.useUtils();
  const query = api.hub.documents.get.useQuery(
    { documentPublicId: publicId ?? "" },
    { enabled: !!publicId, retry: false },
  );
  const doc = query.data;

  const [editing, setEditing] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const remove = api.hub.documents.delete.useMutation({
    onSuccess: () => {
      void utils.hub.documents.library.invalidate();
      void router.push(documentsHref(doc?.folderPublicId));
    },
  });

  return (
    <>
      <PageHead title={`${doc?.title ?? text.title} | ${copy.brand}`} />
      <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6">
        <nav
          aria-label="breadcrumb"
          className="mb-3 flex flex-wrap items-center gap-1 text-sm text-light-900 dark:text-dark-900"
        >
          <Link href={documentsHref()} className="hover:underline">
            {text.root}
          </Link>
          {doc?.breadcrumbs.map((crumb) => (
            <span
              key={crumb.publicId}
              className="inline-flex items-center gap-1"
            >
              <TbChevronRight size={14} aria-hidden="true" />
              <Link
                href={documentsHref(crumb.publicId)}
                className="hover:underline"
              >
                {crumb.name}
              </Link>
            </span>
          ))}
        </nav>

        <ErrorText message={query.error?.message} />
        {query.isLoading && (
          <p className="text-sm text-light-900 dark:text-dark-900">
            {text.loading}
          </p>
        )}

        {doc && (
          <div className="space-y-5">
            <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h1 className="break-words text-xl font-bold tracking-tight text-light-1000 dark:text-dark-1000">
                  {doc.title}
                </h1>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-light-900 dark:text-dark-900">
                  <Pill>{doc.label}</Pill>
                  <span>{formatBytes(doc.size)}</span>
                  <span>· {doc.filename}</span>
                  <span>
                    · {text.detail.updated} {formatDate(doc.updatedAt)}
                  </span>
                  {doc.uploadedByName && (
                    <span>· {text.detail.uploadedBy(doc.uploadedByName)}</span>
                  )}
                  {!doc.readable && (
                    <Pill tone="alert">{text.badges.hidden}</Pill>
                  )}
                  {doc.canEdit && (
                    <Pill tone="strong">{text.badges.canEdit}</Pill>
                  )}
                </div>
                {doc.description && (
                  <p className="mt-3 max-w-2xl whitespace-pre-wrap text-sm leading-6 text-light-900 dark:text-dark-900">
                    {doc.description}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <a
                  className={buttonClass.primary}
                  href={documentFileUrl(doc.publicId, "download")}
                >
                  {text.actions.download}
                </a>
                {doc.preview && (
                  <a
                    className={buttonClass.ghost}
                    href={documentFileUrl(doc.publicId)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {text.actions.openNewTab}
                  </a>
                )}
              </div>
            </header>

            {doc.canEdit && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={buttonClass.ghost}
                  onClick={() => setEditing((value) => !value)}
                >
                  {text.actions.edit}
                </button>
                {doc.canReplace && (
                  <button
                    type="button"
                    className={buttonClass.ghost}
                    onClick={() => setReplacing(true)}
                  >
                    {text.actions.replace}
                  </button>
                )}
                <ConfirmButton
                  label={text.actions.delete}
                  isPending={remove.isPending}
                  onConfirm={() =>
                    remove.mutate({ documentPublicId: doc.publicId })
                  }
                />
                <ErrorText message={remove.error?.message} />
              </div>
            )}

            {editing && doc.canEdit && (
              <EditForm
                key={doc.updatedAt.toString()}
                doc={doc}
                onDone={() => {
                  setEditing(false);
                  void utils.hub.documents.get.invalidate();
                  void utils.hub.documents.library.invalidate();
                }}
              />
            )}

            <DocumentViewer
              // The file may be replaced under the same address.
              key={`${doc.publicId}-${doc.updatedAt.toString()}`}
              publicId={doc.publicId}
              title={doc.title}
              preview={doc.preview}
            />

            <AccessPanel detail={doc} />
          </div>
        )}
      </div>

      {replacing && doc && (
        <UploadDialog
          documentPublicId={doc.publicId}
          onClose={() => setReplacing(false)}
          onUploaded={() => {
            void utils.hub.documents.get.invalidate();
            void utils.hub.documents.library.invalidate();
          }}
        />
      )}
    </>
  );
}

function EditForm({
  doc,
  onDone,
}: {
  doc: {
    publicId: string;
    title: string;
    description: string | null;
    folderPublicId: string | null;
    readable: boolean;
    folderOptions: { publicId: string; path: string }[];
  };
  onDone: () => void;
}) {
  const [title, setTitle] = useState(doc.title);
  const [description, setDescription] = useState(doc.description ?? "");
  const [folder, setFolder] = useState(doc.folderPublicId ?? "");
  const [readable, setReadable] = useState(doc.readable);
  const update = api.hub.documents.update.useMutation({ onSuccess: onDone });

  return (
    <Card>
      <form
        className="grid gap-4 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          update.mutate({
            documentPublicId: doc.publicId,
            title,
            description,
            folderPublicId: folder || null,
            readable,
          });
        }}
      >
        <label className="block text-sm md:col-span-2">
          {text.detail.title}
          <input
            className={`${inputClass} mt-1`}
            maxLength={120}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="block text-sm md:col-span-2">
          {text.detail.descriptionLabel}
          <textarea
            className={`${inputClass} mt-1 min-h-20`}
            maxLength={500}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label className="block text-sm">
          {text.detail.folder}
          <select
            className={`${inputClass} mt-1`}
            value={folder}
            onChange={(event) => setFolder(event.target.value)}
          >
            <option value="">{text.detail.topLevel}</option>
            {doc.folderOptions.map((option) => (
              <option key={option.publicId} value={option.publicId}>
                {option.path}
              </option>
            ))}
          </select>
        </label>
        <div className="text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={readable}
              onChange={(event) => setReadable(event.target.checked)}
            />
            {text.detail.readable}
          </label>
          <p className="mt-1 text-xs text-light-900 dark:text-dark-900">
            {text.detail.readableHint}
          </p>
        </div>
        <div className="flex items-center gap-2 md:col-span-2">
          <button
            type="submit"
            className={buttonClass.primary}
            disabled={update.isPending}
          >
            {text.actions.save}
          </button>
          <ErrorText message={update.error?.message} />
        </div>
      </form>
    </Card>
  );
}
