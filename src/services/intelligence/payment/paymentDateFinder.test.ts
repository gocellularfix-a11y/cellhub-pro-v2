// ============================================================
// PAYMENT DATE FINDER — F1 engine tests.
// Runs findPaymentDates() against hand-built customers/sales/layaways so
// every classification branch, filter, and the sort/no-double-count paths
// are actually executed.
//
// All dates are built with the LOCAL Date(year, monthIndex, day) constructor
// (never ISO date-only strings, which parse as UTC and shift a day in
// non-UTC test runners). The engine works at local-day granularity, so this
// keeps expectations deterministic regardless of the machine timezone.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  findPaymentDates,
  findHistoricalMatch,
  collectPhones,
  type PaymentFinderOptions,
} from './paymentDateFinder';
import type { Customer, Sale, Layaway } from '@/store/types';

// month index reminder: 0=Jan … 5=Jun, 6=Jul.
const d = (y: number, m: number, day: number) => new Date(y, m, day);

// ── Builders ───────────────────────────────────────────────────────────────

function cust(over: Partial<Customer> & { id: string }): Customer {
  return {
    firstName: over.firstName ?? 'First',
    lastName: over.lastName ?? 'Last',
    name: over.name ?? '',
    phone: over.phone ?? '',
    email: over.email ?? '',
    loyaltyPoints: 0,
    storeCredit: 0,
    customerNumber: over.customerNumber ?? 'GC-0001',
    notes: '',
    communicationConsent: true,
    createdAt: '2025-01-01',
    ...over,
  } as Customer;
}

function paySale(over: {
  id: string;
  customerId?: string;
  customerPhone?: string;
  createdAt: Date;
  amountCents: number;
  category?: string;
  status?: Sale['status'];
}): Sale {
  return {
    id: over.id,
    invoiceNumber: over.id,
    customerId: over.customerId,
    customerPhone: over.customerPhone,
    items: [
      {
        id: `${over.id}-i1`,
        name: 'Payment',
        category: (over.category ?? 'phone_payment') as any,
        price: over.amountCents,
        qty: 1,
        cbeEligible: false,
        taxable: false,
      },
    ],
    subtotal: over.amountCents,
    taxAmount: 0,
    cbeTotal: 0,
    total: over.amountCents,
    paymentMethod: 'cash',
    status: over.status ?? 'completed',
    createdAt: over.createdAt,
  } as Sale;
}

function layaway(over: {
  id: string;
  customerId?: string;
  customerPhone?: string;
  dueDate: Date;
  status?: string;
}): Layaway {
  return {
    id: over.id,
    customerId: over.customerId,
    customerName: 'Lay Customer',
    customerPhone: over.customerPhone ?? '',
    items: [],
    totalPrice: 10000,
    paidAmount: 2000,
    balance: 8000,
    status: (over.status ?? 'active') as any,
    notes: '',
    dueDate: over.dueDate as any,
    createdAt: '2025-01-01',
  } as Layaway;
}

// July 2026 vacation window used across tests.
const REF = d(2026, 6, 1);
const baseOpts = (over: Partial<PaymentFinderOptions> = {}): PaymentFinderOptions => ({
  startDate: d(2026, 6, 5),
  endDate: d(2026, 6, 10),
  referenceDate: REF,
  ...over,
});

// ── Tests ────────────────────────────────────────────────────────────────

describe('findPaymentDates — empty / no-signal', () => {
  it('returns a clean empty result with no customers', () => {
    const res = findPaymentDates({ customers: [], sales: [] }, baseOpts());
    expect(res.rows).toHaveLength(0);
    expect(res.counts.total).toBe(0);
    expect(res.rangeStart).toBe(d(2026, 6, 5).toISOString());
  });

  it('skips customers with no payment history and no layaway due', () => {
    const res = findPaymentDates(
      { customers: [cust({ id: 'c1', phone: '8050001111' })], sales: [] },
      baseOpts(),
    );
    expect(res.rows).toHaveLength(0);
  });
});

