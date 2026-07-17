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
  BusinessMetric, BusinessIntent, RecognizedEntity,
} from './types';
import { normalizeBusinessText } from './normalizeBusinessText';
import { LANGUAGE_MARKERS, SUMMARIZE_TERMS, FIND_CUSTOMER_TERMS, FILTER_TERMS } from './businessDictionary';
import {
  recognizeMetric, recognizeDimension, recognizeComparison, recognizePhoneStoreConcept,
  recognizeNamedDateRange, recognizeCustomDateRange, recognizeEntity, hasPhrase,
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

  // ── Comparison ──
  // Guard: a BARE ranking token ("mas"/"mais"/"menos") that is actually part
  // of a "more than / less than" FILTER ("mas de 100") must NOT rank.
  const hasFilterPhrase = FILTER_TERMS.some((f) => hasPhrase(norm.corrected, f));
  const BARE_RANKING = new Set(['mas', 'mais', 'menos']);
  let effectiveComparison = comparisonRec;
  if (effectiveComparison && BARE_RANKING.has(effectiveComparison.term) && hasFilterPhrase) {
    effectiveComparison = null;
  }
  const comparison = effectiveComparison?.comparison;

  // ── Intent inference ──
  const wantsFindCustomer = FIND_CUSTOMER_TERMS.some((t) => hasPhrase(norm.corrected, t))
    || (entityRec?.dimension === 'customer' && !metric && !effectiveComparison?.isRanking);
  const wantsSummarize = SUMMARIZE_TERMS.some((t) => hasPhrase(norm.corrected, t)) && !!dimension && !effectiveComparison?.isRanking;
  const wantsRank = !!effectiveComparison?.isRanking && !!dimension;
  const wantsCompare = comparison === 'versus_previous_period' || comparison === 'between_periods';

  let intent: BusinessIntent;
  if (wantsFindCustomer) {
    intent = 'find_customer';
  } else if (wantsRank) {
    intent = 'rank_dimension';
  } else if (wantsCompare) {
    intent = 'compare_metric';
  } else if (wantsSummarize) {
    intent = 'summarize_dimension';
  } else if (metric) {
    intent = 'get_metric';
  } else {
    intent = 'unknown';
  }

  // Ranking / comparison / summarize need a metric — default it if absent.
  if ((intent === 'rank_dimension' || intent === 'compare_metric' || intent === 'summarize_dimension') && !metric) {
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
  if (intent !== 'unknown' && intent !== 'find_customer' && !dateRec) {
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
    if (dateRec) confidence += 0.1;
    if (comparison) confidence += 0.1;
    if (entityRec) confidence += 0.08;
    confidence = Math.min(0.98, Math.round(confidence * 100) / 100);
  }

  const entity: RecognizedEntity | undefined = entityRec?.entity;

  return {
    intent,
    metric,
    dimension,
    dateRange: dateRec?.dateRange,
    comparison,
    entity,
    sourceLanguage,
    normalizedText: norm.corrected,
    confidence,
    assumptions,
    ambiguities,
    matchedTerms,
  };
}
