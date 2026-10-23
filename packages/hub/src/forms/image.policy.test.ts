import { describe, expect, it } from "vitest";

import {
  GIF_1X1,
  jpegHeader,
  PNG_1X1,
  webpExtended,
  webpLossless,
  webpLossy,
} from "../testing/images";
import { IMAGE_MAX_BYTES, imageSizeProblem, sniffImage } from "./image.policy";

const text = (value: string) =>
  Uint8Array.from(Buffer.from(value.padEnd(40, " ")));

describe("sniffImage", () => {
  it("reads the type and size of the four accepted formats", () => {
    expect(sniffImage(PNG_1X1)).toEqual({
      contentType: "image/png",
      width: 1,
      height: 1,
    });
    expect(sniffImage(GIF_1X1)).toEqual({
      contentType: "image/gif",
      width: 1,
      height: 1,
    });
    expect(sniffImage(jpegHeader(640, 480))).toEqual({
      contentType: "image/jpeg",
      width: 640,
      height: 480,
    });
    expect(sniffImage(webpExtended(1600, 900))).toEqual({
      contentType: "image/webp",
      width: 1600,
      height: 900,
    });
    expect(sniffImage(webpLossless(300, 200))).toEqual({
      contentType: "image/webp",
      width: 300,
      height: 200,
    });
    expect(sniffImage(webpLossy(120, 80))).toEqual({
      contentType: "image/webp",
      width: 120,
      height: 80,
    });
  });

  it("refuses anything that only claims to be a picture", () => {
    expect(
      sniffImage(text('<svg xmlns="http://www.w3.org/2000/svg">')),
    ).toBeNull();
    expect(
      sniffImage(text("<!doctype html><script>alert(1)</script>")),
    ).toBeNull();
    expect(sniffImage(text("RIFF....WEBPVP8Z"))).toBeNull();
    expect(sniffImage(new Uint8Array(4))).toBeNull();
  });

  it("refuses truncated and absurd pictures", () => {
    // A JPEG that ends before any frame header.
    expect(
      sniffImage(
        Uint8Array.from([
          0xff,
          0xd8,
          0xff,
          0xd9,
          ...new Array<number>(20).fill(0),
        ]),
      ),
    ).toBeNull();
    // A JPEG whose segments do not start with a marker.
    expect(
      sniffImage(
        Uint8Array.from([
          0xff,
          0xd8,
          0xff,
          0xe0,
          0x00,
          0x02,
          0x12,
          ...new Array<number>(20).fill(0),
        ]),
      ),
    ).toBeNull();
    expect(sniffImage(jpegHeader(0, 10))).toBeNull();
    expect(sniffImage(webpExtended(20_000, 10))).toBeNull();
  });
});

describe("imageSizeProblem", () => {
  it("refuses empty and oversized files", () => {
    expect(imageSizeProblem(0)).toBe("图片是空的");
    expect(imageSizeProblem(IMAGE_MAX_BYTES + 1)).toContain("图片太大");
    expect(imageSizeProblem(1000)).toBeNull();
  });
});
