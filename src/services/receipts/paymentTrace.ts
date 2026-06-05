// ============================================================
// CellHub Pro — Payment Trace for Layaway & Special Order receipts
// R-PAYMENT-TRACE-RECEIPTS-LAYAWAY-SPECIAL-ORDER-V1
//
// Pure logic + a self-contained HTML renderer. NO React, NO DOM, NO I/O.
// Builds a "PAYMENT TRACE" (+ optional "PAYMENT HISTORY") block from values
// the receipt ALREADY computed — it never recomputes money, tax, or balances,
// so it cannot change any financial math. Display/audit only.
//
// Layaway → full trace + per-payment history (payments[] exists).
// Special Order → summary trace only (no per-payment history stored).
// ============================================================

export type PaymentTraceRowType = 'deposit' | 'payment' | 'final';

export interface PaymentTraceRow {
  /** Pre-formatted, locale date string (or '' when unknown → fallback shown). */
  date: string;
  type: PaymentTraceRowType;
  /** Method label as stored (or '' when unknown → fallback shown). */
  method: string;
  amountCents: number;
}

export interface PaymentTrace {
  originalTotalCents: number;
  previousPaymentsCents: number;
  paymentTodayCents: number;
  totalPaidCents: number;
  balanceBeforeCents: number;
  balanceAfterCents: number;
  paymentCount: number;
  isPaid: boolean;
  /** Whether a per-payment history exists (layaway) vs summary-only (SO). */
  hasToday: boolean;
  history: PaymentTraceRow[];
}

export interface BuildPaymentTraceInput {
  /** Order/agreement total the receipt shows (incl. tax if the receipt includes it). */
  originalTotalCents: number;
  /** Total paid so far, as the receipt already computed it. */
  totalPaidCents: number;
  /** Remaining balance, as the receipt already computed it. */
  balanceAfterCents: number;
  /** Per-payment rows (layaway). Empty for Special Order. */
  history?: PaymentTraceRow[];
  /**
   * When there is no history but a single payment was just made (e.g. a
   * Special Order deposit, or a brand-new layaway in agreement state before
   * payments[] is populated), pass that amount so the trace can still show a
   * meaningful "Payment Today". Ignored when `history` is non-empty.
   */
  fallbackTodayCents?: number;
}

const c = (n: unknown): number => {
  const v = Math.round(Number(n) || 0);
  return Number.isFinite(v) ? v : 0;
};

/**
 * Structure the trace from already-computed receipt values. Pure arithmetic on
 * the passed cents — no balance/tax recomputation.
 */
export function buildPaymentTrace(input: BuildPaymentTraceInput): PaymentTrace {
  const originalTotalCents = c(input.originalTotalCents);
  const totalPaidCents = c(input.totalPaidCents);
  const balanceAfterCents = Math.max(0, c(input.balanceAfterCents));
  const history = (input.history ?? []).map((r) => ({ ...r, amountCents: c(r.amountCents) }));

  let paymentTodayCents: number;
  let paymentCount: number;
  let hasToday: boolean;

  if (history.length > 0) {
    // The most recent row is "today's" payment (receipts print right after it).
    paymentTodayCents = history[history.length - 1].amountCents;
    paymentCount = history.length;
    hasToday = true;
  } else if (c(input.fallbackTodayCents) > 0) {
    paymentTodayCents = c(input.fallbackTodayCents);
    paymentCount = 1;
    hasToday = true;
  } else {
    paymentTodayCents = 0;
    paymentCount = 0;
    hasToday = false;
  }

  const previousPaymentsCents = Math.max(0, totalPaidCents - paymentTodayCents);
  const balanceBeforeCents = Math.max(0, originalTotalCents - previousPaymentsCents);

  return {
    originalTotalCents,
    previousPaymentsCents,
    paymentTodayCents,
    totalPaidCents,
    balanceBeforeCents,
    balanceAfterCents,
    paymentCount,
    isPaid: balanceAfterCents <= 0,
    hasToday,
    history,
  };
}

// ── HTML renderer (inline styles → works inside both receipt templates) ──

export interface PaymentTraceI18n {
  title: string;
  originalTotal: string;
  previousPayments: string;
  paymentToday: string;
  totalPaid: string;
  balanceBefore: string;
  balanceAfter: string;
  paymentCount: string;
  statusLabel: string;
  statusPaid: string;
  statusBalanceDue: string;
  historyTitle: string;
  typeDeposit: string;
  typePayment: string;
  typeFinal: string;
  unknownMethod: string;
  dateUnavailable: string;
}

/**
 * Render the PAYMENT TRACE (+ PAYMENT HISTORY when rows exist) as a
 * self-contained HTML string. `esc` escapes any interpolated user text;
 * `money` formats cents → display string. Both come from the calling receipt
 * so formatting matches the rest of the ticket.
 */
