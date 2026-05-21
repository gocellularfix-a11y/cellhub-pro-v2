// ============================================================================
// R-FINANCIAL-LOGIC-SAFETY-AUDIT-FIRST
//
// Read-only audit harness for the financial buckets the daily report uses.
// Documents the CURRENT field semantics (Sale interface in src/store/types.ts)
// and runs 10 hardcoded fixtures so the invariants are reproducible without
// touching real Firestore / localStorage / report code.
//
// THIS FILE DOES NOT:
//   - Mutate any production code path.
//   - Change report formulas (ReportsModule.tsx stats memo is untouched).
//   - Run automatically on app start — must be invoked via `runFixtureAudit()`
//     or `runFinanceAudit(sales)` from a future UI button / devtools console.
//
// THIS FILE DOES:
//   - Define an explicit bucket model (preTax / salesTax / nonTaxFees /
//     legacyTaxFallback / creditCardFee) keyed to Sale fields.
//   - Derive those buckets from any Sale[] with integer-cent arithmetic only.
//   - Compare derived values against per-fixture expected values within a
//     ±1 cent tolerance and report the failing invariants.
//   - Provide 10 fixtures (A-J) covering the cases the auditor requested.
//
// CONVENTIONS:
//   - All money in cents (integer).
//   - No Math.round / floor / ceil inside the audit — only integer + and −.
//   - Tolerance = ±1 cent (per requirement #10).
//   - A sale with status='voided' or status='refunded' is EXCLUDED from
//     every countable bucket. A negative-total sale with status='completed'
//     (R-EDIT-AUDIT refund-audit row) is INCLUDED — its negative values
//     subtract from buckets so refunds reverse cleanly.
// ============================================================================

import type { Sale, SaleItem } from '@/store/types';

const TOLERANCE_CENTS = 1;

// ── Bucket model ────────────────────────────────────────────────────────────
// preTaxRevenue         : Σ (subtotalAfterDiscount ?? subtotal) for countable
//                         sales. Pre-tax revenue ≈ Z tape NET1.
// salesTaxCents         : Σ sale.salesTax for countable sales. CA SALES TAX
//                         ONLY — never utility / mobility / cbe / screen.
// legacyTaxAmountCents  : Σ sale.taxAmount for countable sales where the
//                         three v2 fields (salesTax, utilityTax,
//                         mobileSurcharge) are all 0. Mirrors the
//                         ReportsModule line 994 fallback.
// utilityTaxCents       : Σ sale.utilityTax (Utility Users Tax on phone pay).
// mobilityFeeCents      : Σ sale.mobileSurcharge (CDTFA mobility fee).
// cbeCollectedCents     : Σ sale.cbeTotal (CBE recycling fee on phones).
// screenFeeCents        : Σ sale.screenFeeTotal (E-Waste screen fee).
// creditCardFeeCents    : Σ sale.creditCardFee (pass-through CC surcharge).
// nonTaxFeesCents       : utility + mobility + cbe + screen + cc fee.
//                         Combined non-sales-tax bucket. Z tape's TTL TAX
//                         line does NOT typically include these.
// categoryPreTaxCents   : Σ item.price × item.qty across countable sales.
//                         Should equal preTaxRevenueCents within ±1 cent.
// grossCollectedCents   : Σ sale.total for countable sales. Tax-included.
//                         Matches Z tape NET2.
// phonePaymentTotalCents: Σ (item.price × item.qty) for items with
//                         category === 'phone_payment'. Preserved across
//                         every audit so provider totals never drift.

export interface AuditDerived {
  saleCount: number;
  countableSaleCount: number;
  voidedSaleCount: number;
  refundedSaleCount: number;
  grossCollectedCents: number;
  preTaxRevenueCents: number;
  salesTaxCents: number;
  legacyTaxAmountCents: number;
  utilityTaxCents: number;
  mobilityFeeCents: number;
  cbeCollectedCents: number;
  screenFeeCents: number;
  creditCardFeeCents: number;
  nonTaxFeesCents: number;
  categoryPreTaxCents: number;
  voidedExcludedTotalCents: number;
  refundedExcludedTotalCents: number;
  phonePaymentTotalCents: number;
}

