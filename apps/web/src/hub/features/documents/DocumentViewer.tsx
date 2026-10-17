import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { PreviewKind } from "@kan/hub/documents";

import { copy } from "~/hub/copy/zh";
import { ErrorText } from "~/hub/ui/admin-primitives";
import { api } from "~/utils/api";
import { documentFileUrl } from "./document-display";

const text = copy.documents.detail;

const frame =
  "block h-[78vh] w-full rounded-xl border border-light-300 bg-white dark:border-dark-300";

/**
 * Shows a document in the page.
 *
 * HTML can carry code, so it is shown in a sandboxed frame: scripts may run
 * (charts and interactive pages need them) but the page is treated as coming
 * from nowhere, so it cannot touch this app's cookies, storage or API.
 *
 * Markdown is rendered in the page itself, from the text, with GitHub's
 * tables, task lists and strikethrough (a Word upload's tables come out as
 * GitHub tables). Raw HTML inside it is not interpreted (react-markdown shows
 * it as text), and unsafe link addresses such as `javascript:` are dropped,
 * so it needs no sandbox.
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
  switch (preview) {
    case "html":
      return (
        <iframe
          title={title}
          src={documentFileUrl(publicId)}
          className={frame}
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
        />
      );
    case "markdown":
      return <MarkdownView publicId={publicId} />;
    default:
      return (
        <p className="rounded-xl border border-dashed border-light-400 p-8 text-center text-sm text-light-900 dark:border-dark-400 dark:text-dark-900">
          {text.noPreview}
        </p>
      );
  }
}

function MarkdownView({ publicId }: { publicId: string }) {
  const content = api.hub.documents.content.useQuery(
    { documentPublicId: publicId },
    { retry: false, refetchOnWindowFocus: false },
  );

  return (
    <article className="rounded-xl border border-light-300 bg-light-50 p-6 dark:border-dark-300 dark:bg-dark-100">
      {content.isLoading && (
        <p className="text-sm text-light-900 dark:text-dark-900">
          {copy.documents.loading}
        </p>
      )}
      <ErrorText message={content.error?.message} />
      {content.data && (
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ node: _node, ...props }) => (
                <a {...props} target="_blank" rel="noopener noreferrer" />
              ),
            }}
          >
            {content.data.content}
          </ReactMarkdown>
        </div>
      )}
    </article>
  );
}
