// ============================================================
// CellHub Business Language Engine — deterministic normalization (I3-1)
//
// Pure, deterministic, testable. Lowercases, unifies apostrophes/quotes,
// strips currency symbols and punctuation, collapses whitespace, folds
// accents for matching, and applies a CONTROLLED business-typo layer. The
// ORIGINAL input is always preserved; nothing here destroys values entity
// matching needs (carrier tokens are handled in entity recognition).
// ============================================================

import type { BusinessLanguage, NormalizedBusinessText } from './types';

/** Fold accents/diacritics: á→a, é→e, í→i, ó→o, ú→u, ü→u, ñ→n, ç→c, ã→a, õ→o.
 *  Decompose (NFD) then strip the combining-marks block U+0300–U+036F. */
export function foldAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Base normalization: lowercase, unify unicode apostrophes/quotes to ',
 *  strip currency symbols, replace punctuation (except & and -) with spaces,
 *  collapse whitespace. Keeps & and - so "at&t" / "t-mobile" survive for the
 *  carrier layer; entity recognition folds those further. */
export function baseNormalize(input: string): string {
  let s = String(input || '').toLowerCase();
  // Unify apostrophes / quotes.
  s = s.replace(/[‘’ʼ`´]/g, "'").replace(/[“”]/g, '"');
  // Strip currency symbols and the percent sign spacing artifacts.
  s = s.replace(/[$€£¥₡₱]/g, ' ');
  // Inverted marks and terminal punctuation → space. Keep & and - (carriers).
  s = s.replace(/[¿?¡!.,;:()[\]{}"/\\|=+*_<>@#]/g, ' ');
  // Collapse whitespace.
  return s.replace(/\s+/g, ' ').trim();
}

/** CONTROLLED business-typo aliases. Deterministic word-boundary rewrites of a
 *  SMALL, high-value set of business terms only — never unrestricted fuzzy
 *  matching (which could turn unrelated words into financial intents). Runs on
 *  accent-folded text so it sees "ganacia" the same in any accented spelling. */
const BUSINESS_TYPO_ALIASES: ReadonlyArray<readonly [RegExp, string]> = [
  // English
  [/\brevnue\b/g, 'revenue'],
  [/\brevenu\b/g, 'revenue'],
  [/\bprofitt\b/g, 'profit'],
  [/\bproft\b/g, 'profit'],
  [/\btransations\b/g, 'transactions'],
  [/\btransactons\b/g, 'transactions'],
  [/\bcustmer\b/g, 'customer'],
  [/\bcustmers\b/g, 'customers'],
  // Spanish
  [/\bganacia\b/g, 'ganancia'],
  [/\bganancias\b/g, 'ganancia'],
  [/\bgananica\b/g, 'ganancia'],
  [/\bdevolucioens\b/g, 'devoluciones'],
  [/\bdevolucones\b/g, 'devoluciones'],
  [/\bprovedor\b/g, 'proveedor'],   // ES: provedor → proveedor
  [/\bventass\b/g, 'ventas'],
  // Portuguese (accent-folded forms)
  [/\btransacoes\b/g, 'transacoes'],   // already folded target
  [/\btransacaos\b/g, 'transacoes'],
  [/\bvendass\b/g, 'vendas'],
  [/\blcro\b/g, 'lucro'],
];

/** Apply the controlled typo layer to accent-folded text. */
export function correctBusinessTypos(folded: string): string {
  let q = folded;
  for (const [re, to] of BUSINESS_TYPO_ALIASES) q = q.replace(re, to);
  return q.replace(/\s+/g, ' ').trim();
}

/** Full normalization pipeline. `language` is accepted for future
 *  language-specific rules but the current layers are language-agnostic
 *  (folding + a controlled alias set covering EN/ES/PT). */
export function normalizeBusinessText(input: string, _language?: BusinessLanguage): NormalizedBusinessText {
  void _language;
  const original = String(input || '');
  const normalized = baseNormalize(original);
  const folded = foldAccents(normalized);
  const corrected = correctBusinessTypos(folded);
  return { original, normalized, folded, corrected };
}

/** A carrier-punctuation folded token stream: removes &, -, spaces so
 *  "at&t" / "at and t" / "a t and t" → "atandt"-ish and "t-mobile"/"t mobile"/
 *  "tmobile" collapse. Used ONLY by entity recognition for carrier matching —
 *  never mutates the parser's normalizedText. */
export function foldForCarrierMatch(folded: string): string {
  return folded
    .replace(/\band\b/g, '')       // "at and t" → "at  t"
    .replace(/[^a-z0-9]/g, '');    // drop &, -, spaces, etc.
}