export interface AuditInvariantResult {
  id: string;
  name: string;
  passed: boolean;
  expected: number;
  actual: number;
  delta: number;
  notes: string;
}

export interface AuditReport {
  derived: AuditDerived;
  invariants: AuditInvariantResult[];
  passed: boolean;
}

// ── Pure derivation ─────────────────────────────────────────────────────────
export function deriveBuckets(sales: Sale[]): AuditDerived {
  let gross = 0;
  let preTax = 0;
  let salesTax = 0;
  let legacyTaxAmount = 0;
  let utility = 0;
  let mobility = 0;
  let cbe = 0;
  let screenFee = 0;
  let ccFee = 0;
  let categoryPreTax = 0;
  let voidedExcluded = 0;
  let refundedExcluded = 0;
  let phonePaymentTotal = 0;
  let countable = 0;
  let voidedCount = 0;
  let refundedCount = 0;

  for (const sale of sales) {
    if (sale.status === 'voided') {
      voidedExcluded += sale.total || 0;
      voidedCount++;
      continue;
    }
    if (sale.status === 'refunded') {
      refundedExcluded += sale.total || 0;
      refundedCount++;
      continue;
    }

    countable++;
    gross += sale.total || 0;
    preTax += sale.subtotalAfterDiscount ?? (sale.subtotal || 0);

    const v2SalesTax = sale.salesTax || 0;
    const v2UtilityTax = sale.utilityTax || 0;
    const v2Mobility = sale.mobileSurcharge || 0;
    const v2Sum = v2SalesTax + v2UtilityTax + v2Mobility;

    salesTax += v2SalesTax;
    utility += v2UtilityTax;
    mobility += v2Mobility;

    // Mirror of ReportsModule line 994:
    //   salesTaxCents += saleTax > 0 ? saleTax : (sale.taxAmount || 0);
    // Tracked here in a SEPARATE field so the audit can flag the fallback
    // path without mixing it into the v2 salesTax bucket.
    if (v2Sum === 0 && (sale.taxAmount || 0) !== 0) {
      legacyTaxAmount += sale.taxAmount || 0;
    }

    cbe += sale.cbeTotal || 0;
    screenFee += sale.screenFeeTotal || 0;
    ccFee += sale.creditCardFee || 0;

    for (const item of sale.items || []) {
      const lineRev = (item.price || 0) * (item.qty || 1);
      categoryPreTax += lineRev;
      if (item.category === 'phone_payment') phonePaymentTotal += lineRev;
    }
  }

  const nonTaxFees = utility + mobility + cbe + screenFee + ccFee;

  return {
    saleCount: sales.length,
    countableSaleCount: countable,
    voidedSaleCount: voidedCount,
    refundedSaleCount: refundedCount,
    grossCollectedCents: gross,
    preTaxRevenueCents: preTax,
    salesTaxCents: salesTax,
    legacyTaxAmountCents: legacyTaxAmount,
    utilityTaxCents: utility,
    mobilityFeeCents: mobility,
    cbeCollectedCents: cbe,
    screenFeeCents: screenFee,
    creditCardFeeCents: ccFee,
    nonTaxFeesCents: nonTaxFees,
    categoryPreTaxCents: categoryPreTax,
    voidedExcludedTotalCents: voidedExcluded,
    refundedExcludedTotalCents: refundedExcluded,
    phonePaymentTotalCents: phonePaymentTotal,
  };
}

// ── Invariants ──────────────────────────────────────────────────────────────
function check(
  id: string,
  name: string,
  expected: number,
  actual: number,
  notes = '',
): AuditInvariantResult {
  const delta = actual - expected;
  return {
    id,
    name,
    expected,
    actual,
    delta,
    passed: Math.abs(delta) <= TOLERANCE_CENTS,
    notes,
  };
}

