import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type {
  CreateUploadInput,
  DocumentSource,
  DocumentStorage,
  UploadTarget,
} from "./storage";

export interface S3ClientSettings {
  region: string;
  /** Empty for AWS S3 itself; set for R2, MinIO, Spaces and the like. */
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}

/**
 * Our own client rather than Kan's `createS3Client`: recent SDK versions add a
 * CRC32 checksum to presigned upload URLs, computed over an empty body, which
 * makes the storage service reject every real upload. `WHEN_REQUIRED` turns
 * that off.
 */
export function createDocumentS3Client(settings: S3ClientSettings): S3Client {
  return new S3Client({
    region: settings.region,
    endpoint: settings.endpoint === "" ? undefined : settings.endpoint,
    forcePathStyle: settings.forcePathStyle ?? false,
    credentials: {
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

const isMissing = (error: unknown): boolean => {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e.name === "NotFound" ||
    e.name === "NoSuchKey" ||
    e.$metadata?.httpStatusCode === 404
  );
};

export class S3DocumentStorage implements DocumentStorage {
  readonly name = "s3" as const;

  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async createUpload(input: CreateUploadInput): Promise<UploadTarget> {
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        ContentType: input.contentType,
        // Signed: the service refuses a body of any other length.
        ContentLength: input.size,
      }),
      { expiresIn: input.expiresInSeconds },
    );
    return {
      method: "PUT",
      url,
      headers: { "Content-Type": input.contentType },
    };
  }

  async stat(key: string): Promise<{ size: number } | null> {
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return { size: head.ContentLength ?? 0 };
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async put(input: {
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
      }),
    );
  }

  async read(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!response.Body) throw new Error("Empty object body");
    return Buffer.from(await response.Body.transformToByteArray());
  }

  async open(input: {
    key: string;
    contentType: string;
    disposition: string;
    expiresInSeconds: number;
  }): Promise<DocumentSource> {
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        // What the browser is told, whatever the object was stored as.
        ResponseContentType: input.contentType,
        ResponseContentDisposition: input.disposition,
      }),
      { expiresIn: input.expiresInSeconds },
    );
    return { kind: "redirect", url };
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}
