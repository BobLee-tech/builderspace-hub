/** "1.4 MB": file sizes for people, in binary units like the OS file browser. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded =
    value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

const dateFormat = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

export function formatDate(date: Date | string): string {
  return dateFormat.format(new Date(date));
}

/** Where a document's bytes are shown or saved from. */
export function documentFileUrl(
  publicId: string,
  mode: "view" | "download" = "view",
): string {
  const base = `/api/hub/documents/${encodeURIComponent(publicId)}/file`;
  return mode === "download" ? `${base}?mode=download` : base;
}

/** `/documents`, optionally inside a folder. */
export function documentsHref(folderPublicId?: string | null): string {
  return folderPublicId
    ? `/documents?folder=${encodeURIComponent(folderPublicId)}`
    : "/documents";
}

export function documentHref(publicId: string): string {
  return `/documents/${encodeURIComponent(publicId)}`;
}
