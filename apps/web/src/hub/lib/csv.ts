/**
 * Turns rows into a CSV file a spreadsheet opens correctly: UTF-8 with a byte
 * order mark (Excel reads Chinese wrongly without it), CRLF line ends, and
 * quoted cells. Pure; the page only wraps the text in a download.
 */

export type CsvCell = string | number | boolean | null | undefined;

/**
 * A spreadsheet runs a cell that starts with one of these as a formula, so a
 * visitor could plant `=HYPERLINK(…)` in a form; a leading apostrophe keeps it
 * text.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value === "string" && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: CsvCell[][]): string {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/** Hands a CSV text to the browser as a file to save. */
export function downloadCsv(filename: string, csv: string): void {
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
