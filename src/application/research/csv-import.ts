import type { ResearchRequest } from "@/domain/research/directive";

/** RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF, BOM). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

const COLUMN_ALIASES: Record<string, string[]> = {
  body: ["body", "text", "content", "review", "comment", "本文", "内容", "コメント", "レビュー"],
  title: ["title", "タイトル", "件名"],
  url: ["url", "link", "source_url", "リンク"],
  sourceName: ["source", "source_name", "出典", "ソース"],
  publishedAt: ["published_at", "date", "created_at", "日付", "投稿日"],
  country: ["country", "国"],
  language: ["language", "lang", "言語"],
};

export type CsvImportResult = { items: NonNullable<ResearchRequest["manualItems"]>; skipped: number; errors: string[] };

/**
 * CSV → manual import items. Requires a header row with a body/text column.
 * Invalid rows are skipped and counted (never silently).
 */
export function csvToManualItems(text: string, fileName = "CSV import", maxRows = 200): CsvImportResult {
  const rows = parseCsv(text);
  if (rows.length < 2) return { items: [], skipped: 0, errors: ["CSVにヘッダー行とデータ行が必要です"] };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (key: string) => header.findIndex((h) => COLUMN_ALIASES[key].includes(h));
  const idx = Object.fromEntries(Object.keys(COLUMN_ALIASES).map((k) => [k, col(k)])) as Record<string, number>;
  if (idx.body < 0) return { items: [], skipped: rows.length - 1, errors: ["本文列（body / text / 本文 など）が見つかりません"] };

  const items: CsvImportResult["items"] = [];
  const errors: string[] = [];
  let skipped = 0;
  for (const [n, r] of rows.slice(1).entries()) {
    const get = (k: string) => (idx[k] >= 0 ? (r[idx[k]] ?? "").trim() : "");
    const body = get("body");
    if (!body) {
      skipped++;
      continue;
    }
    if (items.length >= maxRows) {
      skipped++;
      continue;
    }
    const date = get("publishedAt");
    const parsedDate = date ? new Date(date) : null;
    const url = get("url");
    let validUrl: string | undefined;
    try {
      validUrl = url && /^https?:\/\//.test(url) ? new URL(url).toString() : undefined;
    } catch {
      validUrl = undefined;
    }
    if (url && !validUrl) errors.push(`行${n + 2}: URLを無視しました`);
    items.push({
      body: body.slice(0, 20000),
      title: get("title").slice(0, 300) || undefined,
      url: validUrl,
      sourceName: (get("sourceName") || fileName).slice(0, 120),
      publishedAt: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : undefined,
      country: get("country").toUpperCase().slice(0, 10) || undefined,
      language: get("language").toLowerCase().slice(0, 10) || undefined,
    });
  }
  return { items, skipped, errors };
}
