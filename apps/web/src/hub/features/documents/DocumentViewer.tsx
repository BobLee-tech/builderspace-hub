import type { PreviewKind } from "@kan/hub/documents";

import { copy } from "~/hub/copy/zh";
import { documentFileUrl } from "./document-display";

const text = copy.documents.detail;

const frame =
  "block h-[78vh] w-full rounded-xl border border-light-300 bg-white dark:border-dark-300";

/**
 * Shows a document in the page. The file comes from our own route, which
 * checks the reader's rights first.
 *
 * HTML is the one format that can carry code, so it is shown in a sandboxed
 * frame: scripts may run (charts and interactive decks need them) but the page
 * is treated as coming from nowhere, so it cannot touch this app's cookies,
 * storage or API. PDFs go in a plain frame because browsers do not render
 * their built-in viewer inside a sandbox.
 */
export function DocumentViewer({
  publicId,
  title,
  preview,
}: {
  publicId: string;
  title: string;
  preview: PreviewKind | null;
}) {
  const src = documentFileUrl(publicId);

  switch (preview) {
    case "pdf":
      return (
        <iframe
          title={title}
          src={src}
          className={frame}
          referrerPolicy="no-referrer"
        />
      );
    case "html":
      return (
        <iframe
          title={title}
          src={src}
          className={frame}
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
        />
      );
    case "text":
      return (
        <iframe
          title={title}
          src={src}
          className={frame}
          sandbox=""
          referrerPolicy="no-referrer"
        />
      );
    case "image":
      return (
        // eslint-disable-next-line @next/next/no-img-element -- a signed, expiring link; next/image would proxy and cache it
        <img
          src={src}
          alt={title}
          className="mx-auto max-h-[78vh] rounded-xl border border-light-300 dark:border-dark-300"
          referrerPolicy="no-referrer"
        />
      );
    default:
      return (
        <p className="rounded-xl border border-dashed border-light-400 p-8 text-center text-sm text-light-900 dark:border-dark-400 dark:text-dark-900">
          {text.noPreview}
        </p>
      );
  }
}