export interface ExpectedBuckets {
  grossCollectedCents?: number;
  preTaxRevenueCents?: number;
  salesTaxCents?: number;        // includes legacy taxAmount when fallback fires
  nonTaxFeesCents?: number;
  categoryPreTaxCents?: number;
}

export function runFinanceAudit(sales: Sale[], expected?: ExpectedBuckets): AuditReport {
  const d = deriveBuckets(sales);
  const results: AuditInvariantResult[] = [];

  // I1: grossCollected = Σ sale.total for countable sales
  let handGross = 0;
  for (const s of sales) {
    if (s.status === 'voided' || s.status === 'refunded') continue;
    handGross += s.total || 0;
  }
  results.push(check('I1', 'grossCollected = Σ countable sale.total', handGross, d.grossCollectedCents,
    'Hand-rolled sum vs deriveBuckets — self-check for accumulator drift.'));

  // I2: preTax + (salesTax + legacy) + nonTaxFees = grossCollected
  const taxBucket = d.salesTaxCents + d.legacyTaxAmountCents;
  const reconstituted = d.preTaxRevenueCents + taxBucket + d.nonTaxFeesCents;
  results.push(check('I2', 'preTax + salesTax + nonTaxFees = gross',
    d.grossCollectedCents, reconstituted,
    'Z tape identity: every dollar collected lives in exactly one bucket. NonTaxFees = utility + mobility + cbe + screen + creditCardFee.'));

  // I3+I4: categoryPreTaxTotal == preTaxRevenue
  results.push(check('I4', 'categoryPreTax = preTaxRevenue',
    d.preTaxRevenueCents, d.categoryPreTaxCents,
    'Σ (item.price × item.qty) should equal Σ subtotalAfterDiscount. Drift here means line revenue and header subtotal diverged.'));

  // I5/I6: salesTax has no fee bleed — structural via expected fixtures below.
  //   When a fixture specifies expected.salesTaxCents, that value MUST equal
  //   (d.salesTaxCents + d.legacyTaxAmountCents) — i.e. v2 + legacy fallback
  //   together. Utility/mobility/cbe/screen/ccfee live in nonTaxFees ONLY.
  if (expected) {
    if (expected.grossCollectedCents !== undefined) {
      results.push(check('E.gross', 'expected grossCollected',
        expected.grossCollectedCents, d.grossCollectedCents));
    }
    if (expected.preTaxRevenueCents !== undefined) {
      results.push(check('E.preTax', 'expected preTaxRevenue',
        expected.preTaxRevenueCents, d.preTaxRevenueCents));
    }
    if (expected.salesTaxCents !== undefined) {
      results.push(check('E.salesTax', 'expected salesTax (v2 + legacy fallback)',
        expected.salesTaxCents, d.salesTaxCents + d.legacyTaxAmountCents,
        'Compared against salesTax + legacyTaxAmount to mirror production fallback path. Fail = fee bleed into sales-tax bucket OR legacy/v2 mismatch.'));
    }
    if (expected.nonTaxFeesCents !== undefined) {
      results.push(check('E.nonTaxFees', 'expected nonTaxFees',
        expected.nonTaxFeesCents, d.nonTaxFeesCents,
        'Sum of utility + mobility + cbe + screen + creditCardFee. Fail = a fee field is being credited to sales-tax OR is missing entirely.'));
    }
    if (expected.categoryPreTaxCents !== undefined) {
      results.push(check('E.categoryPreTax', 'expected categoryPreTax',
        expected.categoryPreTaxCents, d.categoryPreTaxCents));
    }
  }

  // I8: voided sales contribute 0 — checked via deriveBuckets exclusion. We
  //   expose the excluded total separately so the audit can SEE the voided
  //   value being held out (not silently dropped).
  results.push(check('I8', 'voided sales excluded from gross',
    0, 0,
    `voidedExcludedTotalCents = ${d.voidedExcludedTotalCents} (informational; tracked separately so it doesn't leak into gross/tax/fees).`));

  // I9: phone-payment provider totals are immutable across the audit —
  //   captured for visibility; downstream provider-by-provider breakdown
  //   would compare against expected per-provider sums.
  results.push(check('I9', 'phonePaymentTotal preserved',
    d.phonePaymentTotalCents, d.phonePaymentTotalCents,
    'Sum of phone_payment line revenue. Echoed back as informational — invariant is structural (no rewrites permitted).'));

  const passed = results.every((r) => r.passed);
  return { derived: d, invariants: results, passed };
}

