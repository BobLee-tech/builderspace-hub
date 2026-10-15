import { useRef, useState } from "react";
import { TbUpload } from "react-icons/tb";

import { copy } from "~/hub/copy/zh";
import { buttonClass } from "~/hub/ui/admin-primitives";
import { api } from "~/utils/api";
import { formatBytes } from "./document-display";
import { sendFile } from "./upload-client";

const text = copy.documents.upload;

type Status = keyof typeof text.status;

interface Item {
  id: number;
  file: File;
  status: Status;
  progress: number;
  error: string | null;
}

/**
 * Uploads one or several files into a folder (or, with `documentPublicId`,
 * replaces one document's file). Each file goes: ask the server where to send
 * it, send it there, tell the server it arrived. Files go one at a time so a
 * big batch does not saturate the connection.
 */
export function UploadDialog({
  folderPublicId,
  folderName,
  documentPublicId,
  onClose,
  onUploaded,
}: {
  folderPublicId?: string | null;
  folderName?: string | null;
  /** When set, the dialog replaces this document's file (one file only). */
  documentPublicId?: string;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const nextId = useRef(0);

  const prepare = api.hub.documents.prepareUpload.useMutation();
  const complete = api.hub.documents.completeUpload.useMutation();

  const patch = (id: number, change: Partial<Item>) =>
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...change } : item)),
    );

  const upload = async (item: Item) => {
    try {
      patch(item.id, { status: "preparing" });
      const prepared = await prepare.mutateAsync({
        filename: item.file.name,
        size: item.file.size,
        documentPublicId,
      });
      patch(item.id, { status: "uploading" });
      await sendFile(prepared.target, item.file, (progress) =>
        patch(item.id, { progress }),
      );
      patch(item.id, { status: "finishing", progress: 1 });
      await complete.mutateAsync({
        uploadId: prepared.uploadId,
        folderPublicId: documentPublicId ? undefined : folderPublicId,
      });
      patch(item.id, { status: "done" });
    } catch (error) {
      patch(item.id, {
        status: "failed",
        error:
          error instanceof Error
            ? error.message
            : copy.documents.errors.uploadFailed,
      });
    }
  };

  const start = async (files: File[]) => {
    const chosen = documentPublicId ? files.slice(0, 1) : files;
    const added: Item[] = chosen.map((file) => ({
      id: nextId.current++,
      file,
      status: "waiting",
      progress: 0,
      error: null,
    }));
    setItems((current) => [...current, ...added]);
    setRunning(true);
    for (const item of added) await upload(item);
    setRunning(false);
    onUploaded();
  };

  const done = items.filter((item) => item.status === "done").length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={text.title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-lg rounded-xl border border-light-300 bg-light-50 p-5 shadow-xl dark:border-dark-300 dark:bg-dark-100">
        <h2 className="text-base font-semibold text-light-1000 dark:text-dark-1000">
          {documentPublicId ? copy.documents.actions.replace : text.title}
        </h2>
        <p className="mt-1 text-xs leading-5 text-light-900 dark:text-dark-900">
          {documentPublicId
            ? copy.documents.detail.replaceHint
            : `${text.destination}：${folderName ?? text.topLevel}。${text.hint}`}
        </p>

        <button
          type="button"
          disabled={running}
          onClick={() => input.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            if (!running) void start([...event.dataTransfer.files]);
          }}
          className="mt-4 flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-light-500 px-4 py-8 text-sm text-light-900 hover:bg-light-100 disabled:opacity-50 dark:border-dark-500 dark:text-dark-900 dark:hover:bg-dark-200"
        >
          <TbUpload size={22} aria-hidden="true" />
          <span>
            {text.drop}
            <span className="ml-1 font-medium text-light-1000 underline dark:text-dark-1000">
              {text.choose}
            </span>
          </span>
        </button>
        <input
          ref={input}
          type="file"
          multiple={!documentPublicId}
          className="hidden"
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = "";
            if (files.length > 0) void start(files);
          }}
        />

        {items.length > 0 && (
          <ul className="mt-4 max-h-60 space-y-2 overflow-y-auto">
            {items.map((item) => (
              <li key={item.id} className="text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-light-1000 dark:text-dark-1000">
                    {item.file.name}
                    <span className="ml-2 text-xs text-light-900 dark:text-dark-900">
                      {formatBytes(item.file.size)}
                    </span>
                  </span>
                  <span
                    className={
                      item.status === "failed"
                        ? "shrink-0 text-xs text-red-600 dark:text-red-400"
                        : "shrink-0 text-xs text-light-900 dark:text-dark-900"
                    }
                  >
                    {text.status[item.status]}
                  </span>
                </div>
                {item.status === "uploading" && (
                  <div className="mt-1 h-1 overflow-hidden rounded bg-light-200 dark:bg-dark-300">
                    <div
                      className="h-full bg-light-1000 dark:bg-dark-1000"
                      style={{ width: `${Math.round(item.progress * 100)}%` }}
                    />
                  </div>
                )}
                {item.error && (
                  <p
                    role="alert"
                    className="mt-1 text-xs text-red-600 dark:text-red-400"
                  >
                    {item.error}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5 flex items-center justify-between">
          <span className="text-xs text-light-900 dark:text-dark-900">
            {items.length > 1 ? text.progress(done, items.length) : ""}
          </span>
          <button
            type="button"
            className={buttonClass.ghost}
            disabled={running}
            onClick={onClose}
          >
            {text.close}
          </button>
        </div>
      </div>
    </div>
  );
}
