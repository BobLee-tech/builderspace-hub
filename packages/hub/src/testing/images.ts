/**
 * Tiny pictures for tests: enough real header bytes for `sniffImage` to read
 * the type and size. The PNG and GIF are complete 1×1 files.
 */

export const PNG_1X1 = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  ),
);

export const GIF_1X1 = Uint8Array.from(
  Buffer.from(
    "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    "base64",
  ),
);

/** A JPEG header: SOI, a JFIF segment, fill bytes, then a baseline frame of `width`×`height`. */
export function jpegHeader(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x10,
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00,
    0x01,
    0x01,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00,
    0xff,
    0xff,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
    0xff,
    0xd9,
  ]);
}

function riff(chunk: string, payload: number[]): Uint8Array {
  const body = [
    ...Buffer.from("WEBP"),
    ...Buffer.from(chunk),
    payload.length,
    0,
    0,
    0,
    ...payload,
  ];
  const size = body.length;
  return Uint8Array.from([
    ...Buffer.from("RIFF"),
    size & 0xff,
    (size >> 8) & 0xff,
    0,
    0,
    ...body,
  ]);
}

/** An extended (VP8X) WebP header of `width`×`height`. */
export function webpExtended(width: number, height: number): Uint8Array {
  const w = width - 1;
  const h = height - 1;
  return riff("VP8X", [
    0,
    0,
    0,
    0,
    w & 0xff,
    (w >> 8) & 0xff,
    (w >> 16) & 0xff,
    h & 0xff,
    (h >> 8) & 0xff,
    (h >> 16) & 0xff,
  ]);
}

/** A lossless (VP8L) WebP header of `width`×`height`. */
export function webpLossless(width: number, height: number): Uint8Array {
  const bits = (width - 1) | ((height - 1) << 14);
  return riff("VP8L", [
    0x2f,
    bits & 0xff,
    (bits >> 8) & 0xff,
    (bits >> 16) & 0xff,
    (bits >> 24) & 0xff,
    0,
    0,
    0,
    0,
    0,
  ]);
}

/** A lossy (VP8) WebP header of `width`×`height`. */
export function webpLossy(width: number, height: number): Uint8Array {
  return riff("VP8 ", [
    0x00,
    0x00,
    0x00,
    0x9d,
    0x01,
    0x2a,
    width & 0xff,
    (width >> 8) & 0x3f,
    height & 0xff,
    (height >> 8) & 0x3f,
  ]);
}
