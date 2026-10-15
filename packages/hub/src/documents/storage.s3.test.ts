import { describe, expect, it, vi } from "vitest";

import { createDocumentS3Client, S3DocumentStorage } from "./storage.s3";

const client = () =>
  createDocumentS3Client({
    region: "auto",
    endpoint: "https://acct.r2.example.test",
    accessKeyId: "test-key",
    secretAccessKey: "test-secret",
    forcePathStyle: true,
  });

describe("S3DocumentStorage", () => {
  it("signs an upload to the exact size and leaves no checksum in the URL", async () => {
    const storage = new S3DocumentStorage(client(), "docs");
    const target = await storage.createUpload({
      key: "documents/abc.pdf",
      uploadId: "u1",
      contentType: "application/pdf",
      size: 1234,
      expiresInSeconds: 600,
    });

    const url = new URL(target.url);
    expect(url.origin).toBe("https://acct.r2.example.test");
    expect(url.pathname).toBe("/docs/documents/abc.pdf");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
    // The size is part of the signature, so a bigger file is refused by S3.
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain(
      "content-length",
    );
    // A checksum of an empty body in the URL would reject every real upload.
    expect([...url.searchParams.keys()].join(",")).not.toMatch(/checksum/i);
    expect(target.method).toBe("PUT");
    expect(target.headers).toEqual({ "Content-Type": "application/pdf" });
  });

  it("opens a file as a short signed link that fixes how it is served", async () => {
    const storage = new S3DocumentStorage(client(), "docs");
    const source = await storage.open({
      key: "documents/abc.html",
      contentType: "text/html; charset=utf-8",
      disposition: 'inline; filename="a.html"',
      expiresInSeconds: 60,
    });

    expect(source.kind).toBe("redirect");
    if (source.kind !== "redirect") return;
    const url = new URL(source.url);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("60");
    expect(url.searchParams.get("response-content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(url.searchParams.get("response-content-disposition")).toBe(
      'inline; filename="a.html"',
    );
  });

  it("reports a stored object's size, and null when it is missing", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ ContentLength: 42 })
      .mockRejectedValueOnce(
        Object.assign(new Error("nope"), {
          name: "NotFound",
          $metadata: { httpStatusCode: 404 },
        }),
      );
    const storage = new S3DocumentStorage({ send } as never, "docs");

    await expect(storage.stat("documents/a.pdf")).resolves.toEqual({
      size: 42,
    });
    await expect(storage.stat("documents/b.pdf")).resolves.toBeNull();
  });

  it("does not hide other storage errors as 'missing'", async () => {
    const send = vi.fn().mockRejectedValue(
      Object.assign(new Error("denied"), {
        name: "AccessDenied",
        $metadata: { httpStatusCode: 403 },
      }),
    );
    const storage = new S3DocumentStorage({ send } as never, "docs");
    await expect(storage.stat("documents/a.pdf")).rejects.toThrow("denied");
  });

  it("stores and deletes by key", async () => {
    const send = vi.fn().mockResolvedValue({});
    const storage = new S3DocumentStorage({ send } as never, "docs");

    await storage.put({
      key: "documents/a.pdf",
      body: Buffer.from("x"),
      contentType: "application/pdf",
    });
    await storage.delete("documents/a.pdf");

    expect(send).toHaveBeenCalledTimes(2);
    const sent = send.mock.calls.map(
      (call) => (call[0] as { input: unknown }).input,
    );
    expect(sent[0]).toMatchObject({
      Bucket: "docs",
      Key: "documents/a.pdf",
      ContentType: "application/pdf",
    });
    expect(sent[1]).toMatchObject({
      Bucket: "docs",
      Key: "documents/a.pdf",
    });
  });
});
