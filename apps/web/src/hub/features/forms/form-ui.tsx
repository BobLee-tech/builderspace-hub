import { useEffect, useState } from "react";
import { twMerge } from "tailwind-merge";

import type { FormPhase, StoredAnswer } from "@kan/hub/public";
import { formHref, formImageSrc, normaliseUrl } from "@kan/hub/public";

import { copy } from "~/hub/copy/zh";
import { fetchImageWithToken } from "~/hub/lib/form-client";
import { buttonClass, Pill } from "~/hub/ui/admin-primitives";
import { linkParts, phaseLabel, phaseTone } from "./form-display";

/**
 * Small pieces shared by the form builder, the fill page, the results wall
 * and the answers list.
 */

const linkClass =
  "break-all text-blue-700 underline decoration-blue-300 underline-offset-2 hover:decoration-blue-700 dark:text-blue-300 dark:decoration-blue-800";

/**
 * Text someone wrote, shown as text: line breaks kept, http(s) addresses
 * made into links that open elsewhere and pass on nothing. Nothing in it is
 * ever read as HTML.
 */
export function RichText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  if (!text) return null;
  return (
    <p className={twMerge("whitespace-pre-wrap break-words", className)}>
      {linkParts(text).map((part, index) =>
        "href" in part ? (
          <a
            key={index}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer nofollow ugc"
            className={linkClass}
          >
            {part.text}
          </a>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </p>
  );
}

/**
 * A picture of a form. With `tokenFormId`, it is fetched with this browser's
 * edit token for that form (the pictures of one's own anonymous answer).
 */
export function FormImg({
  id,
  alt = "",
  className,
  tokenFormId,
  link = false,
}: {
  id: string;
  alt?: string;
  className?: string;
  tokenFormId?: string;
  /** Open the full picture in a new tab when clicked. */
  link?: boolean;
}) {
  const direct = formImageSrc(id);
  const [src, setSrc] = useState<string | null>(tokenFormId ? null : direct);

  useEffect(() => {
    if (!tokenFormId) {
      setSrc(direct);
      return;
    }
    let url: string | null = null;
    let cancelled = false;
    void fetchImageWithToken(tokenFormId, direct).then((objectUrl) => {
      if (cancelled) {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        return;
      }
      url = objectUrl;
      setSrc(objectUrl);
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [direct, tokenFormId]);

  const image = src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className={twMerge(
        "rounded-lg border border-light-300 bg-light-100 object-cover dark:border-dark-300 dark:bg-dark-200",
        className,
      )}
    />
  ) : (
    <span
      aria-hidden="true"
      className={twMerge(
        "block animate-pulse rounded-lg bg-light-200 dark:bg-dark-200",
        className,
      )}
    />
  );
  if (!link || !src) return image;
  return (
    <a href={src} target="_blank" rel="noopener noreferrer" className="block">
      {image}
    </a>
  );
}

/** A row of pictures (a question's illustrations, or an answer's uploads). */
export function ImageStrip({
  ids,
  tokenFormId,
  size = "md",
}: {
  ids: string[];
  tokenFormId?: string;
  size?: "sm" | "md";
}) {
  if (ids.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {ids.map((id) => (
        <FormImg
          key={id}
          id={id}
          link
          tokenFormId={tokenFormId}
          className={size === "sm" ? "h-20 w-20" : "h-32 w-32 sm:h-40 sm:w-40"}
        />
      ))}
    </div>
  );
}

/** One stored answer, read-only. Web addresses become links. */
export function AnswerView({
  answer,
  tokenFormId,
}: {
  answer: StoredAnswer;
  tokenFormId?: string;
}) {
  switch (answer.type) {
    case "text": {
      const url = /^https?:\/\//.test(answer.text)
        ? normaliseUrl(answer.text)
        : null;
      return url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer nofollow ugc"
          className={`text-sm ${linkClass}`}
        >
          {answer.text}
        </a>
      ) : (
        <RichText
          text={answer.text}
          className="text-sm text-light-1000 dark:text-dark-1000"
        />
      );
    }
    case "choice":
      return (
        <div className="flex flex-wrap gap-1.5">
          {answer.selected.map((item) => (
            <Pill key={item.id}>{item.label || "🖼"}</Pill>
          ))}
          {answer.other !== null && (
            <Pill>
              {copy.forms.fill.other}：{answer.other}
            </Pill>
          )}
        </div>
      );
    case "images":
      return (
        <ImageStrip ids={answer.images} tokenFormId={tokenFormId} size="sm" />
      );
  }
}

export function PhasePill({ phase }: { phase: FormPhase }) {
  return <Pill tone={phaseTone(phase)}>{phaseLabel(phase)}</Pill>;
}

/** The fill link for a form, copied to the clipboard. */
export function CopyLinkButton({
  publicId,
  className,
  label = copy.forms.list.copyLink,
}: {
  publicId: string;
  className?: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      className={className ?? buttonClass.ghost}
      onClick={() => {
        void navigator.clipboard
          .writeText(`${window.location.origin}${formHref(publicId)}`)
          .then(() => setCopied(true));
      }}
    >
      {copied ? copy.forms.list.copied : label}
    </button>
  );
}