describe('findPaymentDates — estimated_due', () => {
  it('estimates a ~monthly due inside the range from last payment', () => {
    // Paid Jun 7 → +30d = Jul 7, inside Jul 5–10.
    const res = findPaymentDates(
      {
        customers: [cust({ id: 'c1', phone: '8050001111', firstName: 'Ana' })],
        sales: [paySale({ id: 's1', customerId: 'c1', createdAt: d(2026, 5, 7), amountCents: 5000 })],
      },
      baseOpts(),
    );
    expect(res.rows).toHaveLength(1);
    const row = res.rows[0];
    expect(row.status).toBe('estimated_due');
    expect(row.isEstimated).toBe(true);
    expect(row.effectiveDueDate).toBe(d(2026, 6, 7).toISOString());
    expect(row.lastPaymentAmountCents).toBe(5000);
  });

  it('excludes estimated rows when includeEstimatedDueDates is false', () => {
    const res = findPaymentDates(
      {
        customers: [cust({ id: 'c1', phone: '8050001111' })],
        sales: [paySale({ id: 's1', customerId: 'c1', createdAt: d(2026, 5, 7), amountCents: 5000 })],
      },
      baseOpts({ includeEstimatedDueDates: false }),
    );
    expect(res.rows).toHaveLength(0);
  });

  it('infers a shorter cycle from repeated ~28-day gaps', () => {
    const res = findPaymentDates(
      {
        customers: [cust({ id: 'c1', phone: '8050001111' })],
        sales: [
          paySale({ id: 's1', customerId: 'c1', createdAt: d(2026, 4, 11), amountCents: 4000 }),
          paySale({ id: 's2', customerId: 'c1', createdAt: d(2026, 5, 8), amountCents: 4000 }),
        ],
      },
      baseOpts(),
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].status).toBe('estimated_due');
    // 28-day cycle from Jun 8 → Jul 6, in range.
    expect(res.rows[0].effectiveDueDate).toBe(d(2026, 6, 6).toISOString());
  });
});

describe('findPaymentDates — historical_match', () => {
  it('matches a payment in the equivalent window one month back', () => {
    // Two payments 44 days apart → cycle clamps to 44 (≤45). Last = Jun 8.
    // Jun 8 + 44 = Jul 22 (misses Jul 5–10) so estimated_due won't fire,
    // leaving the Jun 8 payment to match the 1-month-back window (Jun 5–10).
    const res = findPaymentDates(
      {
        customers: [cust({ id: 'c1', phone: '8050001111' })],
        sales: [
          paySale({ id: 's0', customerId: 'c1', createdAt: d(2026, 3, 25), amountCents: 3000 }),
          paySale({ id: 's1', customerId: 'c1', createdAt: d(2026, 5, 8), amountCents: 3000 }),
        ],
      },
      baseOpts({ compareMonths: 1 }),
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].status).toBe('historical_match');
    expect(res.rows[0].matchedHistoricalOffsetMonths).toBe(1);
    // Mapped forward: Jun 8 + 1 month = Jul 8.
    expect(res.rows[0].effectiveDueDate).toBe(d(2026, 6, 8).toISOString());
  });

  it('does not scan prior months when compareMonths is 0', () => {
    const res = findPaymentDates(
      {
        customers: [cust({ id: 'c1', phone: '8050001111' })],
        sales: [
          paySale({ id: 's0', customerId: 'c1', createdAt: d(2026, 3, 25), amountCents: 3000 }),
          paySale({ id: 's1', customerId: 'c1', createdAt: d(2026, 5, 8), amountCents: 3000 }),
        ],
      },
      baseOpts({ compareMonths: 0 }),
    );
    expect(res.rows).toHaveLength(0);
  });
});

describe('findPaymentDates — due_in_range (real layaway due)', () => {
  it('surfaces a layaway due date as a NON-estimated match', () => {
    const res = findPaymentDates(
      {
        customers: [cust({ id: 'c1', phone: '8050001111' })],
        sales: [],
        layaways: [layaway({ id: 'l1', customerId: 'c1', dueDate: d(2026, 6, 8) })],
      },
      baseOpts(),
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].status).toBe('due_in_range');
    expect(res.rows[0].isEstimated).toBe(false);
    expect(res.rows[0].layawayId).toBe('l1');
  });

  it('ignores terminal-status layaways', () => {
    const res = findPaymentDates(
      {
        customers: [cust({ id: 'c1', phone: '8050001111' })],
        sales: [],
        layaways: [layaway({ id: 'l1', customerId: 'c1', dueDate: d(2026, 6, 8), status: 'completed' })],
      },
      baseOpts(),
    );
    expect(res.rows).toHaveLength(0);
  });
});