export function renderPaymentTraceHtml(
  trace: PaymentTrace,
  i18n: PaymentTraceI18n,
  esc: (s: unknown) => string,
  money: (cents: number) => string,
): string {
  const lbl = 'font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#666;border-bottom:1px solid #ccc;padding-bottom:1px;margin:6px 0 3px';
  const row = 'display:flex;justify-content:space-between;margin-bottom:1px;font-size:11px';
  const k = 'color:#444';
  const v = 'font-weight:600';

  const line = (label: string, value: string, strong = false) =>
    `<div style="${row}${strong ? ';font-weight:800' : ''}"><span style="${k}">${esc(label)}</span><span style="${v}">${esc(value)}</span></div>`;

  const parts: string[] = [`<div style="${lbl}">${esc(i18n.title)}</div>`];
  parts.push(line(i18n.originalTotal, money(trace.originalTotalCents)));
  if (trace.previousPaymentsCents > 0 || trace.hasToday) parts.push(line(i18n.previousPayments, money(trace.previousPaymentsCents)));
  if (trace.hasToday) parts.push(line(i18n.paymentToday, money(trace.paymentTodayCents)));
  parts.push(line(i18n.totalPaid, money(trace.totalPaidCents)));
  if (trace.hasToday) parts.push(line(i18n.balanceBefore, money(trace.balanceBeforeCents)));
  parts.push(line(i18n.balanceAfter, money(trace.balanceAfterCents), true));
  if (trace.paymentCount > 0) parts.push(line(i18n.paymentCount, String(trace.paymentCount)));
  parts.push(line(i18n.statusLabel, trace.isPaid ? i18n.statusPaid : i18n.statusBalanceDue, true));

  if (trace.history.length > 0) {
    const typeLabel = (t: PaymentTraceRowType) =>
      t === 'deposit' ? i18n.typeDeposit : t === 'final' ? i18n.typeFinal : i18n.typePayment;
    parts.push(`<div style="${lbl}">${esc(i18n.historyTitle)}</div>`);
    trace.history.forEach((r, i) => {
      const date = r.date && r.date.trim() ? r.date : i18n.dateUnavailable;
      const method = r.method && r.method.trim() ? r.method : i18n.unknownMethod;
      parts.push(
        `<div style="font-size:10px;margin-bottom:1px">${i + 1}. ${esc(date)} — ${esc(typeLabel(r.type))} — ${esc(method)} — ${esc(money(r.amountCents))}</div>`,
      );
    });
  }

  return `<div style="margin:4px 0">${parts.join('')}</div>`;
}

/** Build the i18n label bundle from a receipt translator (`receipt.trace.*`). */
export function paymentTraceI18n(t: (key: string) => string): PaymentTraceI18n {
  return {
    title:            t('receipt.trace.title'),
    originalTotal:    t('receipt.trace.originalTotal'),
    previousPayments: t('receipt.trace.previousPayments'),
    paymentToday:     t('receipt.trace.paymentToday'),
    totalPaid:        t('receipt.trace.totalPaid'),
    balanceBefore:    t('receipt.trace.balanceBefore'),
    balanceAfter:     t('receipt.trace.balanceAfter'),
    paymentCount:     t('receipt.trace.paymentCount'),
    statusLabel:      t('receipt.trace.statusLabel'),
    statusPaid:       t('receipt.trace.statusPaid'),
    statusBalanceDue: t('receipt.trace.statusBalanceDue'),
    historyTitle:     t('receipt.trace.historyTitle'),
    typeDeposit:      t('receipt.trace.typeDeposit'),
    typePayment:      t('receipt.trace.typePayment'),
    typeFinal:        t('receipt.trace.typeFinal'),
    unknownMethod:    t('receipt.trace.unknownMethod'),
    dateUnavailable:  t('receipt.trace.dateUnavailable'),
  };
}

// ── History-row helpers ──────────────────────────────────────

/**
 * Classify ordered payment rows into deposit / payment / final. The first row
 * is the deposit; the last row is "final" only when the balance reached zero.
 */
export function classifyHistoryRows(
  rows: Array<{ date: string; method: string; amountCents: number }>,
  isPaid: boolean,
): PaymentTraceRow[] {
  return rows.map((r, i) => {
    let type: PaymentTraceRowType = 'payment';
    if (i === 0) type = 'deposit';
    if (i === rows.length - 1 && isPaid && rows.length > 1) type = 'final';
    // single fully-paid record stays 'deposit' unless it's clearly a final-only
    if (rows.length === 1 && isPaid) type = 'deposit';
    return { date: r.date, type, method: r.method, amountCents: r.amountCents };
  });
}
