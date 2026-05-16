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

export interface PaymentVerification {
  verificationId: string;
  saleId: string;
  customerName: string;
  carrier: string;
  amountCents: number;         // total of all phone_payment items
  createdAt: number;           // epoch ms
  remindAt: number;            // epoch ms — surface nudge after this
  status: 'pending' | 'confirmed' | 'dismissed';
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
}): PaymentVerification {
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
    carrier: input.carrier,
    amountCents: input.amountCents,
    createdAt: now,
    remindAt: now + REMIND_DELAY_MS,
    status: 'pending',
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
export function getDueVerification(now = Date.now()): PaymentVerification | null {
  const due = readAll()
    .filter((v) => v.status === 'pending' && v.remindAt <= now)
    .sort((a, b) => a.remindAt - b.remindAt);
  return due[0] ?? null;
}