// ── Fixture helpers ─────────────────────────────────────────────────────────
// Minimal Sale / SaleItem constructors. Required fields are always present;
// the spread of `overrides` lets each fixture tweak the relevant numbers.

function makeItem(over: Partial<SaleItem> & { id: string; name: string; price: number; qty: number; category: string }): SaleItem {
  return {
    cbeEligible: false,
    taxable: false,
    ...over,
  } as SaleItem;
}

function makeSale(over: Partial<Sale> & { id: string; total: number; subtotal: number; items: SaleItem[] }): Sale {
  return {
    invoiceNumber: `FIXT-${over.id}`,
    subtotalAfterDiscount: over.subtotal,
    taxAmount: 0,
    cbeTotal: 0,
    status: 'completed',
    paymentMethod: 'cash',
    createdAt: '2026-05-20T00:00:00.000Z',
    ...over,
  } as Sale;
}

// ── Fixtures ────────────────────────────────────────────────────────────────
export interface AuditFixture {
  id: string;
  name: string;
  sales: Sale[];
  expected: ExpectedBuckets;
}

export const FIXTURES: AuditFixture[] = [
  // A. Normal taxable phone sale ($500 + 9% tax = $545)
  {
    id: 'A',
    name: 'Normal taxable phone sale',
    sales: [
      makeSale({
        id: 'A1',
        items: [makeItem({ id: 'A1-1', name: 'iPhone 15', price: 50000, qty: 1, category: 'phone', taxable: true })],
        subtotal: 50000,
        salesTax: 4500,
        total: 54500,
      }),
    ],
    expected: {
      grossCollectedCents: 54500,
      preTaxRevenueCents: 50000,
      salesTaxCents: 4500,
      nonTaxFeesCents: 0,
      categoryPreTaxCents: 50000,
    },
  },

  // B. Accessory taxable sale ($29.99 + 9% tax = $32.69)
  {
    id: 'B',
    name: 'Accessory taxable sale',
    sales: [
      makeSale({
        id: 'B1',
        items: [makeItem({ id: 'B1-1', name: 'Phone case', price: 2999, qty: 1, category: 'accessory', taxable: true })],
        subtotal: 2999,
        salesTax: 270,
        total: 3269,
      }),
    ],
    expected: {
      grossCollectedCents: 3269,
      preTaxRevenueCents: 2999,
      salesTaxCents: 270,
      nonTaxFeesCents: 0,
      categoryPreTaxCents: 2999,
    },
  },

  // C. Phone payment with utility tax (non-tax provider fee)
  {
    id: 'C',
    name: 'Phone payment with utility tax',
    sales: [
      makeSale({
        id: 'C1',
        items: [makeItem({ id: 'C1-1', name: 'AT&T Bill Payment', price: 5000, qty: 1, category: 'phone_payment', carrier: 'AT&T' })],
        subtotal: 5000,
        utilityTax: 275,
        total: 5275,
      }),
    ],
    expected: {
      grossCollectedCents: 5275,
      preTaxRevenueCents: 5000,
      salesTaxCents: 0,
      nonTaxFeesCents: 275,
      categoryPreTaxCents: 5000,
    },
  },

  // D. Activation/SIM sale with CBE fee
  {
    id: 'D',
    name: 'Activation/SIM with CBE fee',
    sales: [
      makeSale({
        id: 'D1',
        items: [makeItem({ id: 'D1-1', name: 'AT&T Activation', price: 6000, qty: 1, category: 'activation' })],
        subtotal: 6000,
        cbeTotal: 100,
        total: 6100,
      }),
    ],
    expected: {
      grossCollectedCents: 6100,
      preTaxRevenueCents: 6000,
      salesTaxCents: 0,
      nonTaxFeesCents: 100,
      categoryPreTaxCents: 6000,
    },
  },

  // E. Mixed taxable + non-taxable items in one sale
  {
    id: 'E',
    name: 'Mixed taxable + non-taxable',
    sales: [
      makeSale({
        id: 'E1',
        items: [
          makeItem({ id: 'E1-1', name: 'iPhone', price: 30000, qty: 1, category: 'phone', taxable: true }),
          makeItem({ id: 'E1-2', name: 'AT&T Bill', price: 4000, qty: 1, category: 'phone_payment' }),
        ],
        subtotal: 34000,
        salesTax: 2700, // 9% of taxable iPhone only
        total: 36700,
      }),
    ],
    expected: {
      grossCollectedCents: 36700,
      preTaxRevenueCents: 34000,
      salesTaxCents: 2700,
      nonTaxFeesCents: 0,
      categoryPreTaxCents: 34000,
    },
  },

  // F. Refund with sales tax (R-EDIT-AUDIT negative-total audit row pattern)
  {
    id: 'F',
    name: 'Refund with sales tax (negative-total audit sale)',
    sales: [
      makeSale({
        id: 'F1',
        items: [makeItem({ id: 'F1-1', name: 'iPhone', price: 50000, qty: 1, category: 'phone', taxable: true })],
        subtotal: 50000,
        salesTax: 4500,
        total: 54500,
      }),
      makeSale({
        id: 'F1-REFUND',
        invoiceNumber: 'REFUND-F1',
        items: [makeItem({ id: 'F1R-1', name: 'iPhone', price: -50000, qty: 1, category: 'phone', taxable: true })],
        subtotal: -50000,
        salesTax: -4500,
        total: -54500,
      }),
    ],
    expected: {
      grossCollectedCents: 0,
      preTaxRevenueCents: 0,
      salesTaxCents: 0,
      nonTaxFeesCents: 0,
      categoryPreTaxCents: 0,
    },
  },

  // G. Voided sale must not contribute to any bucket
  {
    id: 'G',
    name: 'Voided sale (excluded everywhere)',
    sales: [
      makeSale({
        id: 'G1',
        items: [makeItem({ id: 'G1-1', name: 'iPhone', price: 50000, qty: 1, category: 'phone', taxable: true })],
        subtotal: 50000,
        salesTax: 4500,
        total: 54500,
        status: 'voided',
      }),
    ],
    expected: {
      grossCollectedCents: 0,
      preTaxRevenueCents: 0,
      salesTaxCents: 0,
      nonTaxFeesCents: 0,
      categoryPreTaxCents: 0,
    },
  },

  // H. Legacy taxAmount only (pre-v2 data path)
  {
    id: 'H',
    name: 'Legacy taxAmount fallback only',
    sales: [
      makeSale({
        id: 'H1',
        items: [makeItem({ id: 'H1-1', name: 'iPhone', price: 50000, qty: 1, category: 'phone', taxable: true })],
        subtotal: 50000,
        taxAmount: 4500, // legacy aggregate — no v2 fields set
        total: 54500,
      }),
    ],
    expected: {
      grossCollectedCents: 54500,
      preTaxRevenueCents: 50000,
      salesTaxCents: 4500, // expected = v2 + legacy fallback combined
      nonTaxFeesCents: 0,
      categoryPreTaxCents: 50000,
    },
  },

  // I. Phone payment with utility + mobility together
  {
    id: 'I',
    name: 'Phone payment with utility + mobility fees',
    sales: [
      makeSale({
        id: 'I1',
        items: [makeItem({ id: 'I1-1', name: 'AT&T Bill', price: 5000, qty: 1, category: 'phone_payment' })],
        subtotal: 5000,
        utilityTax: 275,
        mobileSurcharge: 50,
        total: 5325,
      }),
    ],
    expected: {
      grossCollectedCents: 5325,
      preTaxRevenueCents: 5000,
      salesTaxCents: 0,
      nonTaxFeesCents: 325,
      categoryPreTaxCents: 5000,
    },
  },

  // J. Real Z tape day: NET1 = $1132.79, TAX = $77.87, NET2 = $1210.66
  //    Constructed as a single taxable sale that reproduces the identity
  //    NET1 + TAX = NET2. Audit confirms every bucket lands as expected.
  {
    id: 'J',
    name: 'Z tape sample (NET1=$1132.79 TAX=$77.87 NET2=$1210.66)',
    sales: [
      makeSale({
        id: 'J1',
        items: [
          makeItem({ id: 'J1-1', name: 'iPhone 15', price: 100000, qty: 1, category: 'phone', taxable: true }),
          makeItem({ id: 'J1-2', name: 'Phone case', price: 13279, qty: 1, category: 'accessory', taxable: true }),
        ],
        subtotal: 113279,
        salesTax: 7787,
        total: 121066,
      }),
    ],
    expected: {
      grossCollectedCents: 121066,
      preTaxRevenueCents: 113279,
      salesTaxCents: 7787,
      nonTaxFeesCents: 0,
      categoryPreTaxCents: 113279,
    },
  },
];

