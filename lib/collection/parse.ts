// Bulk paste parser. Pure and client-safe: no Node or server imports.
import type { NewLine } from "./types.ts";

const MAX_LINES = 500;
const MAX_QUERY = 64;

export type ParseError = { line: number; reason: string };

export function parseBulkLines(text: string): { lines: NewLine[]; errors: ParseError[] } {
  const lines: NewLine[] = [];
  const errors: ParseError[] = [];
  const raw = text.replace(/^\uFEFF/, "").split(/\r?\n/);

  for (let i = 0; i < raw.length; i++) {
    const n = i + 1;
    const line = raw[i].trim();
    const clean = (s: string) => s.replace(/[\s\u3000\u00A0]+/g, " ").trim();
    if (!line) continue;

    let query = clean(line);
    let year: number | undefined;
    const cut = Math.max(line.lastIndexOf(","), line.lastIndexOf("\t"));
    if (cut >= 0) {
      query = clean(line.slice(0, cut));
      const tail = clean(line.slice(cut + 1));
      if (tail) {
        const y = /^\d+$/.test(tail) ? Number(tail) : NaN;
        if (!(y >= 1890 && y <= 2100)) {
          errors.push({ line: n, reason: "year must be 1890–2100" });
          continue;
        }
        year = y;
      }
    }
    if (!query) {
      errors.push({ line: n, reason: "missing catalog number" });
      continue;
    }
    if (query.length > MAX_QUERY) {
      errors.push({ line: n, reason: `catalog number is longer than ${MAX_QUERY} characters` });
      continue;
    }
    if (lines.length >= MAX_LINES) {
      errors.push({ line: n, reason: `only the first ${MAX_LINES} records are added` });
      break;
    }
    lines.push(year === undefined ? { query } : { query, year });
  }
  return { lines, errors };
}
