// ============================================================
// I6-C1 — LocalizedPresenter primitives (EN/ES/PT).
//
// The single localization surface for the presentation layer. Same
// tri()-based convention the approved manager presenter (formatManager.ts)
// uses. No detector, no engine, no consumer localizes anything — they all
// call through here. No internal terminology (cents / canonical / enum keys /
// fingerprint) ever appears in a returned string. ES uses tuteo, never voseo.
// ============================================================

import type { PresenterLang } from './types';

type L3 = PresenterLang;

/** Pick the localized variant. Central so every string reads the same way. */
export function tri(lang: L3, en: string, es: string, pt: string): string {
  return lang === 'es' ? es : lang === 'pt' ? pt : en;
}

/** Money display from canonical cents. Single-currency store (USD): a plain
 *  grouped `$` amount reads identically across the three languages and never
 *  leaks the cents integer. */
export function formatMoney(cents: number): string {
  const negative = cents < 0;
  const whole = Math.abs(cents) / 100;
  const grouped = whole.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${negative ? '-' : ''}$${grouped}`;
}

/** Signed percentage for display: uses a real minus sign, drops a trailing
 *  ".0", keeps one decimal otherwise. e.g. -22 → "−22%", -21.5 → "−21.5%". */
export function formatSignedPct(pct: number): string {
  const rounded = Math.round(pct * 10) / 10;
  const sign = rounded < 0 ? '−' : rounded > 0 ? '+' : '';
  const abs = Math.abs(rounded);
  const body = Number.isInteger(abs) ? String(abs) : abs.toFixed(1);
  return `${sign}${body}%`;
}

/** Unsigned whole percentage (shares, coverage): 0.812 → "81%". */
export function formatSharePct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/** A margin move expressed in PERCENTAGE POINTS (never a relative percent). */
export function formatPoints(points: number, lang: L3): string {
  const abs = Math.abs(Math.round(points * 10) / 10);
  const body = Number.isInteger(abs) ? String(abs) : abs.toFixed(1);
  const unit = tri(lang, abs === 1 ? 'point' : 'points', abs === 1 ? 'punto' : 'puntos', abs === 1 ? 'ponto' : 'pontos');
  return `${body} ${unit}`;
}

/** A whole-number count with a localized noun (singular/plural aware). */
export function formatCount(n: number, lang: L3, singularEn: string, pluralEn: string, singularEs: string, pluralEs: string, singularPt: string, pluralPt: string): string {
  const one = n === 1;
  return `${n} ${tri(lang, one ? singularEn : pluralEn, one ? singularEs : pluralEs, one ? singularPt : pluralPt)}`;
}

/** Localized long date from a canonical YMD string (deterministic — no clock). */
export function formatYMD(ymd: string, lang: L3): string {
  // YMD is 'YYYY-MM-DD'; parse as a local calendar date (noon avoids any TZ
  // rollover) purely for display formatting.
  const [y, m, d] = ymd.split('-').map((p) => parseInt(p, 10));
  if (!y || !m || !d) return ymd;
  const date = new Date(y, m - 1, d, 12, 0, 0);
  const locale = lang === 'es' ? 'es-MX' : lang === 'pt' ? 'pt-BR' : 'en-US';
  return date.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
}
