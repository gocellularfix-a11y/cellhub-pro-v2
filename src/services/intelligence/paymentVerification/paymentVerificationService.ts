// ============================================================
// CellHub Intelligence — External Payment Verification
// R-INTELLIGENCE-PAYMENT-VERIFY-V1
//
// Human-only reminder to confirm phone portal payments.
// NO changes to sale data, payment math, or statuses.
// Fire-and-forget: cashier is reminded 2 min after checkout.
// ============================================================

const STORAGE_KEY = 'cellhub:intelligence:paymentVerifications:v1';
const REMIND_DELAY_MS = 2 * 60 * 1000;   // 2 minutes
const MAX_RECORDS     = 100;

// R-EXTERNAL-PAYMENT-ONLY-NUDGE-GUARD: the nudge exists ONLY for payments
// whose completion happens on an EXTERNAL portal (carrier bill, top-up
// provider, etc.). Cash, card, store credit, layaway direct payment,
// exchange credit, refunds, and any other internal POS payment must NEVER
// trigger this reminder — they are recorded fully inside the POS at sale
// time and have nothing left for the cashier to confirm out-of-band.
// This allowlist is enforced at BOTH the creation and display layers as
// defense-in-depth, so adding a new external portal type in the future
// is a single-line change here, not a hunt across modules.
export type PaymentVerificationSource =
  | 'phone_payment'      // carrier bill paid via carrier web portal
  | 'top_up'             // international top-up sent via provider portal
  | 'external_portal';   // generic fallback for future external sources

const ALLOWED_SOURCES: ReadonlySet<PaymentVerificationSource> = new Set([
  'phone_payment',
  'top_up',
  'external_portal',
]);

export function isAllowedVerificationSource(s: unknown): s is PaymentVerificationSource {
  return typeof s === 'string' && ALLOWED_SOURCES.has(s as PaymentVerificationSource);
}

export interface PaymentVerification {
  verificationId: string;
  saleId: string;
  customerName: string;
  carrier: string;
  amountCents: number;         // total of all phone_payment items
  createdAt: number;           // epoch ms
  remindAt: number;            // epoch ms — surface nudge after this
  status: 'pending' | 'confirmed' | 'dismissed';
  // R-EXTERNAL-PAYMENT-ONLY-NUDGE-GUARD: explicit source tag so display
  // and any future consumer can re-verify scope without trusting the
  // caller. Optional so legacy records (pre-guard) still load — they
  // default to 'phone_payment' since that was the only original trigger.
  source?: PaymentVerificationSource;
}

// ── Storage helpers ───────────────────────────────────────

function readAll(): PaymentVerification[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function writeAll(items: PaymentVerification[]): void {
  // Keep newest MAX_RECORDS, purge oldest terminal items first
  const pending   = items.filter((i) => i.status === 'pending');
  const terminal  = items
    .filter((i) => i.status !== 'pending')
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_RECORDS - pending.length);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...pending, ...terminal]));
  } catch { /* quota — best-effort */ }
}

// ── Public API ────────────────────────────────────────────

export function addVerification(input: {
  saleId: string;
  customerName: string;
  carrier: string;
  amountCents: number;
  /**
   * R-EXTERNAL-PAYMENT-ONLY-NUDGE-GUARD: REQUIRED for new callers — kept
   * optional in the signature for backward compatibility with the original
   * POSModule call site. Omitted → defaults to 'phone_payment'. ANY value
   * outside ALLOWED_SOURCES is rejected (function returns null and writes
   * nothing). This is the canonical scope guard: cash / card / store credit
   * / layaway / refund / internal POS payments must never get a verification
   * record, regardless of where they're created.
   */
  source?: PaymentVerificationSource;
}): PaymentVerification | null {
  const source: PaymentVerificationSource = input.source ?? 'phone_payment';
  // Scope guard — silently no-op for non-external sources.
  if (!isAllowedVerificationSource(source)) return null;
  // Defensive: a phone_payment record without any carrier identity is
  // almost certainly an internal/manual entry, NOT a true external portal
  // payment. Refuse to mint a reminder for those — keeps the cash drawer
  // free of misleading nudges.
  const cleanCarrier = String(input.carrier || '').trim();
  if (source === 'phone_payment' && !cleanCarrier) return null;
  // amountCents must be a positive integer — otherwise the nudge would
  // show $0.00 and confuse the cashier.
  if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) return null;

  const now = Date.now();
  const all = readAll();

  // Dedup: if a pending verification for this saleId already exists, skip.
  if (all.some((v) => v.saleId === input.saleId && v.status === 'pending')) {
    return all.find((v) => v.saleId === input.saleId && v.status === 'pending')!;
  }

  const v: PaymentVerification = {
    verificationId: `pv-${now}-${Math.random().toString(36).slice(2, 6)}`,
    saleId: input.saleId,
    customerName: input.customerName,
    carrier: cleanCarrier,
    amountCents: Math.round(input.amountCents),
    createdAt: now,
    remindAt: now + REMIND_DELAY_MS,
    status: 'pending',
    source,
  };

  writeAll([v, ...all]);
  return v;
}

export function confirmVerification(verificationId: string): void {
  const all = readAll();
  const idx = all.findIndex((v) => v.verificationId === verificationId);
  if (idx < 0) return;
  all[idx] = { ...all[idx], status: 'confirmed' };
  writeAll(all);
}

export function dismissVerification(verificationId: string): void {
  const all = readAll();
  const idx = all.findIndex((v) => v.verificationId === verificationId);
  if (idx < 0) return;
  all[idx] = { ...all[idx], status: 'dismissed' };
  writeAll(all);
}

export function rescheduleVerification(verificationId: string): void {
  const all = readAll();
  const idx = all.findIndex((v) => v.verificationId === verificationId);
  if (idx < 0) return;
  all[idx] = { ...all[idx], remindAt: Date.now() + REMIND_DELAY_MS };
  writeAll(all);
}

// Returns the single pending verification whose remindAt has passed,
// sorted by oldest remindAt first (most overdue = highest priority).
//
// R-EXTERNAL-PAYMENT-ONLY-NUDGE-GUARD: enforce the allowlist a second time
// at read so any pre-guard records written by older callers (no `source`
// field) are still shown only when they fall back to an allowed type, and
// so any future bug that writes a stray source can never reach the UI.
// Legacy rows without `source` are treated as 'phone_payment' (the only
// original creation path).
export function getDueVerification(now = Date.now()): PaymentVerification | null {
  const due = readAll()
    .filter((v) => {
      if (v.status !== 'pending') return false;
      if (v.remindAt > now) return false;
      const src = (v.source ?? 'phone_payment') as PaymentVerificationSource;
      return isAllowedVerificationSource(src);
    })
    .sort((a, b) => a.remindAt - b.remindAt);
  return due[0] ?? null;
}
