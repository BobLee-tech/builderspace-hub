import { describe, expect, it } from "vitest";

import { documentStorageFromEnv } from "./storage.config";

const S3 = {
  HUB_DOCUMENTS_BUCKET: "docs",
  S3_ACCESS_KEY_ID: "id",
  S3_SECRET_ACCESS_KEY: "secret",
};

describe("documentStorageFromEnv", () => {
  it("has no storage until one is configured", () => {
    expect(documentStorageFromEnv({})).toBeNull();
  });

  it("uses the bucket when one is named", () => {
    expect(documentStorageFromEnv(S3)?.name).toBe("s3");
  });

  it("refuses a bucket without credentials", () => {
    expect(() =>
      documentStorageFromEnv({ HUB_DOCUMENTS_BUCKET: "docs" }),
    ).toThrow("S3_ACCESS_KEY_ID");
  });

  it("uses a folder on disk in development", () => {
    expect(
      documentStorageFromEnv({ HUB_DOCUMENTS_DIR: "/tmp/hub-docs" })?.name,
    ).toBe("fs");
  });

  it("will not put files on a production server's disk", () => {
    expect(() =>
      documentStorageFromEnv({
        HUB_DOCUMENTS_DIR: "/tmp/hub-docs",
        NODE_ENV: "production",
      }),
    ).toThrow("development only");
  });

  it("prefers the bucket when both are set", () => {
    expect(
      documentStorageFromEnv({ ...S3, HUB_DOCUMENTS_DIR: "/tmp/x" })?.name,
    ).toBe("s3");
  });
});
