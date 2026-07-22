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
import { guardOnline } from '@/hooks/useOnlineStatus';
import { isElectron } from '@/utils/platform';

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

/** P0-C1b — structured outcome of requesting an external window open. */
export type ExternalOpenResult =
  | { ok: true; handle: Window | null }
  | { ok: false; reason: 'offline' | 'missing_url' | 'popup_blocked' | 'open_exception' };

/**
 * P0-C1b — open an external payment portal and REPORT what actually happened,
 * so "failed launch = no workflow" can distinguish real failures from success:
 *   - no url            → missing_url
 *   - offline           → offline (guardOnline emits the offline toast event)
 *   - window.open throws → open_exception
 *   - window.open null  → popup_blocked  (BROWSER/PWA only)
 *   - otherwise         → ok
 * Electron caveat: window.open can return null on SUCCESS in Electron, so null
 * is NOT treated as blocked there — never false-block the production desktop app.
 */
export function openExternalPortal(url: string, target?: string, features?: string): ExternalOpenResult {
  if (!url) return { ok: false, reason: 'missing_url' };
  if (!guardOnline()) return { ok: false, reason: 'offline' };
  let handle: Window | null = null;
  try {
    handle = typeof window === 'undefined' ? null : window.open(url, target, features);
  } catch {
    return { ok: false, reason: 'open_exception' };
  }
  if (handle === null && !isElectron()) return { ok: false, reason: 'popup_blocked' };
  return { ok: true, handle };
}

export type LaunchFailureReason =
  | 'no_carrier' | 'no_portal_url' | 'offline' | 'popup_blocked' | 'open_exception';

/**
 * Launch-FIRST orchestration for one external-payment attempt (pure — the open
 * function and the workflow store are injected). A workflow is created ONLY
 * after the portal launch is CONFIRMED successful. Order:
 *   validate carrier → require url → open portal → (only on ok) begin.
 * Any non-ok open result (offline / popup blocked / exception) → `begin` is
 * never called (no orphan/false workflow). Returns true when a workflow began.
 */
export function runExternalPaymentLaunch(params: {
  resolved: ResolvedPaymentPortal | null;
  open: (url: string) => ExternalOpenResult;
  begin: (portalUrl: string) => void;
  onError: (reason: LaunchFailureReason) => void;
}): boolean {
  const { resolved, open, begin, onError } = params;
  if (!resolved || !resolved.carrier) { onError('no_carrier'); return false; }
  if (!resolved.url) { onError('no_portal_url'); return false; }
  const res = open(resolved.url);
  if (!res.ok) {
    onError(res.reason === 'missing_url' ? 'no_portal_url' : res.reason);
    return false;
  }
  begin(resolved.url);
  return true;
}
