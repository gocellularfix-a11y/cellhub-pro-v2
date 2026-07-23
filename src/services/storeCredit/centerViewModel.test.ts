// ============================================================
// P1-SC-CENTER — view-model tests
// Summary math (reversal-aware), source never invented, timeline
// append-only from persisted movements, filter/search/sort determinism.
// ============================================================
import { describe, it, expect } from 'vitest';
import type { StoreCreditLedger } from '@/store/types';
import {
  buildCenterSummary, resolveCertificateSource, buildCertificateTimeline,
  lastActivityIso, queryCenterRows, buildLedgerCsv,
} from './centerViewModel';

function cert(over: Partial<StoreCreditLedger> = {}): StoreCreditLedger {
  return {
    id: 'L1', certificateNumber: 'SC-1', customerId: 'c1', customerName: 'Jorge O',
    customerPhone: '8055551234', issuedAmount: 23270, redeemedAmount: 0, remainingAmount: 23270,
    status: 'active', issuedAt: '2026-07-01T10:00:00.000Z', issuedByEmployeeName: 'Ana',
    redemptions: [], ...over,
  } as StoreCreditLedger;
}

describe('buildCenterSummary', () => {
  it('separates liability (active remaining) from historical issuance and NET redemption', () => {
    const active = cert({
      redeemedAmount: 6300, remainingAmount: 16970,
      redemptions: [{ id: 'r1', redeemedAt: '2026-07-02T00:00:00.000Z', redeemedAmount: 6300, remainingAfter: 16970, saleId: 's1', employeeName: 'E' }],
    });
    const reversed = cert({
      id: 'L2', certificateNumber: 'SC-2', issuedAmount: 5000, redeemedAmount: 0, remainingAmount: 5000,
      redemptions: [{ id: 'r2', redeemedAt: '2026-07-03T00:00:00.000Z', redeemedAmount: 2185, remainingAfter: 2815, saleId: 's2', employeeName: 'E' }],
      reversals: [{ id: 'v1', reversedAt: '2026-07-04T00:00:00.000Z', restoredAmount: 2185, originalSaleId: 's2', employeeName: 'M' }],
    });
    const voided = cert({ id: 'L3', certificateNumber: 'SC-3', issuedAmount: 1000, status: 'voided', remainingAmount: 0 });
    const depleted = cert({ id: 'L4', certificateNumber: 'SC-4', issuedAmount: 2000, redeemedAmount: 2000, remainingAmount: 0, status: 'redeemed' });

    const s = buildCenterSummary([active, reversed, voided, depleted]);
    expect(s.totalIssuedCents).toBe(23270 + 5000 + 1000 + 2000);   // historical, immutable
    expect(s.outstandingLiabilityCents).toBe(16970 + 5000);         // ACTIVE remaining only
    expect(s.totalRedeemedCents).toBe(6300 + 0 + 0 + 2000);         // NET of reversals
    expect(s.totalReversedCents).toBe(2185);
    expect(s.activeCount).toBe(2);
    expect(s.fullyRedeemedCount).toBe(1);
    expect(s.voidedCount).toBe(1);
    // Voided remaining is frozen — never counted as liability.
  });
});

describe('resolveCertificateSource', () => {
  it('uses persisted evidence only — Unknown instead of inventing', () => {
    expect(resolveCertificateSource(cert({ sourceReturnNumber: 'RET-1' }))).toBe('return');
    expect(resolveCertificateSource(cert({ sourceReturnId: 'ret-id' }))).toBe('return');
    expect(resolveCertificateSource(cert())).toBe('unknown');
  });
});

describe('buildCertificateTimeline', () => {
  it('renders only persisted movements, chronologically, with correct signs', () => {
    const entry = cert({
      redeemedAmount: 4115, remainingAmount: 19155, status: 'active',
      redemptions: [{ id: 'r1', redeemedAt: '2026-07-02T00:00:00.000Z', redeemedAmount: 2185, remainingAfter: 21085, saleId: 's1', invoiceNumber: 'INV-1', employeeName: 'E' },
                    { id: 'r2', redeemedAt: '2026-07-05T00:00:00.000Z', redeemedAmount: 4115, remainingAfter: 16970, saleId: 's2', invoiceNumber: 'INV-2', employeeName: 'E' }],
      reversals: [{ id: 'v1', reversedAt: '2026-07-06T00:00:00.000Z', restoredAmount: 2185, originalSaleId: 's1', originalInvoiceNumber: 'INV-1', employeeName: 'M' }],
    });
    const tl = buildCertificateTimeline(entry);
    expect(tl.map((e) => e.kind)).toEqual(['issuance', 'redemption', 'redemption', 'reversal']);
    expect(tl[0].deltaCents).toBe(23270);
    expect(tl[1].deltaCents).toBe(-2185);
    expect(tl[3].deltaCents).toBe(2185);
    expect(tl[3].referenceId).toBe('s1');
    // No fabricated void event on a non-voided cert.
    expect(tl.some((e) => e.kind === 'void')).toBe(false);
  });

  it('includes the void event only when the certificate is actually voided', () => {
    const tl = buildCertificateTimeline(cert({ status: 'voided', voidedAt: '2026-07-09T00:00:00.000Z', voidedByEmployeeName: 'M', voidReason: 'lost' }));
    const voidEv = tl.find((e) => e.kind === 'void')!;
    expect(voidEv).toBeDefined();
    expect(voidEv.reference).toBe('lost');
  });
});

