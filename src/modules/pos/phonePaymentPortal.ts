// ============================================================
// P0-C1 — Canonical phone-payment portal resolver (pure, deterministic).
//
// THE single source of truth for "which portal will open for this carrier".
// Before this, the modal kept TWO independent facts — a decorative `portal`
// highlight and a URL resolved separately from settings.carrierPortalUrls[
// carrier] — which could disagree (UI showed H2O while Verizon WebPOS opened).
// Every consumer (display label, visual selection, launch handler, workflow
// metadata) now derives from ONE ResolvedPaymentPortal so the shown portal
// and the launched portal can never diverge.
//
// No React, no side effects — unit-testable in the node test env.
// ============================================================

import type { PaymentPortal } from '@/config/paymentPortals';
import { getActivePortals } from '@/config/paymentPortals';
import { normalizeCarrier } from '@/utils/normalize';

/** Structured resolution — replaces the bare portal-id string. */
export interface ResolvedPaymentPortal {
  /** '' when no portal matches the carrier. */
  portalId: string;
  /** '' when no portal matches. */
  label: string;
  /** '' when no URL is configured for this carrier. */
  url: string;
  /** Normalized carrier this resolution belongs to. */
  carrier: string;
}

/** Alphanumeric-only lowercase key (collision-safe comparison base). */
function normKey(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Match a carrier to a portal id, collision-safe:
 *   Pass 1 — exact normalized equality (e.g. 'verizon' === 'verizon').
 *   Pass 2 — substring, but the LONGEST matching keyword wins, so a more
 *            specific carrier keyword beats a shorter accidental fragment.
 *   Pass 3 — configured-URL signature fallback.
 * Returns '' when nothing matches (unknown/blank carrier → no portal).
 */
export function matchPortalId(
  carrier: string,
  portals: PaymentPortal[],
  carrierPortalUrls: Record<string, string> = {},
): string {
  const target = normKey(carrier);
  if (!target) return '';

  // Pass 1 — exact keyword equality.
  for (const p of portals) {
    if (p.matchCarriers.some((m) => normKey(m) === target)) return p.id;
  }
  // Pass 2 — substring; longest keyword wins (most specific).
  let best = { id: '', len: 0 };
  for (const p of portals) {
    for (const m of p.matchCarriers) {
      const k = normKey(m);
      if (k && target.includes(k) && k.length > best.len) best = { id: p.id, len: k.length };
    }
  }
  if (best.id) return best.id;
  // Pass 3 — URL signature fallback (settings may key the URL under raw or
  // normalized carrier; try both).
  const rawUrl = normKey(carrierPortalUrls[carrier] || carrierPortalUrls[normalizeCarrier(carrier)] || '');
  if (rawUrl) {
    for (const p of portals) {
      if (p.matchUrlSnippets.some((s) => rawUrl.includes(normKey(s)))) return p.id;
    }
  }
  return '';
}

/**
 * Resolve the canonical portal for a carrier. `null` only when the carrier is
 * blank. A non-null result with portalId '' means "carrier known but no
 * configured portal" (still carries any URL found).
 */
export function resolvePaymentPortal(
  rawCarrier: string,
  portals: PaymentPortal[],
  carrierPortalUrls: Record<string, string> = {},
): ResolvedPaymentPortal | null {
  const carrier = normalizeCarrier(rawCarrier);
  if (!carrier) return null;
  const portalId = matchPortalId(carrier, portals, carrierPortalUrls);
  const portal = portals.find((p) => p.id === portalId) || null;
  // URL resolution fixes the historic raw-vs-normalized key mismatch: try the
  // normalized carrier first, then the raw string the caller passed.
  const url = carrierPortalUrls[carrier] || carrierPortalUrls[rawCarrier] || '';
  return { portalId: portal?.id ?? '', label: portal?.label ?? '', url, carrier };
}

/** Convenience: resolve straight from settings (single call site pattern). */
export function resolvePortalFromSettings(
  rawCarrier: string,
  settings: unknown,
): ResolvedPaymentPortal | null {
  const s = settings as { paymentPortals?: PaymentPortal[]; carrierPortalUrls?: Record<string, string> };
  return resolvePaymentPortal(rawCarrier, getActivePortals(settings), s?.carrierPortalUrls || {});
}

/**
 * Deterministic idempotency key for one external-payment ATTEMPT. Same
 * (customer, phone, amount, portal) while a workflow is still pending →
 * reuse it (dedupe rapid double-clicks / focus returns). A legitimate later
 * payment for the same number reuses this key only if the earlier workflow is
 * still active; once it completes/cancels a fresh workflow is created. NOT
 * keyed on phone alone (a valid repeat payment can reuse a number).
 */
export function paymentAttemptKey(a: {
  customerId?: string | null;
  phoneNumber: string;
  amountCents: number;
  portalId: string;
}): string {
  return [a.customerId || 'walkin', normKey(a.phoneNumber), Math.round(a.amountCents || 0), a.portalId || 'none'].join('|');
}

export type LaunchFailureReason = 'no_carrier' | 'no_portal_url' | 'launch_failed';

/**
 * Launch-FIRST orchestration for one external-payment attempt (pure — DOM and
 * the workflow store are injected). A workflow is created ONLY after the portal
 * launch is successfully requested. `open` returns false when the popup was
 * blocked / unavailable → `begin` is never called (no orphan workflow). Order:
 *   validate carrier → require url → open portal → (only on success) begin.
 * Returns true when a workflow was begun.
 */
export function runExternalPaymentLaunch(params: {
  resolved: ResolvedPaymentPortal | null;
  open: (url: string) => boolean;
  begin: (portalUrl: string) => void;
  onError: (reason: LaunchFailureReason) => void;
}): boolean {
  const { resolved, open, begin, onError } = params;
  if (!resolved || !resolved.carrier) { onError('no_carrier'); return false; }
  if (!resolved.url) { onError('no_portal_url'); return false; }
  const launched = open(resolved.url);
  if (!launched) { onError('launch_failed'); return false; }
  begin(resolved.url);
  return true;
}
