import { IMAGE_MAX_BYTES, IMAGE_MAX_SIDE } from "@kan/hub/public";

import { copy } from "~/hub/copy/zh";

/**
 * Shrinks a picture in the browser before it is uploaded: the longest side
 * to IMAGE_MAX_SIDE, re-encoded as WebP (JPEG where the browser cannot write
 * WebP). Pictures are stored in the database, so this keeps a phone photo
 * of several megabytes to a few hundred kilobytes.
 *
 * Re-encoding also drops the photo's EXIF data, which can hold where it was
 * taken. The one exception is a small GIF, sent as it is so it keeps moving.
 */

/** Fits within the server's limit with room to spare. */
const TARGET_BYTES = Math.min(1.5 * 1024 * 1024, IMAGE_MAX_BYTES);
const GIF_AS_IS_BYTES = 2 * 1024 * 1024;

export class ImageProblem extends Error {}

/** The longest side scaled down to `max`, never up. */
export function fitWithin(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      // Turns the picture upright according to its EXIF orientation.
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Fall through: some browsers only decode some formats via <img>.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return image;
  } catch {
    throw new ImageProblem(copy.forms.image.unreadable);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function encode(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function compressImage(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/") && !/\.(heic|heif)$/i.test(file.name)) {
    throw new ImageProblem(copy.forms.image.notImage);
  }
  if (file.type === "image/gif" && file.size <= GIF_AS_IS_BYTES) return file;

  const source = await decode(file);
  const naturalWidth =
    "naturalWidth" in source ? source.naturalWidth : source.width;
  const naturalHeight =
    "naturalHeight" in source ? source.naturalHeight : source.height;
  if (!naturalWidth || !naturalHeight)
    throw new ImageProblem(copy.forms.image.unreadable);

  let side = IMAGE_MAX_SIDE;
  let quality = 0.82;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const size = fitWithin(naturalWidth, naturalHeight, side);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new ImageProblem(copy.forms.image.unreadable);
    // A white page behind transparent pixels: JPEG has no transparency and
    // would turn them black.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(source, 0, 0, size.width, size.height);

    let blob = await encode(canvas, "image/webp", quality);
    // Browsers that cannot write WebP quietly hand back a PNG instead.
    if (!blob || blob.type !== "image/webp") {
      blob = await encode(canvas, "image/jpeg", quality);
    }
    if (blob && blob.size <= TARGET_BYTES) {
      if ("close" in source) source.close();
      return blob;
    }
    side = Math.round(side * 0.75);
    quality = Math.max(0.6, quality - 0.08);
  }
  if ("close" in source) source.close();
  throw new ImageProblem(copy.forms.image.tooLarge);
}
