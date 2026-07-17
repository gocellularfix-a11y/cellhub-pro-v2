// ============================================================
// CellHub Business Language Engine — recognition (I3-1)
//
// Deterministic recognizers over normalized/folded text. Longest matching
// phrase wins (multi-word concepts beat bare terms). Runtime entities
// (configured carriers/providers/employees/categories/stores/customers) are
// resolved when supplied; well-known carriers resolve via a static alias set
// so carrier ≠ payment_provider is never conflated. No money, no store data
// hardcoded (Go Cellular is never referenced).
// ============================================================

import type {
  BusinessMetric, BusinessDimension, DateRangeKind, BusinessComparison,
  ParsedDateRange, RecognizedEntity, RuntimeEntitySet, RuntimeEntity,
} from './types';
import {
  METRIC_TERMS, BARE_METRIC_TERMS, DIMENSION_TERMS, DATE_RANGE_TERMS,
  COMPARISON_TERMS, RANKING_COMPARISONS, PHONE_STORE_CONCEPTS, MONTH_NAMES,
} from './businessDictionary';
import { foldAccents } from './normalizeBusinessText';

/** Whole-phrase presence test on space-normalized text (word-boundary safe). */
export function hasPhrase(text: string, phrase: string): boolean {
  if (!phrase) return false;
  return (' ' + text + ' ').includes(' ' + phrase + ' ');
}

interface Match<T> { value: T; term: string; length: number }

/** Longest matching term across all groups (multi-word beats bare). */
function matchLongest<T>(text: string, groups: ReadonlyArray<{ value: T; terms: string[] }>): Match<T> | null {
  let best: Match<T> | null = null;
  for (const g of groups) {
    for (const term of g.terms) {
      if (hasPhrase(text, term) && (!best || term.length > best.length)) {
        best = { value: g.value, term, length: term.length };
      }
    }
  }
  return best;
}

// ── Metric ──────────────────────────────────────────────────
export interface MetricRecognition { metric: BusinessMetric; term: string; isBare: boolean }
export function recognizeMetric(corrected: string): MetricRecognition | null {
  const m = matchLongest(corrected, METRIC_TERMS as ReadonlyArray<{ value: BusinessMetric; terms: string[] }>);
  if (!m) return null;
  return { metric: m.value, term: m.term, isBare: BARE_METRIC_TERMS.has(m.term) };
}

// ── Dimension ───────────────────────────────────────────────
export interface DimensionRecognition { dimension: BusinessDimension; term: string }
export function recognizeDimension(corrected: string): DimensionRecognition | null {
  const d = matchLongest(corrected, DIMENSION_TERMS as ReadonlyArray<{ value: BusinessDimension; terms: string[] }>);
  return d ? { dimension: d.value, term: d.term } : null;
}

// ── Comparison ──────────────────────────────────────────────
export interface ComparisonRecognition { comparison: BusinessComparison; term: string; isRanking: boolean }
export function recognizeComparison(corrected: string): ComparisonRecognition | null {
  const c = matchLongest(corrected, COMPARISON_TERMS as ReadonlyArray<{ value: BusinessComparison; terms: string[] }>);
  return c ? { comparison: c.value, term: c.term, isRanking: RANKING_COMPARISONS.has(c.value) } : null;
}

// ── Phone-store concept (dimension hint) ────────────────────
export interface PhoneStoreRecognition { concept: string; dimension?: BusinessDimension; term: string }
export function recognizePhoneStoreConcept(corrected: string): PhoneStoreRecognition | null {
  let best: PhoneStoreRecognition & { length: number } | null = null;
  for (const c of PHONE_STORE_CONCEPTS) {
    for (const term of c.terms) {
      if (hasPhrase(corrected, term) && (!best || term.length > best.length)) {
        best = { concept: c.concept, dimension: c.dimension, term, length: term.length };
      }
    }
  }
  if (!best) return null;
  return { concept: best.concept, dimension: best.dimension, term: best.term };
}

// ── Date range (named + explicit custom) ────────────────────
export interface DateRangeRecognition { dateRange: ParsedDateRange; term: string }

/** Well-known named ranges. */
export function recognizeNamedDateRange(corrected: string): DateRangeRecognition | null {
  const d = matchLongest(corrected, DATE_RANGE_TERMS as ReadonlyArray<{ value: DateRangeKind; terms: string[] }>);
  return d ? { dateRange: { kind: d.value }, term: d.term } : null;
}

