import { useRef, useState } from "react";

import type { ImportedDocument } from "@kan/hub/documents/file-import";
import { IMPORT_ACCEPT } from "@kan/hub/public";

import { copy } from "~/hub/copy/zh";
import { buttonClass } from "~/hub/ui/admin-primitives";

const text = copy.documents.actions;

/**
 * 上传文件: reads a .md, .html or .docx file in the browser and hands back a
 * document to check before it is saved. The Word converter is loaded only
 * when a file is picked, so the library page stays light.
 */
export function UploadButton({
  onImported,
  onError,
}: {
  onImported: (document: ImportedDocument) => void;
  onError: (reason: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);

  async function read(file: File) {
    setReading(true);
    onError(null);
    try {
      const { importDocumentFile } = await import(
        "@kan/hub/documents/file-import"
      );
      const result = await importDocumentFile({
        name: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
      if (result.ok) onImported(result.document);
      else onError(result.reason);
    } catch {
      onError(text.uploadFailed);
    } finally {
      setReading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={buttonClass.ghost}
        disabled={reading}
        onClick={() => input.current?.click()}
      >
        {reading ? text.uploading : text.upload}
      </button>
      <input
        ref={input}
        type="file"
        accept={IMPORT_ACCEPT}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared so picking the same file again still fires a change.
          event.target.value = "";
          if (file) void read(file);
        }}
      />
    </>
  );
}
