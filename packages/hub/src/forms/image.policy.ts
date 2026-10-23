/**
 * What a picture really is, read from its bytes. The type the browser
 * claims is never trusted: it decides how the picture is served later, and
 * an SVG or HTML file passed off as an image could run script on our origin.
 * Only the four raster formats every browser shows are accepted.
 */

/** Largest picture the server takes. The browser shrinks pictures well below this first. */
export const IMAGE_MAX_BYTES = 3 * 1024 * 1024;

/** The longest side the browser shrinks a picture to before sending it. */
export const IMAGE_MAX_SIDE = 1600;

/** Pictures bigger than this on a side are refused outright (decompression bombs). */
const MAX_DIMENSION = 12_000;

/** For `<input accept>`. HEIC is left out: most browsers cannot read it. */
export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

export interface SniffedImage {
  contentType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  width: number;
  height: number;
}

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));

const u16be = (b: Uint8Array, i: number) =>
  ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
const u16le = (b: Uint8Array, i: number) =>
  (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
const u24le = (b: Uint8Array, i: number) =>
  (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8) | ((b[i + 2] ?? 0) << 16);
const u32be = (b: Uint8Array, i: number) =>
  (((b[i] ?? 0) << 24) >>> 0) +
  ((b[i + 1] ?? 0) << 16) +
  ((b[i + 2] ?? 0) << 8) +
  (b[i + 3] ?? 0);

function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1] ?? 0;
    // Fill bytes: any number of 0xFF may precede a marker.
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    // Markers without a length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = u16be(b, i + 2);
    if (length < 2) return null;
    const isFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isFrame) {
      return { height: u16be(b, i + 5), width: u16be(b, i + 7) };
    }
    i += 2 + length;
  }
  return null;
}

function webpSize(b: Uint8Array): { width: number; height: number } | null {
  const chunk = ascii(b, 12, 4);
  if (chunk === "VP8 " && b.length >= 30) {
    // A lossy frame starts with the key-frame start code 9d 01 2a.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  if (chunk === "VP8L" && b.length >= 25) {
    if (b[20] !== 0x2f) return null;
    const bits =
      (b[21] ?? 0) |
      ((b[22] ?? 0) << 8) |
      ((b[23] ?? 0) << 16) |
      ((b[24] ?? 0) << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X" && b.length >= 30) {
    return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  }
  return null;
}

/** The picture's real type and size, or null if it is not one we accept. */
export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  if (bytes.length < 16) return null;

  let found: SniffedImage | null = null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    const size = jpegSize(bytes);
    if (size) found = { contentType: "image/jpeg", ...size };
  } else if (
    bytes[0] === 0x89 &&
    ascii(bytes, 1, 3) === "PNG" &&
    ascii(bytes, 12, 4) === "IHDR" &&
    bytes.length >= 24
  ) {
    found = {
      contentType: "image/png",
      width: u32be(bytes, 16),
      height: u32be(bytes, 20),
    };
  } else if (
    ascii(bytes, 0, 6) === "GIF87a" ||
    ascii(bytes, 0, 6) === "GIF89a"
  ) {
    found = {
      contentType: "image/gif",
      width: u16le(bytes, 6),
      height: u16le(bytes, 8),
    };
  } else if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    const size = webpSize(bytes);
    if (size) found = { contentType: "image/webp", ...size };
  }

  if (!found) return null;
  const { width, height } = found;
  if (
    width < 1 ||
    height < 1 ||
    width > MAX_DIMENSION ||
    height > MAX_DIMENSION
  ) {
    return null;
  }
  return found;
}

/** Why a picture of this size cannot be sent, or null. Checked before reading it. */
export function imageSizeProblem(size: number): string | null {
  if (size <= 0) return "图片是空的";
  if (size > IMAGE_MAX_BYTES) {
    return `图片太大，上限 ${IMAGE_MAX_BYTES / 1024 / 1024} MB`;
  }
  return null;
}