const MONTH_ALT = Object.keys(MONTH_NAMES).sort((a, b) => b.length - a.length).join('|');
const RANGE_CONNECTOR = /\b(to|through|thru|until|al|a|hasta|ate)\b|-/;

function pad2(n: number): string { return String(n).padStart(2, '0'); }
/** Local days-in-month (no UTC): new Date(year, month, 0) → last day of `month`. */
function daysInMonth(year: number, month: number): number { return new Date(year, month, 0).getDate(); }
function validDate(year: number, month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

interface DatePoint { month?: number; day: number; year?: number; idx: number }

// EN: "july 1" / "july 1, 2025" / "july 1 2025"
const EN_POINT = new RegExp(`(${MONTH_ALT})\\s+(\\d{1,2})(?:\\s*,?\\s*(\\d{4}))?`, 'g');
// ES/PT: "1 de julio" / "1 de julio de 2025"  AND bare "1" (shared-month form "del 1 al 15 de julio")
const ES_PT_POINT = new RegExp(`(\\d{1,2})(?:\\s+de\\s+(${MONTH_ALT})(?:\\s+de\\s+(\\d{4}))?)?`, 'g');

/** I3-1.1: explicit custom range across EN/ES/PT with optional explicit years
 *  and shared month/year. Date-only ISO (YYYY-MM-DD), local calendar days, no
 *  UTC. Explicit year wins over referenceDate; a single trailing year applies
 *  to the whole range. Impossible dates are REJECTED (returns null). */
export function recognizeCustomDateRange(corrected: string, referenceDate: Date): DateRangeRecognition | null {
  if (!RANGE_CONNECTOR.test(corrected)) return null;
  const refYear = referenceDate.getFullYear();
  const points: DatePoint[] = [];
  let mm: RegExpExecArray | null;

  const en = new RegExp(EN_POINT.source, 'g');
  while ((mm = en.exec(corrected)) !== null) {
    points.push({ month: MONTH_NAMES[mm[1]], day: parseInt(mm[2], 10), year: mm[3] ? parseInt(mm[3], 10) : undefined, idx: mm.index });
  }
  if (points.length < 2) {
    // ES/PT day-first form (may share a month across both days).
    points.length = 0;
    const esp = new RegExp(ES_PT_POINT.source, 'g');
    while ((mm = esp.exec(corrected)) !== null) {
      const day = parseInt(mm[1], 10);
      if (day < 1 || day > 31) continue;
      points.push({ day, month: mm[2] ? MONTH_NAMES[mm[2]] : undefined, year: mm[3] ? parseInt(mm[3], 10) : undefined, idx: mm.index });
    }
  }
  if (points.length < 2) return null;
  points.sort((a, b) => a.idx - b.idx);
  const s = points[0]; const e = points[1];

  // Shared month/year fallback (e.g. "del 1 al 15 de julio de 2025").
  const sMonth = s.month ?? e.month;
  const eMonth = e.month ?? s.month;
  const sYear = s.year ?? e.year ?? refYear;
  const eYear = e.year ?? s.year ?? refYear;
  if (sMonth === undefined || eMonth === undefined) return null;
  if (!validDate(sYear, sMonth, s.day) || !validDate(eYear, eMonth, e.day)) return null;

  return {
    dateRange: {
      kind: 'custom',
      startDate: `${sYear}-${pad2(sMonth)}-${pad2(s.day)}`,
      endDate: `${eYear}-${pad2(eMonth)}-${pad2(e.day)}`,
    },
    term: 'custom range',
  };
}

/** I3-1.1: all named date ranges present, in order of appearance — used to
 *  detect period-versus-period ("this month ... last month"). */
export function findAllNamedDateRanges(corrected: string): Array<{ kind: DateRangeKind; idx: number }> {
  const found: Array<{ kind: DateRangeKind; idx: number; length: number }> = [];
  for (const g of DATE_RANGE_TERMS) {
    for (const term of g.terms) {
      const i = (' ' + corrected + ' ').indexOf(' ' + term + ' ');
      if (i >= 0) found.push({ kind: g.value, idx: i, length: term.length });
    }
  }
  // De-duplicate overlapping matches, keeping the longest per position; then
  // collapse to distinct kinds in order.
  found.sort((a, b) => a.idx - b.idx || b.length - a.length);
  const out: Array<{ kind: DateRangeKind; idx: number }> = [];
  const seen = new Set<DateRangeKind>();
  for (const f of found) {
    if (seen.has(f.kind)) continue;
    seen.add(f.kind);
    out.push({ kind: f.kind, idx: f.idx });
  }
  return out.sort((a, b) => a.idx - b.idx);
}

// ── Runtime + well-known carrier entity resolution ──────────
// Static well-known carrier aliases (folded/normalized). Carriers ONLY — never
// payment providers. Configured carriers/providers arrive via RuntimeEntitySet.
const KNOWN_CARRIERS: ReadonlyArray<{ canonical: string; aliases: string[] }> = [
  { canonical: 'AT&T', aliases: ['at&t', 'at and t', 'atandt', 'att'] },
  { canonical: 'Verizon', aliases: ['verizon'] },
  { canonical: 'T-Mobile', aliases: ['t-mobile', 't mobile', 'tmobile'] },
  { canonical: 'Cricket', aliases: ['cricket'] },
  { canonical: 'H2O', aliases: ['h2o', 'h2o wireless'] },
  { canonical: 'Simple Mobile', aliases: ['simple mobile', 'simplemobile'] },
  { canonical: 'Page Plus', aliases: ['page plus', 'pageplus'] },
  { canonical: 'Tracfone', aliases: ['tracfone', 'trac fone'] },
  { canonical: 'Boost Mobile', aliases: ['boost', 'boost mobile'] },
  { canonical: 'Metro by T-Mobile', aliases: ['metro', 'metropcs', 'metro pcs'] },
  { canonical: 'Mint Mobile', aliases: ['mint', 'mint mobile'] },
  { canonical: 'Ultra Mobile', aliases: ['ultra mobile', 'ultramobile'] },
];

function matchRuntimeSet(text: string, set: RuntimeEntity[] | undefined, type: BusinessDimension): RecognizedEntity | null {
  if (!set || set.length === 0) return null;
  let best: (RecognizedEntity & { length: number }) | null = null;
  for (const ent of set) {
    const candidates = [ent.name, ...(ent.aliases || [])];
    for (const cand of candidates) {
      const folded = foldAccents(String(cand || '').toLowerCase()).trim();
      if (folded && hasPhrase(text, folded) && (!best || folded.length > best.length)) {
        best = { type, canonicalId: ent.id, canonicalName: ent.name, rawText: cand, length: folded.length };
      }
    }
  }
  if (!best) return null;
  const { length: _l, ...rest } = best;
  void _l;
  return rest;
}

/** Resolve an entity reference. `normalized` keeps '&' (for "at&t"); `corrected`
 *  is folded. Runtime entities win over the static carrier set. */
export function recognizeEntity(
  normalized: string,
  corrected: string,
  entities?: RuntimeEntitySet,
): { entity: RecognizedEntity; dimension: BusinessDimension } | null {
  // Runtime entities first (configured store data), most-specific dimensions first.
  const order: Array<[RuntimeEntity[] | undefined, BusinessDimension]> = [
    [entities?.paymentProviders, 'payment_provider'],
    [entities?.carriers, 'carrier'],
    [entities?.employees, 'employee'],
    [entities?.customers, 'customer'],
    [entities?.categories, 'category'],
    [entities?.products, 'product'],
    [entities?.stores, 'store'],
  ];
  for (const [set, type] of order) {
    const hit = matchRuntimeSet(corrected, set, type);
    if (hit) return { entity: hit, dimension: type };
  }
  // Well-known carriers (static aliases). Check '&'-preserving + folded text.
  let best: { canonical: string; alias: string; length: number } | null = null;
  for (const c of KNOWN_CARRIERS) {
    for (const alias of c.aliases) {
      const inNorm = hasPhrase(normalized, alias);
      const inFold = hasPhrase(corrected, foldAccents(alias));
      if ((inNorm || inFold) && (!best || alias.length > best.length)) {
        best = { canonical: c.canonical, alias, length: alias.length };
      }
    }
  }
  if (best) {
    return {
      entity: { type: 'carrier', canonicalName: best.canonical, rawText: best.alias },
      dimension: 'carrier',
    };
  }
  return null;
}
