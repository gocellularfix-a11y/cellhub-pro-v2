// ============================================================
// CellHub Business Language Engine — parser (I3-1)
//
// parseBusinessQuery(input, options?) → ParsedBusinessQuery. Deterministic,
// no money, no store data hardcoded. DESCRIBES the question; a later canonical
// executor (I3-2) computes the answer. This module is NOT wired into live chat
// routing in this foundation round.
// ============================================================

import type {
  ParsedBusinessQuery, ParseBusinessQueryOptions, BusinessLanguage,
  BusinessMetric, BusinessIntent, RecognizedEntity, BusinessComparison,
  BusinessQueryOperand, ParsedDateRange, RuntimeEntitySet,
} from './types';
import { normalizeBusinessText } from './normalizeBusinessText';
import {
  LANGUAGE_MARKERS, SUMMARIZE_TERMS, FIND_CUSTOMER_TERMS, FILTER_TERMS,
  COMPARISON_CONNECTORS_ALWAYS, COMPARISON_CONNECTORS_CONDITIONAL, COMPARE_VERBS, BARE_RANKING_TOKENS,
} from './businessDictionary';
import {
  recognizeMetric, recognizeDimension, recognizeComparison, recognizePhoneStoreConcept,
  recognizeNamedDateRange, recognizeCustomDateRange, recognizeEntity, findAllNamedDateRanges, hasPhrase,
} from './recognizeBusinessEntities';

/** Detect language deterministically from folded text via high-signal markers.
 *  Ties fall back to English. Explicit option always wins. */
export function detectBusinessLanguage(folded: string, forced?: BusinessLanguage): BusinessLanguage {
  if (forced) return forced;
  const score: Record<BusinessLanguage, number> = { en: 0, es: 0, pt: 0 };
  (['pt', 'es', 'en'] as BusinessLanguage[]).forEach((lang) => {
    for (const marker of LANGUAGE_MARKERS[lang]) if (hasPhrase(folded, marker)) score[lang] += 1;
  });
  // PT and ES share many words; break PT↔ES ties with PT-exclusive markers.
  if (score.pt > 0 && score.pt >= score.es && score.pt >= score.en) return 'pt';
  if (score.es > score.en && score.es >= score.pt) return 'es';
  if (score.es === score.en && score.es > 0 && score.pt === 0) return 'es';
  return 'en';
}

const DEFAULT_METRIC: BusinessMetric = 'gross_sales';

// ── I3-1.1: two-operand comparison detection ────────────────

/** Recognize one operand from a side of a split query. corrected preserves '&'
 *  so a carrier "at&t" resolves; phone-store concepts (repair/unlock) resolve
 *  as service/category entities. */
function recognizeOperand(side: string, entities?: RuntimeEntitySet): BusinessQueryOperand {
  const m = recognizeMetric(side)?.metric;
  const ent = recognizeEntity(side, side, entities);
  const phone = ent ? null : recognizePhoneStoreConcept(side);
  const dimension = ent?.dimension ?? phone?.dimension ?? recognizeDimension(side)?.dimension;
  const dateRange = recognizeNamedDateRange(side)?.dateRange;
  let entity: RecognizedEntity | undefined;
  if (ent) entity = ent.entity;
  else if (phone) entity = { type: phone.dimension ?? 'unknown', canonicalName: phone.concept, rawText: phone.term };
  return { metric: m, dimension, entity, dateRange };
}

/** Find the first comparison connector; CONDITIONAL ones require a compare verb. */
function findConnector(corrected: string, hasCompareVerb: boolean): string | null {
  const padded = ' ' + corrected + ' ';
  const always = [...COMPARISON_CONNECTORS_ALWAYS].sort((a, b) => b.length - a.length);
  let bestIdx = Infinity; let bestConn: string | null = null;
  for (const c of always) {
    const i = padded.indexOf(' ' + c + ' ');
    if (i >= 0 && i < bestIdx) { bestIdx = i; bestConn = c; }
  }
  if (bestConn) return bestConn;
  if (hasCompareVerb) {
    for (const c of COMPARISON_CONNECTORS_CONDITIONAL) {
      const i = padded.indexOf(' ' + c + ' ');
      if (i >= 0 && i < bestIdx) { bestIdx = i; bestConn = c; }
    }
  }
  return bestConn;
}

interface TwoOperand {
  comparison: BusinessComparison;
  operands: { left: BusinessQueryOperand; right: BusinessQueryOperand };
  dimension?: import('./types').BusinessDimension;
  topMetric?: BusinessMetric;    // set for entity/period comparisons; omitted for between_metrics
  dateRange?: ParsedDateRange;   // shared top-level date (entities/metrics only)
}

