// ============================================================
// CellHub Business Language Engine — public surface (I3-1)
//
// Deterministic business-question PARSER foundation. Not wired into live chat
// routing this round; exported for unit tests and the future canonical
// executor (I3-2). Computes nothing about money.
// ============================================================

export type {
  BusinessLanguage, BusinessIntent, BusinessMetric, BusinessDimension,
  DateRangeKind, ParsedDateRange, BusinessComparison, RecognizedEntity,
  ParsedBusinessQuery, RuntimeEntity, RuntimeEntitySet,
  ParseBusinessQueryOptions, NormalizedBusinessText,
} from './types';

export { parseBusinessQuery, detectBusinessLanguage } from './parseBusinessQuery';
export {
  normalizeBusinessText, foldAccents, baseNormalize, correctBusinessTypos, foldForCarrierMatch,
} from './normalizeBusinessText';
export {
  recognizeMetric, recognizeDimension, recognizeComparison,
  recognizeNamedDateRange, recognizeCustomDateRange, recognizeEntity, hasPhrase,
} from './recognizeBusinessEntities';
