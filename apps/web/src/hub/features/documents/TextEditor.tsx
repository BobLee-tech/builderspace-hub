import { useState } from "react";

import { copy } from "~/hub/copy/zh";
import { buttonClass, Card, ErrorText, inputClass } from "~/hub/ui/admin-primitives";
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
  const [draft, setDraft] = useState<string | null>(null);
  const save = api.hub.documents.replaceText.useMutation({
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });

  const value = draft ?? current.data?.content ?? "";
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
            value={value}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              className={buttonClass.primary}
              disabled={save.isPending || unchanged || value.length === 0}
              onClick={() =>
                save.mutate({ documentPublicId, content: value })
              }
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