describe('findPaymentDates — already_paid suppression', () => {
  it('excludes an in-range payer by default', () => {
    const res = findPaymentDates(
      {
        customers: [cust({ id: 'c1', phone: '8050001111' })],
        sales: [paySale({ id: 's1', customerId: 'c1', createdAt: d(2026, 6, 7), amountCents: 5000 })],
      },
      baseOpts(),
    );
    expect(res.rows).toHaveLength(0);
  });

  it('includes them as already_paid when opted-in', () => {
    const res = findPaymentDates(
      {
        customers: [cust({ id: 'c1', phone: '8050001111' })],
        sales: [paySale({ id: 's1', customerId: 'c1', createdAt: d(2026, 6, 7), amountCents: 5000 })],
      },
      baseOpts({ includeAlreadyPaid: true }),
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].status).toBe('already_paid');
    expect(res.rows[0].isEstimated).toBe(false);
  });
});

describe('findPaymentDates — inactive filter', () => {
  it('excludes customers with no payment in the inactivity window', () => {
    // Last paid Jan 6 2026 → >90d before Jul 1; dropped even though a cycle
    // projection could land in range.
    const res = findPaymentDates(
      {
        customers: [cust({ id: 'c1', phone: '8050001111' })],
        sales: [paySale({ id: 's1', customerId: 'c1', createdAt: d(2026, 0, 6), amountCents: 5000 })],
      },
      baseOpts({ compareMonths: 2 }),
    );
    expect(res.rows).toHaveLength(0);
  });

  it('active customers still match estimated_due (control for the filter)', () => {
    const res = findPaymentDates(
      {
        customers: [cust({ id: 'c1', phone: '8050001111' })],
        sales: [paySale({ id: 's1', customerId: 'c1', createdAt: d(2026, 5, 6), amountCents: 5000 })],
      },
      baseOpts({ includeInactive: true }),
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].status).toBe('estimated_due');
  });
});

describe('findPaymentDates — customer fields & carrier/lines', () => {
  it('reports carrier, line count and multi-line flag', () => {
    const res = findPaymentDates(
      {
        customers: [
          cust({
            id: 'c1',
            firstName: 'Multi',
            lastName: 'Line',
            phone: '8050001111',
            phones: ['8050001111', '8050002222'],
            carriers: ['T-Mobile', 'AT&T'],
            carrier: 'T-Mobile',
          }),
        ],
        sales: [paySale({ id: 's1', customerId: 'c1', createdAt: d(2026, 5, 7), amountCents: 5000 })],
      },
      baseOpts(),
    );
    expect(res.rows[0].carrier).toBe('T-Mobile');
    expect(res.rows[0].lineCount).toBe(2);
    expect(res.rows[0].isMultiLine).toBe(true);
    expect(res.rows[0].customerName).toBe('Multi Line');
  });

  it('flags high-value customers by average payment', () => {
    const res = findPaymentDates(
      {
        customers: [cust({ id: 'c1', phone: '8050001111' })],
        sales: [paySale({ id: 's1', customerId: 'c1', createdAt: d(2026, 5, 7), amountCents: 15000 })],
      },
      baseOpts(),
    );
    expect(res.rows[0].isHighValue).toBe(true);
  });
});