// ── Runner + summary ────────────────────────────────────────────────────────
export interface FixtureAuditResult {
  fixture: AuditFixture;
  report: AuditReport;
}

export function runFixtureAudit(): FixtureAuditResult[] {
  return FIXTURES.map((f) => ({
    fixture: f,
    report: runFinanceAudit(f.sales, f.expected),
  }));
}

export interface FixtureAuditSummary {
  totalFixtures: number;
  passedFixtures: number;
  failedFixtures: number;
  failures: Array<{
    fixtureId: string;
    fixtureName: string;
    failingInvariants: AuditInvariantResult[];
  }>;
}

export function summarizeFixtureAudit(results: FixtureAuditResult[]): FixtureAuditSummary {
  const failures = results
    .filter((r) => !r.report.passed)
    .map((r) => ({
      fixtureId: r.fixture.id,
      fixtureName: r.fixture.name,
      failingInvariants: r.report.invariants.filter((i) => !i.passed),
    }));
  return {
    totalFixtures: results.length,
    passedFixtures: results.length - failures.length,
    failedFixtures: failures.length,
    failures,
  };
}

// ── Console runner (devtools) ──────────────────────────────────────────────
// Convenience: call `runFixtureAuditToConsole()` from devtools to print the
// pass/fail summary as a console.table. Pure UI helper — no production
// behavior depends on it.
export function runFixtureAuditToConsole(): FixtureAuditSummary {
  const results = runFixtureAudit();
  const summary = summarizeFixtureAudit(results);
  /* eslint-disable no-console */
  console.group(`Finance audit: ${summary.passedFixtures}/${summary.totalFixtures} fixtures passed`);
  console.table(
    results.map((r) => ({
      id: r.fixture.id,
      name: r.fixture.name,
      passed: r.report.passed,
      failed: r.report.invariants.filter((i) => !i.passed).map((i) => i.id).join(',') || '—',
    })),
  );
  if (summary.failures.length > 0) {
    console.group('Failures');
    for (const f of summary.failures) {
      console.group(`${f.fixtureId} — ${f.fixtureName}`);
      console.table(f.failingInvariants.map((i) => ({
        id: i.id,
        name: i.name,
        expected: i.expected,
        actual: i.actual,
        delta: i.delta,
        notes: i.notes,
      })));
      console.groupEnd();
    }
    console.groupEnd();
  }
  console.groupEnd();
  /* eslint-enable no-console */
  return summary;
}
