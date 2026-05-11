// ============================================================
// CellHub Pro — Companion Store Status Emitter
// (R-COMPANION-STORE-STATUS-EMITTERS-V1)
//
// Shell-only helper functions. The desktop app has NO real open /
// closed state machine today — `StoreSettings.businessHours` is just
// a free-text label for receipts, not a runtime status. These
// helpers exist so a future producer (e.g. a manual "Open Store" /
// "Close Store" toggle, or a daily-summary action) can emit
// Companion events through one typed entry point.
//
// Cero UI wiring. Cero producers in this round. Cero networking.
// Payloads carry operational status only — never sales totals,
// payment data, customer data, or employee PII.
// ============================================================

import { emit } from '../companionEventBus';
import type { CompanionStoreStatusPayload } from '../companionTypes';

const DEFAULT_SOURCE = 'desktop';

export interface StoreStatusEmitInput {
  /** Stable id for this status change. Caller supplies one
   *  (generateId() from @/utils/dates is the canonical helper). */
  statusId: string;
  /** Required for emitStoreStatusUpdated; auto-set by emitStoreOpened
   *  / emitStoreClosed. */
  status?: 'open' | 'closed' | 'unknown';
  /** Optional override; defaults to 'desktop'. */
  source?: string;
  /** Optional ms epoch override; defaults to Date.now(). */
  updatedAt?: number;
  /** Short non-sensitive reason — diagnostics only. */
  reason?: string;
  storeId?: string;
  /** Optional operational counters — counts only, never PII / money. */
  cashiersOnShift?: number;
  ringingPosCount?: number;
}

/**
 * Emit STORE_OPENED. Use from any future producer that signals the
 * store moving from closed/unknown → open.
 */
export function emitStoreOpened(input: StoreStatusEmitInput): void {
  emit({
    type: 'STORE_OPENED',
    category: 'store_status',
    payload: buildPayload({ ...input, status: 'open' }),
    createdAt: Date.now(),
  });
}

/** Emit STORE_CLOSED. Future producers: end-of-day close action. */
export function emitStoreClosed(input: StoreStatusEmitInput): void {
  emit({
    type: 'STORE_CLOSED',
    category: 'store_status',
    payload: buildPayload({ ...input, status: 'closed' }),
    createdAt: Date.now(),
  });
}

/**
 * Emit STORE_STATUS_UPDATED — general purpose. Caller sets status
 * explicitly. Useful when reflecting an external state read (e.g.
 * "we don't actually know" → status='unknown' for a future poll).
 */
export function emitStoreStatusUpdated(input: StoreStatusEmitInput): void {
  emit({
    type: 'STORE_STATUS_UPDATED',
    category: 'store_status',
    payload: buildPayload(input),
    createdAt: Date.now(),
  });
}

// ── Internal ─────────────────────────────────────────────

function buildPayload(input: StoreStatusEmitInput): CompanionStoreStatusPayload {
  const out: CompanionStoreStatusPayload = {
    statusId: input.statusId,
    status: input.status ?? 'unknown',
    source: input.source ?? DEFAULT_SOURCE,
    updatedAt: input.updatedAt ?? Date.now(),
  };
  if (input.reason)                              out.reason = input.reason;
  if (input.storeId)                             out.storeId = input.storeId;
  if (typeof input.cashiersOnShift === 'number') out.cashiersOnShift = input.cashiersOnShift;
  if (typeof input.ringingPosCount === 'number') out.ringingPosCount = input.ringingPosCount;
  return out;
}