function detectTwoOperandComparison(corrected: string, entities: RuntimeEntitySet | undefined): TwoOperand | null {
  const hasCompareVerb = COMPARE_VERBS.some((v) => hasPhrase(corrected, v));
  const connector = findConnector(corrected, hasCompareVerb);
  const namedFull = recognizeNamedDateRange(corrected)?.dateRange;

  if (connector) {
    const padded = ' ' + corrected + ' ';
    const i = padded.indexOf(' ' + connector + ' ');
    const left = padded.slice(1, i).trim();
    const right = padded.slice(i + connector.length + 2).trim();
    const L = recognizeOperand(left, entities);
    const R = recognizeOperand(right, entities);
    if (L.entity && R.entity) {
      return {
        comparison: 'between_entities',
        operands: {
          left: { dimension: L.dimension, entity: L.entity },
          right: { dimension: R.dimension, entity: R.entity },
        },
        dimension: L.dimension ?? R.dimension,
        topMetric: L.metric ?? R.metric,
        dateRange: namedFull,
      };
    }
    if (L.metric && R.metric && L.metric !== R.metric) {
      return {
        comparison: 'between_metrics',
        operands: { left: { metric: L.metric }, right: { metric: R.metric } },
        dateRange: namedFull,   // e.g. "cash vs card this month"
      };
    }
    // otherwise fall through to the period check below
  }

  // Period-versus-period: two DISTINCT named ranges + a comparison context.
  const dates = findAllNamedDateRanges(corrected);
  if (dates.length >= 2 && dates[0].kind !== dates[1].kind && (connector || hasCompareVerb)) {
    return {
      comparison: 'between_periods',
      operands: {
        left: { dateRange: { kind: dates[0].kind } },
        right: { dateRange: { kind: dates[1].kind } },
      },
      topMetric: recognizeMetric(corrected)?.metric,
    };
  }
  return null;
}

