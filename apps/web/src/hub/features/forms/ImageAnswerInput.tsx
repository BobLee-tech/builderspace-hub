import { useEffect, useRef, useState } from "react";
import { TbPhoto, TbPhotoPlus, TbX } from "react-icons/tb";

import { IMAGE_ACCEPT } from "@kan/hub/public";

import { copy } from "~/hub/copy/zh";
import { FormApiError, uploadFormImage } from "~/hub/lib/form-client";
import { compressImage, ImageProblem } from "~/hub/lib/image-compress";
import { buttonClass } from "~/hub/ui/admin-primitives";
import { FormImg } from "./form-ui";

const text = copy.forms.fill;

interface Pending {
  key: number;
  percent: number | null;
}

let nextKey = 0;

/**
 * Pictures as an answer: each file is shrunk in the browser, uploaded on its
 * own (with progress), and only its id goes into the answer. Several can be
 * on their way at once; the question's limit counts those too.
 */
export function ImageAnswerInput({
  formId,
  fieldId,
  maxImages,
  value,
  setValue,
  disabled,
  signedIn,
  attached,
  labelledBy,
}: {
  formId: string;
  fieldId: string;
  maxImages: number;
  value: string[];
  setValue: (update: (previous: string[]) => string[]) => void;
  disabled: boolean;
  signedIn: boolean;
  /** Pictures already part of this browser's sent answer. */
  attached: ReadonlySet<string>;
  labelledBy: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Just-uploaded pictures are shown from the bytes this browser already has.
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const previewsRef = useRef(previews);
  previewsRef.current = previews;

  useEffect(
    () => () => {
      for (const url of Object.values(previewsRef.current))
        URL.revokeObjectURL(url);
    },
    [],
  );

  const room = maxImages - value.length - pending.length;

  async function uploadOne(file: File) {
    const key = (nextKey += 1);
    setPending((list) => [...list, { key, percent: null }]);
    try {
      const blob = await compressImage(file);
      setPending((list) =>
        list.map((item) => (item.key === key ? { ...item, percent: 0 } : item)),
      );
      const uploaded = await uploadFormImage({
        formId,
        purpose: "answer",
        fieldId,
        blob,
        onProgress: (percent) =>
          setPending((list) =>
            list.map((item) =>
              item.key === key ? { ...item, percent } : item,
            ),
          ),
      });
      setPreviews((map) => ({
        ...map,
        [uploaded.publicId]: URL.createObjectURL(blob),
      }));
      setValue((previous) => [...previous, uploaded.publicId]);
    } catch (problem) {
      setError(
        problem instanceof ImageProblem || problem instanceof FormApiError
          ? problem.message
          : copy.forms.image.failed,
      );
    } finally {
      setPending((list) => list.filter((item) => item.key !== key));
    }
  }

  function pick(files: File[]) {
    setError(null);
    const chosen = files.slice(0, Math.max(0, room));
    if (files.length > chosen.length) setError(text.imageLimit(maxImages));
    for (const file of chosen) void uploadOne(file);
  }

  function remove(id: string) {
    setValue((previous) => previous.filter((item) => item !== id));
    const url = previews[id];
    if (url) {
      URL.revokeObjectURL(url);
      setPreviews((map) => {
        const next = { ...map };
        delete next[id];
        return next;
      });
    }
  }

  const tile = "relative h-24 w-24 shrink-0 overflow-hidden rounded-lg";

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {value.map((id) => (
          <div key={id} className={tile}>
            {previews[id] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previews[id]}
                alt={text.uploadedImage}
                className="h-full w-full rounded-lg border border-light-300 object-cover dark:border-dark-300"
              />
            ) : signedIn || attached.has(id) ? (
              <FormImg
                id={id}
                alt={text.uploadedImage}
                tokenFormId={signedIn ? undefined : formId}
                className="h-full w-full"
              />
            ) : (
              // An anonymous upload restored from a draft: only its id is known here.
              <span className="flex h-full w-full items-center justify-center rounded-lg border border-light-300 bg-light-100 text-light-800 dark:border-dark-300 dark:bg-dark-200 dark:text-dark-800">
                <TbPhoto size={28} aria-label={text.uploadedImage} />
              </span>
            )}
            {!disabled && (
              <button
                type="button"
                aria-label={text.removeImage}
                title={text.removeImage}
                onClick={() => remove(id)}
                className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
              >
                <TbX size={16} />
              </button>
            )}
          </div>
        ))}
        {pending.map((item) => (
          <div
            key={item.key}
            className={`${tile} flex items-center justify-center border border-dashed border-light-400 bg-light-100 px-2 text-center text-xs text-light-900 dark:border-dark-400 dark:bg-dark-200 dark:text-dark-900`}
            role="status"
          >
            {item.percent === null
              ? text.compressing
              : text.uploading(item.percent)}
          </div>
        ))}
      </div>

      {!disabled && room > 0 && (
        <button
          type="button"
          aria-describedby={labelledBy}
          className={`${buttonClass.ghost} mt-3 gap-1.5 py-2`}
          onClick={() => input.current?.click()}
        >
          <TbPhotoPlus size={18} aria-hidden="true" />
          {text.uploadImage}
        </button>
      )}
      <p className="mt-2 text-xs text-light-900 dark:text-dark-900">
        {text.imageLimit(maxImages)}
      </p>
      {error && (
        <p role="alert" className="mt-1 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <input
        ref={input}
        type="file"
        accept={IMAGE_ACCEPT}
        multiple={maxImages > 1}
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          // Cleared so picking the same picture again still fires a change.
          event.target.value = "";
          if (files.length > 0) pick(files);
        }}
      />
    </div>
  );
}
