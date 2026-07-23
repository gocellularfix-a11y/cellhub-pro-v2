// ============================================================
// CellHub Pro — Store Credit Center view-model (P1-SC-CENTER)
//
// Pure derivations for the Store Credit Center module: summary cards,
// row filtering/search/sorting, source resolution and the append-only
// ledger timeline. NO React, NO persistence, NO new business math — every
// money figure is read from the canonical StoreCreditLedger fields that
// ledger.ts / reverse.ts maintain.
// ============================================================

import type { StoreCreditLedger } from '@/store/types';

// ── Summary ───────────────────────────────────────────────

export interface CenterSummary {
  outstandingLiabilityCents: number;  // remaining on ACTIVE certificates only
  totalIssuedCents: number;           // historical issuance (immutable amounts)
  totalRedeemedCents: number;         // NET redeemed (canonical reversal model)
  totalReversedCents: number;         // value restored by void reversals
  activeCount: number;
  fullyRedeemedCount: number;
  voidedCount: number;
  totalCount: number;
}

/** Deterministic aggregate over the canonical ledger. */
export function buildCenterSummary(ledger: StoreCreditLedger[] | null | undefined): CenterSummary {
  const s: CenterSummary = {
    outstandingLiabilityCents: 0, totalIssuedCents: 0, totalRedeemedCents: 0,
    totalReversedCents: 0, activeCount: 0, fullyRedeemedCount: 0, voidedCount: 0, totalCount: 0,
  };
  if (!Array.isArray(ledger)) return s;
  for (const l of ledger) {
    s.totalCount++;
    s.totalIssuedCents += l.issuedAmount || 0;
    s.totalRedeemedCents += l.redeemedAmount || 0;   // already NET of reversals (P0-SC-2)
    s.totalReversedCents += (l.reversals || []).reduce((sum, r) => sum + (r.restoredAmount || 0), 0);
    if (l.status === 'active') {
      s.activeCount++;
      s.outstandingLiabilityCents += Math.max(0, l.remainingAmount || 0);
    } else if (l.status === 'redeemed') {
      s.fullyRedeemedCount++;
    } else if (l.status === 'voided') {
      s.voidedCount++;
      // Voided/expired balances are frozen — NOT active liability.
    }
  }
  return s;
}

// ── Source resolution ─────────────────────────────────────

export type CertificateSource = 'return' | 'unknown';

/**
 * Resolve the issuance source from PERSISTED evidence only. Today the only
 * evidence the ledger records is the source return link — anything else is
 * displayed as Unknown rather than invented.
 */
export function resolveCertificateSource(entry: StoreCreditLedger): CertificateSource {
  if (entry.sourceReturnId || entry.sourceReturnNumber) return 'return';
  return 'unknown';
}

// ── Timeline (append-only statement) ──────────────────────

export interface TimelineEvent {
  kind: 'issuance' | 'redemption' | 'reversal' | 'void';
  atIso: string;
  /** Signed cents from the certificate's point of view (+ adds value, − removes). */
  deltaCents: number;
  employeeName?: string;
  /** Sale invoice / original sale / reason — whatever the persisted record holds. */
  reference?: string;
  referenceId?: string;
}

/**
 * Build the certificate's statement strictly from persisted movements —
 * no reconstructed events. Chronological (ties keep persisted order:
 * issuance → redemptions → reversals → void).
 */
export function buildCertificateTimeline(entry: StoreCreditLedger): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  events.push({
    kind: 'issuance',
    atIso: entry.issuedAt || '',
    deltaCents: entry.issuedAmount || 0,
    employeeName: entry.issuedByEmployeeName,
    reference: entry.sourceReturnNumber || undefined,
    referenceId: entry.sourceReturnId || undefined,
  });
  for (const r of entry.redemptions || []) {
    events.push({
      kind: 'redemption',
      atIso: r.redeemedAt || '',
      deltaCents: -(r.redeemedAmount || 0),
      employeeName: r.employeeName,
      reference: r.invoiceNumber || undefined,
      referenceId: r.saleId || undefined,
    });
  }
  for (const rv of entry.reversals || []) {
    events.push({
      kind: 'reversal',
      atIso: rv.reversedAt || '',
      deltaCents: rv.restoredAmount || 0,
      employeeName: rv.employeeName,
      reference: rv.originalInvoiceNumber || rv.reversalReference || undefined,
      referenceId: rv.originalSaleId || undefined,
    });
  }
  if (entry.status === 'voided') {
    events.push({
      kind: 'void',
      atIso: entry.voidedAt || '',
      deltaCents: 0,
      employeeName: entry.voidedByEmployeeName,
      reference: entry.voidReason || undefined,
    });
  }
  return events.sort((a, b) => String(a.atIso).localeCompare(String(b.atIso)));
}

/** Last movement timestamp for the table's "Last Activity" column. */
export function lastActivityIso(entry: StoreCreditLedger): string {
  let last = entry.issuedAt || '';
  for (const r of entry.redemptions || []) if (String(r.redeemedAt || '') > last) last = r.redeemedAt;
  for (const rv of entry.reversals || []) if (String(rv.reversedAt || '') > last) last = rv.reversedAt;
  if (entry.voidedAt && String(entry.voidedAt) > last) last = entry.voidedAt;
  return last;
}

// ── Filtering / search / sorting ──────────────────────────

