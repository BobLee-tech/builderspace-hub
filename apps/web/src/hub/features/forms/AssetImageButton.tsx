import { useRef, useState } from "react";
import { TbPhotoPlus } from "react-icons/tb";
import { twMerge } from "tailwind-merge";

import { IMAGE_ACCEPT } from "@kan/hub/public";

import { copy } from "~/hub/copy/zh";
import { FormApiError, uploadFormImage } from "~/hub/lib/form-client";
import { compressImage, ImageProblem } from "~/hub/lib/image-compress";
import { buttonClass } from "~/hub/ui/admin-primitives";

/**
 * Picks a picture for the form itself (cover, question or option picture),
 * shrinks it in the browser and uploads it; hands back its id for the draft.
 * The picture only stays if the form is saved with it (the server clears
 * unused ones after a day).
 */
export function AssetImageButton({
  formId,
  onUploaded,
  label = copy.forms.builder.addImage,
  disabled,
  compact,
}: {
  formId: string;
  onUploaded: (imagePublicId: string) => void;
  label?: string;
  disabled?: boolean;
  /** Icon only, for tight spots such as an option row. */
  compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "compressing" | number>("idle");
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File) {
    setError(null);
    setState("compressing");
    try {
      const blob = await compressImage(file);
      setState(0);
      const uploaded = await uploadFormImage({
        formId,
        purpose: "asset",
        blob,
        onProgress: setState,
      });
      onUploaded(uploaded.publicId);
    } catch (problem) {
      setError(
        problem instanceof ImageProblem || problem instanceof FormApiError
          ? problem.message
          : copy.forms.builder.uploadFailed,
      );
    } finally {
      setState("idle");
    }
  }

  const busy = state !== "idle";
  const busyLabel =
    state === "compressing"
      ? copy.forms.fill.compressing
      : typeof state === "number"
        ? copy.forms.fill.uploading(state)
        : null;

  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        title={label}
        aria-label={label}
        className={twMerge(buttonClass.ghost, "gap-1.5", compact && "px-2")}
        disabled={(disabled ?? false) || busy}
        onClick={() => input.current?.click()}
      >
        <TbPhotoPlus size={16} aria-hidden="true" />
        {busyLabel ?? (compact ? null : label)}
      </button>
      <input
        ref={input}
        type="file"
        accept={IMAGE_ACCEPT}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared so picking the same file again still fires a change.
          event.target.value = "";
          if (file) void pick(file);
        }}
      />
      {error && (
        <span role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </span>
      )}
    </span>
  );
}
