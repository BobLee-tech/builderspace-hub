import { copy } from "~/hub/copy/zh";

const text = copy.documents.errors;

export interface UploadTarget {
  method: "PUT";
  url: string;
  headers: Record<string, string>;
}

/**
 * Sends one file straight to where the server said to (the bucket, or in
 * development the server's own upload route). `fetch` cannot report upload
 * progress, hence XMLHttpRequest.
 */
export function sendFile(
  target: UploadTarget,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(target.method, target.url);
    for (const [name, value] of Object.entries(target.headers)) {
      request.setRequestHeader(name, value);
    }
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error(text.uploadFailed));
    };
    request.onerror = () => reject(new Error(text.network));
    request.send(file);
  });
}
