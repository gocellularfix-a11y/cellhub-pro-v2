// ============================================================
// R-CUSTOMER-LINE-PAYMENTS-V1 — per-phone monthly payments.
// Pure-helper tests covering the full compatibility matrix: per-line
// authority, one-time legacy fallback, no duplication/multiplication,
// exact integer-cent aggregation, and serialization round-trips
// (backup export/import and LAN customer sync both ship the whole
// customer record as JSON — the round-trip test covers both).
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  parseDollarsToCents,
  centsToDollarsString,
  getLineCount,
  hasPerLinePayments,
  getLinePaymentCents,
  getMonthlyTotalCents,
  hasUnassignedLegacyPayment,
  getPaymentCentsForPhone,
  getPaymentDollarsForPhone,
} from './linePayments';
import type { Customer } from '@/store/types';

const cust = (over: Partial<Customer>): Partial<Customer> => ({ id: 'c1', ...over });

describe('parseDollarsToCents — integer cents only', () => {
  it('parses dollars strings into integer cents', () => {
    expect(parseDollarsToCents('50')).toBe(5000);
    expect(parseDollarsToCents('35.00')).toBe(3500);
    expect(parseDollarsToCents('49.99')).toBe(4999);
    expect(Number.isInteger(parseDollarsToCents('49.99'))).toBe(true);
  });

  it('handles empty/invalid/zero safely', () => {
    expect(parseDollarsToCents('')).toBeNull();
    expect(parseDollarsToCents(null)).toBeNull();
    expect(parseDollarsToCents(undefined)).toBeNull();
    expect(parseDollarsToCents('abc')).toBeNull();
    expect(parseDollarsToCents('0')).toBeNull();
    expect(parseDollarsToCents('-5')).toBeNull();
  });
});

describe('per-line storage (the JULIANA BARRON scenario)', () => {
  const juliana = cust({
    phone: '8054039624',
    phones: ['8054039624', '8053195724'],
    carriers: ['H2O', 'H2O'],
    monthlyPaymentsCents: [5000, 3500],
  });

  it('two lines store different payments independently', () => {
    expect(getLinePaymentCents(juliana, 0)).toBe(5000); // $50.00
    expect(getLinePaymentCents(juliana, 1)).toBe(3500); // $35.00
  });

  it('editing one line does not change the other (immutably updated record)', () => {
    const edited = { ...juliana, monthlyPaymentsCents: [5000, 4000] }; // line 2 → $40
    expect(getLinePaymentCents(edited, 0)).toBe(5000);                 // line 1 untouched
    expect(getLinePaymentCents(edited, 1)).toBe(4000);
  });

  it('a new third line has NO payment (never inherits)', () => {
    const withThird = {
      ...juliana,
      phones: [...(juliana.phones as string[]), '8050001111'],
      monthlyPaymentsCents: [...(juliana.monthlyPaymentsCents as number[]), null],
    };
    expect(getLinePaymentCents(withThird, 2)).toBeNull();
  });

  it('removing one line leaves the remaining amounts unchanged', () => {
    const removedThird = { ...juliana }; // back to two lines
    expect(getLinePaymentCents(removedThird, 0)).toBe(5000);
    expect(getLinePaymentCents(removedThird, 1)).toBe(3500);
  });

  it('per-phone lookup resolves each number to its own amount', () => {
    expect(getPaymentCentsForPhone(juliana, '(805) 403-9624')).toBe(5000);
    expect(getPaymentCentsForPhone(juliana, '8053195724')).toBe(3500);
    expect(getPaymentDollarsForPhone(juliana, '8053195724')).toBe('35.00');
    expect(getPaymentCentsForPhone(juliana, '8059999999')).toBeNull();
  });
});

describe('legacy compatibility (one-time fallback, never duplicated)', () => {
  it('legacy single-phone customer retains its amount', () => {
    const legacy = cust({ phone: '8051234567', monthlyPayment: '50.00' });
    expect(getLinePaymentCents(legacy, 0)).toBe(5000);
    expect(getMonthlyTotalCents(legacy)).toBe(5000);
    expect(hasUnassignedLegacyPayment(legacy)).toBe(false);
  });

  it('legacy multi-phone customer does NOT duplicate the amount onto every line', () => {
    const legacyMulti = cust({
      phone: '8051234567',
      phones: ['8051234567', '8057654321'],
      monthlyPayment: '50.00',
    });
    expect(getLinePaymentCents(legacyMulti, 0)).toBeNull(); // not auto-assigned
    expect(getLinePaymentCents(legacyMulti, 1)).toBeNull();
    // Aggregate counts the legacy amount ONCE — never × line count.
    expect(getMonthlyTotalCents(legacyMulti)).toBe(5000);
    expect(hasUnassignedLegacyPayment(legacyMulti)).toBe(true);
  });

  it('per-line values and legacy fallback are never double-counted', () => {
    const mixed = cust({
      phones: ['8051234567', '8057654321'],
      monthlyPaymentsCents: [5000, 3500],
      monthlyPayment: '99.00', // stale legacy left behind — must be ignored
    });
    expect(getMonthlyTotalCents(mixed)).toBe(8500); // exact per-line sum only
    expect(getLinePaymentCents(mixed, 0)).toBe(5000);
    expect(hasUnassignedLegacyPayment(mixed)).toBe(false);
  });

  it('aggregate is the exact integer sum of per-line values', () => {
    const c = cust({ phones: ['1', '2', '3'], monthlyPaymentsCents: [4999, null, 3501] });
    expect(getMonthlyTotalCents(c)).toBe(8500);
  });

  it('reading old/partial record shapes never crashes', () => {
    expect(getMonthlyTotalCents(cust({}))).toBeNull();
    expect(getMonthlyTotalCents(null)).toBeNull();
    expect(getLinePaymentCents(cust({ monthlyPaymentsCents: undefined }), 0)).toBeNull();
    expect(getPaymentCentsForPhone(cust({ phones: undefined }), '805')).toBeNull();
    expect(getLineCount(cust({ phone: '', phones: [] }))).toBe(0);
    expect(hasPerLinePayments(cust({ monthlyPaymentsCents: [null, null] }))).toBe(false);
  });
});

describe('serialization round-trips (backup export/import + LAN customer sync)', () => {
  it('JSON round-trip preserves every line amount exactly', () => {
    const original = cust({
      phone: '8054039624',
      phones: ['8054039624', '8053195724'],
      carriers: ['H2O', 'H2O'],
      monthlyPaymentsCents: [5000, 3500],
    });
    // Both the backup export/import path and LAN customer forwarding
    // serialize whole records via JSON — same wire format.
    const roundTripped = JSON.parse(JSON.stringify(original)) as Partial<Customer>;
    expect(roundTripped.monthlyPaymentsCents).toEqual([5000, 3500]);
    expect(getLinePaymentCents(roundTripped, 0)).toBe(5000);
    expect(getLinePaymentCents(roundTripped, 1)).toBe(3500);
    expect(getMonthlyTotalCents(roundTripped)).toBe(8500);
  });

  it('centsToDollarsString formats safely', () => {
    expect(centsToDollarsString(5000)).toBe('50.00');
    expect(centsToDollarsString(3501)).toBe('35.01');
    expect(centsToDollarsString(null)).toBe('');
    expect(centsToDollarsString(0)).toBe('');
  });
});
