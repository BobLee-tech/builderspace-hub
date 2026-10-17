import { useState } from "react";

import { copy } from "~/hub/copy/zh";
import {
  buttonClass,
  Card,
  ErrorText,
  inputClass,
} from "~/hub/ui/admin-primitives";
import { api } from "~/utils/api";

const text = copy.documents.editText;

/** Rewrites the text of a text document. Saving replaces the old content. */
export function TextEditor({
  documentPublicId,
  onSaved,
  onClose,
}: {
  documentPublicId: string;
  onSaved: () => void;
  onClose: () => void;
}) {
  const current = api.hub.documents.content.useQuery(
    { documentPublicId },
    { retry: false, refetchOnWindowFocus: false },
  );
  // The draft keeps the revision it was started from. The content query is
  // shared with the viewer and may refetch while someone types; saving
  // against the refetched revision would overwrite another editor's change
  // instead of reporting the conflict.
  const [draft, setDraft] = useState<{ text: string; base: Date } | null>(null);
  const save = api.hub.documents.replaceText.useMutation({
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });

  const value = draft?.text ?? current.data?.content ?? "";
  const unchanged = value === (current.data?.content ?? "");

  return (
    <Card>
      <h2 className="text-sm font-semibold text-light-1000 dark:text-dark-1000">
        {text.title}
      </h2>
      <p className="mt-1 text-xs text-light-900 dark:text-dark-900">
        {text.hint}
      </p>
      {current.isLoading && (
        <p className="mt-3 text-sm text-light-900 dark:text-dark-900">
          {text.loading}
        </p>
      )}
      <ErrorText message={current.error?.message} />
      {current.data && (
        <>
          <textarea
            aria-label={text.title}
            className={`${inputClass} mt-3 min-h-96 font-mono text-[13px] leading-6`}
            spellCheck={false}
            // Locked while saving: anything typed after clicking save would be
            // lost when the editor closes on success.
            readOnly={save.isPending}
            value={value}
            onChange={(event) => {
              const text = event.target.value;
              setDraft((previous) => ({
                text,
                base: previous?.base ?? new Date(current.data.updatedAt),
              }));
            }}
          />
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              className={buttonClass.primary}
              disabled={
                save.isPending || !draft || unchanged || value.length === 0
              }
              onClick={() => {
                if (!draft) return;
                save.mutate({
                  documentPublicId,
                  content: draft.text,
                  expectedUpdatedAt: draft.base.toISOString(),
                });
              }}
            >
              {text.save}
            </button>
            <button
              type="button"
              className={buttonClass.ghost}
              disabled={save.isPending}
              onClick={onClose}
            >
              {copy.documents.actions.cancel}
            </button>
            <ErrorText message={save.error?.message} />
          </div>
        </>
      )}
    </Card>
  );
}
