// ============================================================
// R-2.1.4-PRINT-PAGES — canonical page-range parser.
// Single source of truth for the print pipeline's "Custom range…" input.
// Used by PrintPreviewModal (validation + IPC payload); the Electron main
// process re-normalizes defensively in electron/printPages.js.
//
// Contract:
//   - Input: user text like "1", "2-3", "1,3-4", tolerant of whitespace.
//   - Output ranges are 1-BASED inclusive, sorted ascending, with duplicates
//     and overlapping/adjacent ranges merged ("2,1-2,3" → [{1,3}]).
//   - Page 0, negatives, reversed subranges ("4-2"), non-numeric input and
//     EMPTY input are rejected with a specific error code — an invalid
//     selection must never fall back to printing the complete document.
// ============================================================

export interface PageRange {
  from: number; // 1-based, inclusive
  to: number;   // 1-based, inclusive
}

export type PageRangeError = 'empty' | 'syntax' | 'zero' | 'negative' | 'reversed';

export type PageRangeParseResult =
  | { ok: true; ranges: PageRange[] }
  | { ok: false; error: PageRangeError };

const SEGMENT_RE = /^(\d+)(?:\s*-\s*(\d+))?$/;

export function parsePageRanges(input: string): PageRangeParseResult {
  const trimmed = String(input ?? '').trim();
  if (!trimmed) return { ok: false, error: 'empty' };

  const raw: PageRange[] = [];
  for (const part of trimmed.split(',')) {
    const seg = part.trim();
    if (!seg) return { ok: false, error: 'syntax' };
    // Explicit negative detection before the generic syntax check so the
    // user gets the precise reason ("-2" or "2--3" style input).
    if (seg.includes('-') && /(^|[-,\s])-\s*\d/.test(seg) && !SEGMENT_RE.test(seg)) {
      return { ok: false, error: 'negative' };
    }
    const m = seg.match(SEGMENT_RE);
    if (!m) return { ok: false, error: 'syntax' };
    const from = parseInt(m[1], 10);
    const to = m[2] !== undefined ? parseInt(m[2], 10) : from;
    if (from === 0 || to === 0) return { ok: false, error: 'zero' };
    if (to < from) return { ok: false, error: 'reversed' };
    raw.push({ from, to });
  }
  if (raw.length === 0) return { ok: false, error: 'empty' };

  // Normalize: sort ascending, merge overlapping AND adjacent ranges,
  // which also dedupes repeated pages.
  raw.sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: PageRange[] = [];
  for (const r of raw) {
    const last = merged[merged.length - 1];
    if (last && r.from <= last.to + 1) {
      if (r.to > last.to) last.to = r.to;
    } else {
      merged.push({ ...r });
    }
  }
  return { ok: true, ranges: merged };
}

/** 1-based pages in `ranges` that exceed `pageCount` (empty = all in bounds). */
export function pagesBeyondCount(ranges: PageRange[], pageCount: number): number[] {
  const out: number[] = [];
  for (const r of ranges) {
    for (let p = Math.max(r.from, pageCount + 1); p <= r.to; p++) out.push(p);
  }
  return out;
}

/** Total number of selected pages (ranges must be normalized). */
export function countSelectedPages(ranges: PageRange[]): number {
  return ranges.reduce((s, r) => s + (r.to - r.from + 1), 0);
}

/** printToPDF `pageRanges` string form — 1-based, e.g. "1,3-4". */
export function toPrintToPdfRangeString(ranges: PageRange[]): string {
  return ranges.map((r) => (r.from === r.to ? String(r.from) : `${r.from}-${r.to}`)).join(',');
}
