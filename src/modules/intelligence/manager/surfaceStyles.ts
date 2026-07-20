// ============================================================
// Business Manager surface (I5) — shared inline-style tokens.
// Follows the Intelligence module card palette (dark, compact, desktop).
// ============================================================

import type { CSSProperties } from 'react';

export const CARD: CSSProperties = {
  background: '#111827',
  border: '1px solid #1F2937',
  borderRadius: 12,
  padding: '14px 16px',
};

export const SECTION_TITLE: CSSProperties = {
  fontSize: '0.72rem',
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: '#94a3b8',
  marginBottom: 8,
};

export const MUTED: CSSProperties = { color: '#94a3b8', fontSize: '0.8rem' };

/** Tone → colors. Neutral (unavailable/informational) is slate — never
 *  success green, never failure red. */
export const TONE_COLORS: Record<'positive' | 'warning' | 'critical' | 'neutral', { fg: string; bg: string; border: string }> = {
  positive: { fg: '#4ade80', bg: 'rgba(34,197,94,0.08)', border: 'rgba(34,197,94,0.35)' },
  warning:  { fg: '#fbbf24', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.35)' },
  critical: { fg: '#f87171', bg: 'rgba(239,68,68,0.10)', border: 'rgba(239,68,68,0.45)' },
  neutral:  { fg: '#94a3b8', bg: 'rgba(148,163,184,0.08)', border: 'rgba(148,163,184,0.30)' },
};