describe('queryCenterRows', () => {
  const a = cert({ id: 'A', certificateNumber: 'SC-AAA', customerName: 'Ana López', issuedAt: '2026-07-01T00:00:00.000Z', remainingAmount: 100 });
  const b = cert({
    id: 'B', certificateNumber: 'SC-BBB', customerName: 'Bruno Reyes', issuedAt: '2026-07-05T00:00:00.000Z',
    remainingAmount: 5000, issuedByEmployeeName: 'Luis', sourceReturnNumber: 'RET-9',
    redemptions: [{ id: 'r', redeemedAt: '2026-07-06T00:00:00.000Z', redeemedAmount: 1, remainingAfter: 4999, saleId: 'sX', invoiceNumber: 'INV-777', employeeName: 'Luis' }],
  });
  const c = cert({ id: 'C', certificateNumber: 'SC-CCC', customerName: 'Carla', issuedAt: '2026-07-03T00:00:00.000Z', status: 'voided', remainingAmount: 0 });

  it('searches across certificate, customer, phone, invoice, return and employee', () => {
    expect(queryCenterRows([a, b, c], { search: 'sc-bbb' }).map((r) => r.id)).toEqual(['B']);
    expect(queryCenterRows([a, b, c], { search: 'bruno' }).map((r) => r.id)).toEqual(['B']);
    expect(queryCenterRows([a, b, c], { search: 'INV-777' }).map((r) => r.id)).toEqual(['B']);
    expect(queryCenterRows([a, b, c], { search: 'RET-9' }).map((r) => r.id)).toEqual(['B']);
    expect(queryCenterRows([a, b, c], { search: '5551234' }).length).toBe(3); // phone shared by fixture
    expect(queryCenterRows([a, b, c], { search: 'no-match-xyz' })).toEqual([]);
  });

  it('filters by status, remaining balance, source, employee and issued date range', () => {
    expect(queryCenterRows([a, b, c], { status: 'voided' }).map((r) => r.id)).toEqual(['C']);
    expect(queryCenterRows([a, b, c], { status: 'hasRemaining' }).map((r) => r.id).sort()).toEqual(['A', 'B']);
    expect(queryCenterRows([a, b, c], { status: 'zeroBalance' }).map((r) => r.id)).toEqual(['C']);
    expect(queryCenterRows([a, b, c], { source: 'return' }).map((r) => r.id)).toEqual(['B']);
    expect(queryCenterRows([a, b, c], { employee: 'luis' }).map((r) => r.id)).toEqual(['B']);
    expect(queryCenterRows([a, b, c], { dateFrom: '2026-07-02', dateTo: '2026-07-04' }).map((r) => r.id)).toEqual(['C']);
  });

  it('sorts deterministically', () => {
    expect(queryCenterRows([a, b, c], { sort: 'newest' }).map((r) => r.id)).toEqual(['B', 'C', 'A']);
    expect(queryCenterRows([a, b, c], { sort: 'oldest' }).map((r) => r.id)).toEqual(['A', 'C', 'B']);
    expect(queryCenterRows([a, b, c], { sort: 'highestRemaining' }).map((r) => r.id)).toEqual(['B', 'A', 'C']);
    expect(queryCenterRows([a, b, c], { sort: 'customer' }).map((r) => r.id)).toEqual(['A', 'B', 'C']);
    expect(queryCenterRows([a, b, c], { sort: 'lastActivity' })[0].id).toBe('B'); // redemption on 07-06
  });
});

describe('lastActivityIso + CSV', () => {
  it('last activity reflects the newest persisted movement', () => {
    const entry = cert({
      redemptions: [{ id: 'r', redeemedAt: '2026-07-10T00:00:00.000Z', redeemedAmount: 1, remainingAfter: 1, saleId: 's', employeeName: 'E' }],
      reversals: [{ id: 'v', reversedAt: '2026-07-12T00:00:00.000Z', restoredAmount: 1, originalSaleId: 's', employeeName: 'M' }],
    });
    expect(lastActivityIso(entry)).toBe('2026-07-12T00:00:00.000Z');
  });

  it('CSV escapes commas/quotes and exports dollars with two decimals', () => {
    const csv = buildLedgerCsv([cert({ customerName: 'López, "El Jefe"' })]);
    const lines = csv.split('\n');
    expect(lines[0]).toContain('Certificate,Customer');
    expect(lines[1]).toContain('"López, ""El Jefe"""');
    expect(lines[1]).toContain('232.70');
  });
});
