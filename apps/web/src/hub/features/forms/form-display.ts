import type { FormPhase, StoredAnswer } from "@kan/hub/public";
import { answerText, formImageSrc } from "@kan/hub/public";

import { copy } from "../../copy/zh";
import { toCsv } from "../../lib/csv";

const text = copy.forms;

export function phaseLabel(phase: FormPhase): string {
  if (phase.phase === "closed" && phase.reason !== "manual") {
    return text.phase[phase.reason];
  }
  return text.phase[phase.phase];
}

export function phaseTone(phase: FormPhase): "neutral" | "strong" | "alert" {
  if (phase.phase === "open") return "strong";
  if (phase.phase === "closed") return "alert";
  return "neutral";
}

export type TextPart = { text: string } | { text: string; href: string };

const URL_IN_TEXT = /https?:\/\/[^\s<>"'，。；！？、）】]+/g;

/**
 * Splits text into plain runs and web addresses, so addresses can become
 * links. Only http(s) addresses are found, so no other scheme can ever end
 * up behind a link; a trailing full stop or bracket stays outside it.
 */
export function linkParts(value: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of value.matchAll(URL_IN_TEXT)) {
    let href = match[0];
    const trailing = /[.,;:!?)\]]+$/.exec(href)?.[0] ?? "";
    href = href.slice(0, href.length - trailing.length);
    const start = match.index;
    if (start > last) parts.push({ text: value.slice(last, start) });
    parts.push({ text: href, href });
    last = start + href.length;
  }
  if (last < value.length) parts.push({ text: value.slice(last) });
  return parts;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** An ISO time as the value of an `<input type="datetime-local">`, in the browser's zone. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The value of a `datetime-local` input as an ISO time, or null when empty or invalid. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const dateTimeFormat = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDateTime(date: Date | string): string {
  return dateTimeFormat.format(new Date(date));
}

export interface ExportInput {
  title: string;
  columns: { fieldId: string; title: string; removed: boolean }[];
  items: {
    respondent: string | null;
    respondentEmail: string | null;
    signedIn: boolean;
    answers: Record<string, StoredAnswer>;
    likes: number;
    createdAt: string;
    updatedAt: string;
  }[];
}

/**
 * The answers as a CSV file: one row per answer, one column per question
 * (deleted questions last, marked). Times are in the browser's zone, as a
 * spreadsheet reads them. Pictures become links, one per line; they open for
 * people who manage the form.
 */
export function responsesCsv(input: ExportInput, origin: string): string {
  const r = text.responses;
  const header = [
    r.csvRespondent,
    r.csvEmail,
    r.csvSubmitted,
    r.csvUpdated,
    r.csvLikes,
    ...input.columns.map((column) =>
      column.removed ? `${column.title}（${r.removedQuestion}）` : column.title,
    ),
  ];
  const stamp = (value: string) => {
    const date = new Date(value);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };
  const rows = input.items.map((item) => [
    item.respondent ?? (item.signedIn ? r.deletedAccount : r.anonymous),
    item.respondentEmail ?? "",
    stamp(item.createdAt),
    item.updatedAt === item.createdAt ? "" : stamp(item.updatedAt),
    item.likes,
    ...input.columns.map((column) => {
      const answer = item.answers[column.fieldId];
      if (answer?.type === "images") {
        return answer.images
          .map((id) => `${origin}${formImageSrc(id)}`)
          .join("\n");
      }
      return answerText(answer);
    }),
  ]);
  return toCsv(header, rows);
}

/** Characters no file system takes in a name. */
// eslint-disable-next-line no-control-regex
const UNSAFE_IN_FILENAME = /[\\/:*?"<>|\u0000-\u001f]+/g;

/** A file name from the form's title, safe on every system. */
export function csvFilename(title: string, now: Date = new Date()): string {
  const safe =
    title.replace(UNSAFE_IN_FILENAME, " ").trim().slice(0, 60) || "form";
  return `${safe}-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.csv`;
}