describe('findPaymentDates — linking & no double-count', () => {
  it('matches sales by normalized phone when customerId is absent', () => {
    const res = findPaymentDates(
      {
        customers: [cust({ id: 'c1', phone: '(805) 000-1111' })],
        sales: [paySale({ id: 's1', customerPhone: '805-000-1111', createdAt: d(2026, 5, 7), amountCents: 5000 })],
      },
      baseOpts(),
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].paymentCount).toBe(1);
  });

  it('does not double-count a sale that has both id and matching phone', () => {
    const res = findPaymentDates(
      {
        customers: [cust({ id: 'c1', phone: '8050001111' })],
        sales: [
          paySale({ id: 's1', customerId: 'c1', customerPhone: '8050001111', createdAt: d(2026, 5, 7), amountCents: 5000 }),
        ],
      },
      baseOpts(),
    );
    expect(res.rows[0].paymentCount).toBe(1);
    expect(res.rows[0].averagePaymentAmountCents).toBe(5000);
  });

  it('only counts payment-category items, ignoring product-only sales', () => {
    const productSale = {
      ...paySale({ id: 's2', customerId: 'c1', createdAt: d(2026, 5, 9), amountCents: 9999 }),
      items: [
        { id: 's2-i1', name: 'Case', category: 'accessory' as any, price: 9999, qty: 1, cbeEligible: false, taxable: true },
      ],
    } as Sale;
    const res = findPaymentDates(
      {
        customers: [cust({ id: 'c1', phone: '8050001111' })],
        sales: [
          paySale({ id: 's1', customerId: 'c1', createdAt: d(2026, 5, 7), amountCents: 5000 }),
          productSale,
        ],
      },
      baseOpts(),
    );
    expect(res.rows[0].paymentCount).toBe(1);
    expect(res.rows[0].lastPaymentAmountCents).toBe(5000);
  });

  it('counts top_up category as a payment', () => {
    const res = findPaymentDates(
      {
        customers: [cust({ id: 'c1', phone: '8050001111' })],
        sales: [paySale({ id: 's1', customerId: 'c1', createdAt: d(2026, 5, 7), amountCents: 3000, category: 'top_up' })],
      },
      baseOpts(),
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].paymentCount).toBe(1);
  });

  it('ignores voided/refunded sales', () => {
    const res = findPaymentDates(
      {
        customers: [cust({ id: 'c1', phone: '8050001111' })],
        sales: [paySale({ id: 's1', customerId: 'c1', createdAt: d(2026, 5, 7), amountCents: 5000, status: 'voided' })],
      },
      baseOpts(),
    );
    expect(res.rows).toHaveLength(0);
  });
});

describe('findPaymentDates — sorting & counts', () => {
  it('sorts by soonest effective due date, then higher average payment', () => {
    const res = findPaymentDates(
      {
        customers: [
          cust({ id: 'c1', firstName: 'Later', phone: '8050001111' }),
          cust({ id: 'c2', firstName: 'Sooner', phone: '8050002222' }),
        ],
        sales: [
          // c1 last paid Jun 10 → est Jul 10 (later in range)
          paySale({ id: 's1', customerId: 'c1', createdAt: d(2026, 5, 10), amountCents: 5000 }),
          // c2 last paid Jun 5 → est Jul 5 (sooner in range)
          paySale({ id: 's2', customerId: 'c2', createdAt: d(2026, 5, 5), amountCents: 5000 }),
        ],
      },
      baseOpts(),
    );
    expect(res.rows.map((r) => r.customerId)).toEqual(['c2', 'c1']);
    expect(res.counts.total).toBe(2);
    expect(res.counts.estimatedDue).toBe(2);
  });
});

describe('pure helpers', () => {
  it('collectPhones de-dupes and normalizes', () => {
    const c = cust({ id: 'c1', phone: '(805) 000-1111', phones: ['805-000-1111', '8050002222'] });
    expect(collectPhones(c)).toEqual(['8050001111', '8050002222']);
  });

  it('findHistoricalMatch returns the closest matching month', () => {
    const start = d(2026, 6, 5);
    const end = d(2026, 6, 10);
    const dates = [d(2026, 4, 7), d(2026, 5, 7)]; // May 7 & Jun 7
    const m = findHistoricalMatch(dates, start, end, 2);
    expect(m?.offsetMonths).toBe(1); // Jun (1 month back) is closer than May
    expect(m?.matchedDate.getTime()).toBe(d(2026, 5, 7).getTime());
  });

  it('findHistoricalMatch returns null when nothing matches in-window', () => {
    const start = d(2026, 6, 5);
    const end = d(2026, 6, 10);
    const dates = [d(2026, 5, 20)]; // Jun 20 not in Jun 5–10
    expect(findHistoricalMatch(dates, start, end, 2)).toBeNull();
  });
});