export type CenterStatusFilter = 'all' | 'active' | 'redeemed' | 'voided' | 'expired' | 'hasRemaining' | 'zeroBalance';
export type CenterSort =
  | 'newest' | 'oldest' | 'highestRemaining' | 'lowestRemaining'
  | 'customer' | 'certificate' | 'lastActivity';

export interface CenterQuery {
  search?: string;
  status?: CenterStatusFilter;
  dateFrom?: string;   // YYYY-MM-DD (issued date, inclusive)
  dateTo?: string;     // YYYY-MM-DD (issued date, inclusive)
  employee?: string;   // issuedBy exact-insensitive match
  source?: CertificateSource | 'all';
  sort?: CenterSort;
}

function matchesSearch(entry: StoreCreditLedger, qRaw: string): boolean {
  const q = qRaw.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D/g, '');
  if ((entry.certificateNumber || '').toLowerCase().includes(q)) return true;
  if ((entry.customerName || '').toLowerCase().includes(q)) return true;
  if ((entry.customerId || '').toLowerCase() === q) return true;
  if (digits.length >= 4 && (entry.customerPhone || '').replace(/\D/g, '').includes(digits)) return true;
  if ((entry.issuedByEmployeeName || '').toLowerCase().includes(q)) return true;
  if ((entry.sourceReturnNumber || '').toLowerCase().includes(q)) return true;
  if ((entry.sourceReturnId || '').toLowerCase() === q) return true;
  for (const r of entry.redemptions || []) {
    if ((r.invoiceNumber || '').toLowerCase().includes(q)) return true;
    if ((r.saleId || '').toLowerCase() === q) return true;
  }
  return false;
}

function matchesStatus(entry: StoreCreditLedger, f: CenterStatusFilter): boolean {
  switch (f) {
    case 'all': return true;
    case 'active': return entry.status === 'active';
    case 'redeemed': return entry.status === 'redeemed';
    case 'voided': return entry.status === 'voided';
    case 'expired': return entry.status === 'expired';
    case 'hasRemaining': return (entry.remainingAmount || 0) > 0;
    case 'zeroBalance': return (entry.remainingAmount || 0) === 0;
    default: return true;
  }
}

/** Filter + sort the (already store-scoped) ledger for the main table. */
export function queryCenterRows(
  ledger: StoreCreditLedger[] | null | undefined,
  q: CenterQuery,
): StoreCreditLedger[] {
  if (!Array.isArray(ledger)) return [];
  let rows = ledger.filter((l) => matchesStatus(l, q.status || 'all'));
  if (q.search) rows = rows.filter((l) => matchesSearch(l, q.search!));
  if (q.dateFrom) rows = rows.filter((l) => String(l.issuedAt || '').slice(0, 10) >= q.dateFrom!);
  if (q.dateTo) rows = rows.filter((l) => String(l.issuedAt || '').slice(0, 10) <= q.dateTo!);
  if (q.employee) {
    const e = q.employee.trim().toLowerCase();
    rows = rows.filter((l) => (l.issuedByEmployeeName || '').toLowerCase() === e);
  }
  if (q.source && q.source !== 'all') rows = rows.filter((l) => resolveCertificateSource(l) === q.source);

  const sort = q.sort || 'newest';
  const byIssued = (a: StoreCreditLedger, b: StoreCreditLedger) => String(a.issuedAt || '').localeCompare(String(b.issuedAt || ''));
  const sorted = [...rows];
  switch (sort) {
    case 'newest': sorted.sort((a, b) => byIssued(b, a)); break;
    case 'oldest': sorted.sort(byIssued); break;
    case 'highestRemaining': sorted.sort((a, b) => (b.remainingAmount || 0) - (a.remainingAmount || 0)); break;
    case 'lowestRemaining': sorted.sort((a, b) => (a.remainingAmount || 0) - (b.remainingAmount || 0)); break;
    case 'customer': sorted.sort((a, b) => (a.customerName || '').localeCompare(b.customerName || '')); break;
    case 'certificate': sorted.sort((a, b) => (a.certificateNumber || '').localeCompare(b.certificateNumber || '')); break;
    case 'lastActivity': sorted.sort((a, b) => lastActivityIso(b).localeCompare(lastActivityIso(a))); break;
  }
  return sorted;
}

// ── CSV export ────────────────────────────────────────────

const CSV_HEADER = [
  'Certificate', 'Customer', 'Phone', 'Original Amount', 'Redeemed', 'Remaining',
  'Status', 'Source', 'Source Reference', 'Issued By', 'Store', 'Issued Date', 'Last Activity',
];

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Deterministic CSV for the current (filtered) rows. Amounts in dollars. */
export function buildLedgerCsv(rows: StoreCreditLedger[]): string {
  const lines = [CSV_HEADER.join(',')];
  for (const l of rows) {
    lines.push([
      csvCell(l.certificateNumber),
      csvCell(l.customerName),
      csvCell(l.customerPhone || ''),
      ((l.issuedAmount || 0) / 100).toFixed(2),
      ((l.redeemedAmount || 0) / 100).toFixed(2),
      ((l.remainingAmount || 0) / 100).toFixed(2),
      csvCell(l.status),
      csvCell(resolveCertificateSource(l)),
      csvCell(l.sourceReturnNumber || ''),
      csvCell(l.issuedByEmployeeName || ''),
      csvCell(l.storeId || ''),
      csvCell(String(l.issuedAt || '').slice(0, 10)),
      csvCell(lastActivityIso(l).slice(0, 10)),
    ].join(','));
  }
  return lines.join('\n');
}