export function parseBusinessQuery(input: string, options: ParseBusinessQueryOptions = {}): ParsedBusinessQuery {
  const norm = normalizeBusinessText(input, options.language);
  const sourceLanguage = detectBusinessLanguage(norm.corrected, options.language);
  const referenceDate = options.referenceDate ?? new Date();

  const assumptions: string[] = [];
  const ambiguities: string[] = [];
  const matchedTerms: string[] = [];

  // ── Recognize signals ──
  const metricRec = recognizeMetric(norm.corrected);
  const dimensionRec = recognizeDimension(norm.corrected);
  const comparisonRec = recognizeComparison(norm.corrected);
  const phoneStore = recognizePhoneStoreConcept(norm.corrected);
  const named = recognizeNamedDateRange(norm.corrected);
  const custom = recognizeCustomDateRange(norm.corrected, referenceDate);
  const entityRec = recognizeEntity(norm.normalized, norm.corrected, options.entities);

  if (metricRec) matchedTerms.push(metricRec.term);
  if (dimensionRec) matchedTerms.push(dimensionRec.term);
  if (comparisonRec) matchedTerms.push(comparisonRec.term);
  if (phoneStore) matchedTerms.push(phoneStore.term);
  if (entityRec) matchedTerms.push(entityRec.entity.rawText);
  const dateRec = custom ?? named;   // an explicit custom range beats a named one
  if (dateRec) matchedTerms.push(dateRec.term);
  for (const f of FILTER_TERMS) if (hasPhrase(norm.corrected, f)) matchedTerms.push(f);

  // ── Metric resolution + assumptions ──
  let metric: BusinessMetric | undefined = metricRec?.metric;
  if (metricRec?.isBare) {
    if (metricRec.metric === 'gross_sales') {
      assumptions.push(`Interpreted "${metricRec.term}" as gross_sales (bare term — no explicit gross/net specified).`);
    } else if (metricRec.metric === 'net_tax') {
      assumptions.push(`Interpreted "${metricRec.term}" as net_tax (bare tax term).`);
    }
  }

  // ── Dimension (prefer explicit dimension term; else a phone-store hint) ──
  let dimension = dimensionRec?.dimension ?? phoneStore?.dimension;
  // An entity resolves its own dimension (e.g. a carrier name → carrier).
  if (entityRec && !dimension) dimension = entityRec.dimension;

  // ── Two-operand comparison (I3-1.1) ──
  const twoOp = detectTwoOperandComparison(norm.corrected, options.entities);
  let comparisonOperands: { left: BusinessQueryOperand; right: BusinessQueryOperand } | undefined;
  let dateRange: ParsedDateRange | undefined = dateRec?.dateRange;

  // ── Single comparison / ranking ──
  // Guards on a BARE ranking token ("mas"/"mais"/"menos"): it must NOT rank
  // when it is part of a "more than / less than" FILTER, NOR when there is no
  // dimension to rank (I3-1.1 — "ganamos más este mes" is not a ranking).
  const hasFilterPhrase = FILTER_TERMS.some((f) => hasPhrase(norm.corrected, f));
  let effectiveComparison = comparisonRec;
  if (effectiveComparison && BARE_RANKING_TOKENS.has(effectiveComparison.term)
      && (hasFilterPhrase || !dimension)) {
    effectiveComparison = null;
  }

  let comparison: BusinessComparison | undefined = effectiveComparison?.comparison;

  if (twoOp) {
    comparison = twoOp.comparison;
    comparisonOperands = twoOp.operands;
    if (twoOp.dimension && !dimension) dimension = twoOp.dimension;
    if (twoOp.comparison === 'between_metrics') {
      metric = undefined;         // operands are authoritative — no single top metric
    } else if (twoOp.topMetric && !metricRec) {
      metric = twoOp.topMetric;   // shared metric across entities/periods
    }
    // between_periods: the two periods live in the operands, not top-level.
    dateRange = twoOp.comparison === 'between_periods' ? undefined : twoOp.dateRange;
  }

  // ── Intent inference ──
  const wantsFindCustomer = FIND_CUSTOMER_TERMS.some((t) => hasPhrase(norm.corrected, t))
    || (entityRec?.dimension === 'customer' && !metric && !effectiveComparison?.isRanking && !twoOp);
  const wantsSummarize = SUMMARIZE_TERMS.some((t) => hasPhrase(norm.corrected, t)) && !!dimension && !effectiveComparison?.isRanking && !twoOp;
  const wantsRank = !!effectiveComparison?.isRanking && !!dimension && !twoOp;
  const wantsCompare = !!twoOp || comparison === 'versus_previous_period';

  let intent: BusinessIntent;
  if (wantsFindCustomer) {
    intent = 'find_customer';
  } else if (wantsCompare) {
    intent = 'compare_metric';
  } else if (wantsRank) {
    intent = 'rank_dimension';
  } else if (wantsSummarize) {
    intent = 'summarize_dimension';
  } else if (metric) {
    intent = 'get_metric';
  } else {
    intent = 'unknown';
  }

  // Ranking / entity-or-period comparison / summarize need a metric — default
  // it if absent (never for between_metrics, whose operands ARE the metrics).
  if ((intent === 'rank_dimension' || intent === 'summarize_dimension'
       || (intent === 'compare_metric' && comparison !== 'between_metrics')) && !metric) {
    metric = DEFAULT_METRIC;
    assumptions.push('No explicit metric named; defaulted to gross_sales.');
  }

  // ── Ambiguities ──
  // carrier vs payment_provider: a bare "provider/proveedor" dimension while a
  // carrier name is also present is genuinely ambiguous.
  if (dimensionRec?.dimension === 'payment_provider'
    && ['provider', 'providers', 'proveedor', 'proveedores', 'provedor', 'provedores'].includes(dimensionRec.term)
    && entityRec?.dimension === 'carrier') {
    ambiguities.push('"provider" is ambiguous here — a carrier name was also mentioned (carrier ≠ payment provider).');
  }
  const hasAnyDate = !!dateRange || comparison === 'between_periods';
  if (intent !== 'unknown' && intent !== 'find_customer' && !hasAnyDate) {
    ambiguities.push('No date range specified — the executor should apply the product default.');
  }
  for (const f of FILTER_TERMS) {
    if (hasPhrase(norm.corrected, f)) {
      ambiguities.push(`Filter phrase "${f}" recognized but thresholds are not modeled in this foundation.`);
      break;
    }
  }

  // ── Confidence ──
  let confidence: number;
  if (intent === 'unknown') {
    confidence = metric || dimension || dateRec || comparison ? 0.2 : 0.08;
  } else {
    confidence = 0.4;
    if (metricRec) confidence += metricRec.isBare ? 0.15 : 0.25;
    else if (metric) confidence += 0.1;   // defaulted
    if (dimension) confidence += 0.15;
    if (hasAnyDate) confidence += 0.1;
    if (comparison) confidence += 0.1;
    if (entityRec) confidence += 0.08;
    if (comparisonOperands) confidence += 0.05;
    confidence = Math.min(0.98, Math.round(confidence * 100) / 100);
  }

  const entity: RecognizedEntity | undefined = entityRec?.entity;

  return {
    intent,
    metric,
    dimension,
    dateRange,
    comparison,
    comparisonOperands,
    entity,
    sourceLanguage,
    normalizedText: norm.corrected,
    confidence,
    assumptions,
    ambiguities,
    matchedTerms,
  };
}
