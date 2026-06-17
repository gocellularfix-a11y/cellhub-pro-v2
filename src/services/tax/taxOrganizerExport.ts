// ============================================================
// CellHub Pro — Tax Organizer Export V1
// ============================================================
// Pure builder + serializers for the year-end "Tax Organizer".
// Reads ALREADY-COMPUTED Tax Center totals (never recomputes the
// canonical tax math) and produces three artifacts:
//   1. A structured JSON organizer object        (buildTaxOrganizer)
//   2. A flat CSV with one row per detail line    (organizerToCsv)
//   3. A printable summary HTML document          (organizerToPrintHtml)
//
// Each detail row carries a full tax-form mapping (federal + California)
// plus a plain-language "where this goes" and preparer notes, so a tax
// professional can transcribe directly. THIS IS NOT TAX ADVICE — see the
// disclaimer constant below; final form placement must be reviewed by a
// qualified preparer.
//
// All money stays in INTEGER CENTS internally. Dollar strings are derived
// only at serialization time via (cents / 100).toFixed(2), which preserves
// exact cents because the inputs are integers.
//
// Framework-free (no React, no DOM) so it is unit-testable; the caller
// (TaxReportsModule) owns the side-effects (download, print).
// ============================================================

import type {
  TaxExpense,
  TaxIncomeEntry,
  TaxSupplierPurchase,
  TaxSupplierReturn,
  PartnershipMember,
  Expense,
} from '@/store/types';
import { calcMemberK1 } from '@/modules/tax/taxData';

// ── Locale ───────────────────────────────────────────────
export type OrgLocale = 'en' | 'es' | 'pt';

// ── Entity / filing mode ─────────────────────────────────
// Tax treatment is an EXPLICIT choice (settings.taxEntityMode); it must
// NOT be inferred from member count. When the setting is absent the caller
// passes entityModeConfigured=false and a fallback is used + a warning.
//   'sole_prop'   → Schedule C (Form 1040) / CA Schedule CA (540)
//   'partnership' → Form 1065 + K-1 / CA Form 568 + CA Schedule K-1 (568)
//   's_corp'      → Form 1120-S + K-1 / CA Form 100S
//   'c_corp'      → Form 1120 / CA Form 100
export type OrgEntityMode = 'sole_prop' | 'partnership' | 's_corp' | 'c_corp';

/** Self-employment tax applies only to sole proprietors and partners. */
function modeHasSelfEmploymentTax(mode: OrgEntityMode): boolean {
  return mode === 'sole_prop' || mode === 'partnership';
}

/** The CA $800 minimum tax / 568 LLC fee applies to LLCs & corporations. */
function modeIsCaLlcOrCorp(mode: OrgEntityMode): boolean {
  return mode !== 'sole_prop';
}

/** CA Form 568 estimated LLC fee tier (cents), keyed on total CA income. */
function caLlcFeeTier(grossCents: number): { feeCents: number; tier: string } {
  const d = grossCents / 100;
  if (d < 250000) return { feeCents: 0, tier: 'under $250,000 → $0' };
  if (d < 500000) return { feeCents: 90000, tier: '$250,000–$499,999 → $900' };
  if (d < 1000000) return { feeCents: 250000, tier: '$500,000–$999,999 → $2,500' };
  if (d < 5000000) return { feeCents: 600000, tier: '$1,000,000–$4,999,999 → $6,000' };
  return { feeCents: 1179000, tier: '$5,000,000+ → $11,790' };
}

const CASINO_MESSAGE = 'Casino play will be reconciled later and is excluded from this organizer.';

export const ORGANIZER_DISCLAIMER =
  'This organizer is for tax-preparer entry support only. Final form placement must be reviewed by a qualified tax professional.';

// ── Input contract ───────────────────────────────────────
// Everything here is READ from the TaxReportsModule `annual` memo,
// `settings`, and the year's taxData. Cents are integers.
export interface TaxOrganizerInput {
  year: number;
  locale: OrgLocale;
  entityMode: OrgEntityMode;
  /** false when settings.taxEntityMode was absent and a fallback was used. */
  entityModeConfigured: boolean;

  business: {
    name: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    phone: string;
    email: string;
    ein: string;
  };

  // Pre-computed canonical totals (cents) — copied verbatim from `annual`.
  totals: {
    totalIncome: number;        // annual.displayTotalIncome (pre-COGS)
    posProfit: number;          // annual.totalIncome (POS net profit)
    manualIncome: number;       // annual.taxIncomeAdditional
    cogs: number;               // annual.cogsV1
    operatingExpenses: number;  // annual.operatingExpensesV1
    netProfit: number;          // annual.netProfit
    guaranteedPayments: number; // annual.guaranteedPaymentsTotal
  };

  posIncomeBreakdown: {
    productGross: number;
    productCOGS: number;
    productProfit: number;
    phoneGross: number;
    phonePaidToCarrier: number;
    phoneNetCommission: number;
    repairRevenue: number;
    repairCOGS: number;
    repairProfit: number;
  };

  manualIncomeEntries: TaxIncomeEntry[];
  suppliers: TaxSupplierPurchase[];
  supplierReturns: TaxSupplierReturn[];
  inventory: { beginningInventory: number; endingInventory: number };
  taxExpenses: TaxExpense[];     // settings.taxData.byYear[year].expenses
  generalExpenses: Expense[];     // state.expenses for the year
  adjustments: { otherIncome: number; returnsRefunds: number };
  members: PartnershipMember[];
}

// ── Output shapes ────────────────────────────────────────
export interface OrganizerRow {
  year: number;
  section: string;
  category: string;
  vendor: string;
  description: string;
  amount: number;            // cents
  deductibleAmount: number;  // cents (meals at 50%, pass-through at 0, etc.)
  federalForm: string;
  federalLine: string;
  californiaForm: string;
  californiaLine: string;
  whereThisGoes: string;
  preparerNotes: string;
  notes: string;
}

export type WarningLevel = 'info' | 'warning' | 'error';
export interface OrganizerWarning {
  level: WarningLevel;
  code: string;
  message: string;
}

export interface OrganizerCategoryBucket {
  category: string;
  amountCents: number;
  deductibleCents: number;
  rowCount: number;
}

export interface OrganizerMemberSplit {
  name: string;
  ownershipPct: number;
  ordinaryIncomeShare: number; // cents
  guaranteedPayments: number;  // cents
  netSEEarnings: number;       // cents (K-1 Box 14 Code A)
  seTax: number;               // cents
  endingCapital: number;       // cents
}

export interface TaxOrganizer {
  meta: {
    schema: 'tax-organizer-v1';
    year: number;
    locale: OrgLocale;
    entityMode: OrgEntityMode;
    entityModeConfigured: boolean;
    currency: 'USD';
    moneyUnit: 'dollars';
    disclaimer: string;
    casinoPlayIncluded: false;
    casinoAdjustmentPending: true;
    casinoMessage: string;
  };
  /** Ordered federal form-flow chain for net profit + SE tax. */
  taxFlow: string[];
  business: TaxOrganizerInput['business'];
  summary: {
    totalIncome: string;
    posProfit: string;
    manualIncome: string;
    cogs: string;
    operatingExpenses: string;
    guaranteedPayments: string;
    netProfit: string;
  };
  income: {
    pos: {
      productProfit: string; productGross: string; productCOGS: string;
      phoneNetCommission: string; phoneGross: string; phonePaidToCarrier: string;
      repairProfit: string; repairRevenue: string; repairCOGS: string;
    };
    manualEntries: Array<{ date: string; source: string; category: string; amount: string; notes: string }>;
    adjustments: { otherIncome: string; returnsRefunds: string };
    total: string;
  };
  cogs: {
    beginningInventory: string;
    endingInventory: string;
    supplierPurchases: string;
    cogsCategoryExpenses: string;
    refundedReturns: string;
    total: string;
    supplierRows: Array<{ date: string; vendor: string; items: string; amount: string }>;
  };
  operatingExpenses: {
    byCategory: OrganizerCategoryBucket[];
    total: string;
    totalDeductible: string;
  };
  categories: {
    vehicle: string; rent: string; utilities: string; insurance: string;
    supplies: string; repairs: string; fees: string;
    meals: string; mealsDeductible: string;
  };
  netProfit: string;
  memberSplit: OrganizerMemberSplit[];
  // ── Federal flow ──
  federalMapping: {
    grossIncome: { line: string; where: string };
    cogs: { line: string; where: string };
    grossProfit: { line: string; where: string };
    netProfit: { line: string; where: string };
    selfEmploymentTax: { amount: string; where: string };
    // partnership-only
    form1065?: {
      line1aGrossReceipts: string;
      line2Cogs: string;
      line8TotalIncome: string;
      line10GuaranteedPayments: string;
      line22Or23OrdinaryIncome: string;
      k1: Array<{ member: string; box1OrdinaryIncome: string; box4GuaranteedPayments: string; box14SelfEmployment: string }>;
    };
  };
  // ── California flow (Form 568 for LLC) ──
  californiaMapping: {
    form: string;                 // 'CA Form 568' | 'CA Schedule CA (540)'
    llcGrossReceipts: string;
    totalIncome: string;
    totalDeductions: string;
    ordinaryIncomeLoss: string;
    memberAllocation: Array<{ member: string; pct: number; ordinaryShare: string; capitalEnding: string }>;
    caAdjustments: string;
    notes: string[];
  };
  // ── CA Form 568 structured block (numeric, cents) ──
  // Per auditor spec: annualTax800 is a boolean (does the $800 minimum
  // franchise tax apply); the money fields are integer CENTS.
  californiaForm568: {
    annualTax800: boolean;
    annualTax800Cents: number;
    estimatedFee: number;        // cents — LLC fee tier
    estimatedFeeTier: string;
    totalIncome: number;         // cents
    ordinaryIncome: number;      // cents
    caAdjustmentsPending: number; // cents — placeholder (0 in V1)
    memberAllocations: Array<{ member: string; pct: number; ordinaryShare: number; capitalEnding: number }>;
    notes: string[];
  };
  scheduleCMapping: Array<{ line: string; label: string; amount: string }>;
  rows: OrganizerRow[];
  warnings: OrganizerWarning[];
  notes: string[];
}

// ── Money helpers ────────────────────────────────────────
/** Integer cents → fixed dollar string. Exact: inputs are integers. */
export function centsToFixed(cents: number): string {
  const c = Math.round(cents); // defensive; inputs should already be integers
  return (c / 100).toFixed(2);
}

// ── Category → tax-form mapping (federal + California) ────
// Covers BOTH the Tax Center TaxExpenseCategory keys and the general
// Expense ExpenseCategory keys. Federal = Schedule C (Form 1040). For a
// multi-member LLC, California amounts conform to federal and are entered
// on Form 568 (Schedule B / Schedule K) and allocated via CA Schedule
// K-1 (568). Reference: IRS Schedule C; FTB Form 568.
interface FormMap {
  fedForm: string;
  fedLine: string;
  caForm: string;
  caLine: string;
  whereThisGoes: string;
  preparerNotes: string;
  label: string;
}

const SCHED_C = 'Schedule C (Form 1040)';
const F568 = 'CA Form 568';
const CA_DEFAULT_NOTE = 'CA conforms to the federal amount: enter on Form 568 Schedule B and allocate to members via CA Schedule K-1 (568).';

function expMap(fedLine: string, label: string, note?: string): FormMap {
  return {
    fedForm: SCHED_C, fedLine,
    caForm: F568, caLine: 'Sch B (Deductions)',
    whereThisGoes: `${label} → Schedule C Line ${fedLine} → nets into Schedule C Line 31 (Net Profit)`,
    preparerNotes: note ? `${note} ${CA_DEFAULT_NOTE}` : CA_DEFAULT_NOTE,
    label,
  };
}

// Tax Center expense categories.
const TAX_EXP_MAP: Record<string, FormMap> = {
  'Inventory/COGS': { fedForm: SCHED_C, fedLine: '36', caForm: F568, caLine: 'Sch B Ln 2 (COGS)',
    whereThisGoes: 'Purchases → Schedule C Line 36 → Part III COGS Line 42 → Line 4',
    preparerNotes: 'Part III Cost of Goods Sold. CA: Form 568 Schedule B Line 2 (cost of goods sold).', label: 'Purchases (COGS)' },
  'Rent':           expMap('20b', 'Rent or lease — business property'),
  'Utilities':      expMap('25', 'Utilities'),
  'Internet/Phone': expMap('25', 'Utilities (internet/phone)', 'Internet/phone commonly reported under Utilities or Other expenses.'),
  'Advertising':    expMap('8', 'Advertising'),
  'Insurance':      expMap('15', 'Insurance (other than health)'),
  'Supplies':       expMap('22', 'Supplies'),
  'Repairs':        expMap('21', 'Repairs and maintenance'),
  'Fees':           expMap('27a', 'Merchant / bank fees (Other expenses)', 'Merchant/bank/processor fees → Part V Other expenses → Line 27a. Some preparers use Line 10 (Commissions and fees).'),
  'Software':       expMap('27a', 'Software / subscriptions (Other expenses)'),
  'Payroll':        expMap('26', 'Wages (less employment credits)', 'W-2 employee wages only; owner draws are NOT wages.'),
  'Licenses':       expMap('23', 'Taxes and licenses'),
  'Taxes':          expMap('23', 'Taxes and licenses'),
  'Meals':          { fedForm: SCHED_C, fedLine: '24b', caForm: F568, caLine: 'Sch B (Deductions)',
    whereThisGoes: 'Meals → Schedule C Line 24b (50% deductible) → Line 31',
    preparerNotes: 'Meals limited to 50% deductible (IRC §274(n)); the DeductibleAmount column already reflects 50%. ' + CA_DEFAULT_NOTE, label: 'Meals (50% deductible)' },
  'Vehicle':        { fedForm: SCHED_C, fedLine: '9', caForm: F568, caLine: 'Sch B (Deductions)',
    whereThisGoes: 'Car/truck → Schedule C Line 9 (or Form 4562 if depreciation/actual expense) → Line 31',
    preparerNotes: 'Standard mileage → Line 9. If actual-expense/depreciation is used, complete Form 4562. ' + CA_DEFAULT_NOTE, label: 'Car and truck expenses' },
  'Pass-through':   { fedForm: '—', fedLine: '—', caForm: '—', caLine: '—',
    whereThisGoes: 'Pass-through funds — NOT a deductible business expense',
    preparerNotes: 'Money collected on behalf of a third party; excluded from deductible expenses (DeductibleAmount = 0).', label: 'Pass-through (non-deductible)' },
  'Misc':           expMap('27a', 'Other expenses', 'Uncategorized — review and assign a specific Schedule C line.'),
};

// General (POS) Expense categories.
const GEN_EXP_MAP: Record<string, FormMap> = {
  rent:              expMap('20b', 'Rent or lease — business property'),
  payroll:           expMap('26', 'Wages (less employment credits)'),
  utilities:         expMap('25', 'Utilities'),
  parts_supplies:    expMap('22', 'Supplies'),
  marketing:         expMap('8', 'Advertising'),
  insurance:         expMap('15', 'Insurance (other than health)'),
  equipment:         { fedForm: SCHED_C, fedLine: '13', caForm: F568, caLine: 'Sch B (Deductions)',
    whereThisGoes: 'Equipment → Depreciation/§179 → Schedule C Line 13 (Form 4562) → Line 31',
    preparerNotes: 'Depreciation/Section 179 — complete Form 4562. CA may decouple from federal §179/bonus; verify on Form 568. ' + CA_DEFAULT_NOTE, label: 'Depreciation / Section 179' },
  carrier_fees:      expMap('27a', 'Commissions and fees (Other expenses)', 'Carrier/merchant fees → Other expenses Line 27a or Commissions & fees Line 10.'),
  software:          expMap('27a', 'Software / subscriptions (Other expenses)'),
  professional_fees: expMap('17', 'Legal and professional services'),
  taxes_licenses:    expMap('23', 'Taxes and licenses'),
  other:             expMap('27a', 'Other expenses', 'Uncategorized — review and assign a specific Schedule C line.'),
};

const OTHER_MAP: FormMap = expMap('27a', 'Other expenses');

const INCOME_MAP: FormMap = {
  fedForm: SCHED_C, fedLine: '1', caForm: F568, caLine: 'Sch B Ln 1 (Gross receipts)',
  whereThisGoes: 'Gross receipts/sales → Schedule C Line 1 → Gross income Line 7',
  preparerNotes: 'POS figures are reported NET of POS cost of goods on this organizer; on the return, report gross receipts (Line 1) and COGS (Part III) separately. ' + CA_DEFAULT_NOTE,
  label: 'Gross receipts',
};

// Friendly display labels for the canonical operating-expense buckets.
const BUCKET_FOR_TAX_CAT: Record<string, keyof TaxOrganizer['categories']> = {
  Vehicle: 'vehicle', Rent: 'rent', Utilities: 'utilities', Insurance: 'insurance',
  Supplies: 'supplies', Repairs: 'repairs', Fees: 'fees', Meals: 'meals',
};
const BUCKET_FOR_GEN_CAT: Record<string, keyof TaxOrganizer['categories']> = {
  rent: 'rent', utilities: 'utilities', insurance: 'insurance',
  parts_supplies: 'supplies', carrier_fees: 'fees',
};

const MEALS_DEDUCTIBLE_PCT = 0.5;

// ── Builder ──────────────────────────────────────────────
export function buildTaxOrganizer(input: TaxOrganizerInput): TaxOrganizer {
  const { year, locale, entityMode, business, totals, posIncomeBreakdown } = input;
  const rows: OrganizerRow[] = [];
  const warnings: OrganizerWarning[] = [];
  const notes: string[] = [];

  const pushRow = (r: { section: string; amount: number; category?: string; vendor?: string;
    description?: string; deductibleAmount?: number; map?: FormMap; notes?: string;
    whereThisGoes?: string; preparerNotes?: string }) => {
    rows.push({
      year,
      section: r.section,
      category: r.category ?? '',
      vendor: r.vendor ?? '',
      description: r.description ?? '',
      amount: r.amount,
      deductibleAmount: r.deductibleAmount ?? r.amount,
      federalForm: r.map?.fedForm ?? '',
      federalLine: r.map?.fedLine ?? '',
      californiaForm: r.map?.caForm ?? '',
      californiaLine: r.map?.caLine ?? '',
      whereThisGoes: r.whereThisGoes ?? r.map?.whereThisGoes ?? '',
      preparerNotes: r.preparerNotes ?? r.map?.preparerNotes ?? '',
      notes: r.notes ?? '',
    });
  };

  // ── Disclaimer marker row (keeps it visible in CSV) ────
  pushRow({
    section: 'Disclaimer', amount: 0, deductibleAmount: 0,
    description: ORGANIZER_DISCLAIMER,
    whereThisGoes: '—', preparerNotes: '—',
  });

  // ── Income rows ────────────────────────────────────────
  pushRow({ section: 'Income', category: 'POS — Product/Service Profit',
    description: 'POS product + service net profit', amount: posIncomeBreakdown.productProfit, map: INCOME_MAP });
  pushRow({ section: 'Income', category: 'POS — Phone Commission',
    description: 'Net carrier commission kept', amount: posIncomeBreakdown.phoneNetCommission, map: INCOME_MAP });
  pushRow({ section: 'Income', category: 'POS — Repair Profit',
    description: 'Repair revenue less parts', amount: posIncomeBreakdown.repairProfit, map: INCOME_MAP });
  for (const inc of input.manualIncomeEntries) {
    const passthrough = inc.category === 'Pass-Through Income';
    pushRow({
      section: 'Income', category: `Manual — ${inc.category}`,
      vendor: inc.source || '', description: inc.notes || inc.category,
      amount: inc.amount, deductibleAmount: passthrough ? 0 : inc.amount,
      map: INCOME_MAP,
      notes: passthrough ? 'Pass-through (excluded from taxable income)' : '',
    });
    if (!inc.source || !inc.source.trim()) {
      warnings.push({ level: 'warning', code: 'missing_vendor',
        message: `Income entry "${inc.category}" (${centsToFixed(inc.amount)}) is missing a source/vendor.` });
    }
    if (inc.amount < 0) {
      warnings.push({ level: 'warning', code: 'negative_value',
        message: `Income entry "${inc.category}" has a negative amount (${centsToFixed(inc.amount)}).` });
    }
  }
  if (input.adjustments.otherIncome) {
    pushRow({ section: 'Income', category: 'Adjustment — Other Income',
      description: 'Other income adjustment', amount: input.adjustments.otherIncome,
      map: { ...INCOME_MAP, fedLine: '6', whereThisGoes: 'Other business income → Schedule C Line 6 → Line 7' } });
  }
  if (input.adjustments.returnsRefunds) {
    pushRow({ section: 'Income', category: 'Adjustment — Returns/Refunds',
      description: 'Returns & refunds (reduces income)', amount: -Math.abs(input.adjustments.returnsRefunds),
      deductibleAmount: -Math.abs(input.adjustments.returnsRefunds),
      map: { ...INCOME_MAP, fedLine: '2', whereThisGoes: 'Returns and allowances → Schedule C Line 2' } });
  }

  // ── COGS rows ──────────────────────────────────────────
  const supplierRows: TaxOrganizer['cogs']['supplierRows'] = [];
  let supplierPurchaseTotal = 0;
  const cogsMap = TAX_EXP_MAP['Inventory/COGS'];
  for (const s of input.suppliers) {
    supplierPurchaseTotal += s.amount;
    supplierRows.push({ date: s.date, vendor: s.name, items: s.items, amount: centsToFixed(s.amount) });
    pushRow({
      section: 'COGS', category: 'Supplier Purchase', vendor: s.name || '',
      description: s.items || '', amount: s.amount, deductibleAmount: s.amount, map: cogsMap,
      notes: s.paymentMethod ? `Paid: ${s.paymentMethod}` : '',
    });
    if (!s.name || !s.name.trim()) {
      warnings.push({ level: 'warning', code: 'missing_vendor',
        message: `Supplier purchase (${centsToFixed(s.amount)}) is missing a supplier name.` });
    }
    if (s.amount < 0) {
      warnings.push({ level: 'warning', code: 'negative_value',
        message: `Supplier purchase from "${s.name}" has a negative amount (${centsToFixed(s.amount)}).` });
    }
  }
  let cogsCategoryExpenses = 0;
  for (const e of input.taxExpenses) {
    if (e.category !== 'Inventory/COGS') continue;
    cogsCategoryExpenses += e.amount;
    pushRow({
      section: 'COGS', category: 'Inventory/COGS Expense', vendor: e.vendor || '',
      description: e.notes || '', amount: e.amount, deductibleAmount: e.amount, map: cogsMap,
    });
    if (!e.vendor || !e.vendor.trim()) {
      warnings.push({ level: 'warning', code: 'missing_vendor',
        message: `COGS expense (${centsToFixed(e.amount)}) is missing a vendor.` });
    }
  }
  const refundedReturns = input.supplierReturns
    .filter((r) => r.status === 'Refunded')
    .reduce((sum, r) => sum + r.amount, 0);
  if (refundedReturns) {
    pushRow({ section: 'COGS', category: 'Refunded Returns',
      description: 'Refunded supplier returns (reduces COGS)', amount: -Math.abs(refundedReturns),
      deductibleAmount: -Math.abs(refundedReturns),
      map: { ...cogsMap, whereThisGoes: 'Reduces Purchases in Schedule C Part III (COGS)' } });
  }

  // ── Operating-expense rows ─────────────────────────────
  const bucketTotals: Record<string, number> = {
    vehicle: 0, rent: 0, utilities: 0, insurance: 0, supplies: 0, repairs: 0, fees: 0, meals: 0,
  };
  const byCategoryMap = new Map<string, OrganizerCategoryBucket>();
  const bumpCategory = (cat: string, amount: number, deductible: number) => {
    const cur = byCategoryMap.get(cat) ?? { category: cat, amountCents: 0, deductibleCents: 0, rowCount: 0 };
    cur.amountCents += amount;
    cur.deductibleCents += deductible;
    cur.rowCount += 1;
    byCategoryMap.set(cat, cur);
  };

  for (const e of input.taxExpenses) {
    if (e.category === 'Inventory/COGS') continue; // already in COGS
    const map = TAX_EXP_MAP[e.category] ?? OTHER_MAP;
    const isMeals = e.category === 'Meals';
    const isPassthrough = e.category === 'Pass-through';
    const deductible = isPassthrough ? 0 : isMeals ? Math.round(e.amount * MEALS_DEDUCTIBLE_PCT) : e.amount;
    pushRow({
      section: 'Operating Expense', category: e.category, vendor: e.vendor || '',
      description: e.notes || '', amount: e.amount, deductibleAmount: deductible, map,
    });
    if (!isPassthrough) bumpCategory(e.category, e.amount, deductible);
    const bucket = BUCKET_FOR_TAX_CAT[e.category];
    if (bucket) bucketTotals[bucket] += e.amount;
    if (!e.vendor || !e.vendor.trim()) {
      warnings.push({ level: 'warning', code: 'missing_vendor',
        message: `Expense "${e.category}" (${centsToFixed(e.amount)}) is missing a vendor.` });
    }
    if (e.category === 'Misc') {
      warnings.push({ level: 'info', code: 'uncategorized_expense',
        message: `Expense (${centsToFixed(e.amount)}, vendor "${e.vendor || '—'}") is categorized as Miscellaneous — review for a specific Schedule C line.` });
    }
    if (e.amount < 0) {
      warnings.push({ level: 'warning', code: 'negative_value',
        message: `Expense "${e.category}" has a negative amount (${centsToFixed(e.amount)}).` });
    }
  }

  for (const e of input.generalExpenses) {
    const map = GEN_EXP_MAP[e.category] ?? OTHER_MAP;
    pushRow({
      section: 'Operating Expense', category: `general:${e.category}`, vendor: e.vendor || '',
      description: e.description || '', amount: e.amount, deductibleAmount: e.amount, map,
      notes: e.notes || '',
    });
    bumpCategory(`general:${e.category}`, e.amount, e.amount);
    const bucket = BUCKET_FOR_GEN_CAT[e.category];
    if (bucket) bucketTotals[bucket] += e.amount;
    if (!e.vendor || !e.vendor.trim()) {
      warnings.push({ level: 'warning', code: 'missing_vendor',
        message: `General expense "${e.category}" (${centsToFixed(e.amount)}) is missing a vendor.` });
    }
    if (e.category === 'other') {
      warnings.push({ level: 'info', code: 'uncategorized_expense',
        message: `General expense (${centsToFixed(e.amount)}, vendor "${e.vendor || '—'}") uses category "other" — review for a specific Schedule C line.` });
    }
    if (e.amount < 0) {
      warnings.push({ level: 'warning', code: 'negative_value',
        message: `General expense "${e.category}" has a negative amount (${centsToFixed(e.amount)}).` });
    }
  }

  // ── Member split (50/50 etc.) + SE tax ─────────────────
  const memberSplit: OrganizerMemberSplit[] = input.members.map((m) => {
    const k1 = calcMemberK1(m, totals.netProfit);
    return {
      name: m.name,
      ownershipPct: m.ownershipPct || 0,
      ordinaryIncomeShare: Math.round(k1.ordinaryIncome),
      guaranteedPayments: m.guaranteedPayments || 0,
      netSEEarnings: Math.round(k1.netSEEarnings),
      seTax: Math.round(k1.seTax),
      endingCapital: Math.round(k1.endingCapital),
    };
  });
  const totalSeTax = memberSplit.reduce((s, m) => s + m.seTax, 0);
  for (const m of memberSplit) {
    pushRow({
      section: 'Member Split', category: 'K-1 Allocation', vendor: m.name,
      description: `${m.ownershipPct}% ownership — ordinary income share`,
      amount: m.ordinaryIncomeShare, deductibleAmount: m.ordinaryIncomeShare,
      map: {
        fedForm: 'Schedule K-1 (1065)', fedLine: 'Box 1', caForm: 'CA Schedule K-1 (568)', caLine: 'Col (d)',
        whereThisGoes: `K-1 Box 1 (ordinary income) ${centsToFixed(m.ordinaryIncomeShare)} → partner's Form 1040 Schedule E; CA Schedule K-1 (568) → Form 540`,
        preparerNotes: `GP Box 4 ${centsToFixed(m.guaranteedPayments)} · SE earnings Box 14A ${centsToFixed(m.netSEEarnings)} · SE tax ${centsToFixed(m.seTax)}`,
        label: 'K-1 allocation',
      },
    });
  }

  // ── Federal flow marker rows ───────────────────────────
  pushRow({
    section: 'Tax Flow', category: 'Net Profit', amount: totals.netProfit, deductibleAmount: totals.netProfit,
    description: 'Net business profit',
    map: {
      fedForm: SCHED_C, fedLine: '31', caForm: entityMode === 'partnership' ? F568 : 'CA Schedule CA (540)', caLine: 'Sch B Ln 23 (ordinary income)',
      whereThisGoes: entityMode === 'partnership'
        ? 'Ordinary business income → Form 1065 Line 22/23 → Schedule K → members; CA Form 568 Schedule B ordinary income'
        : 'Net profit → Schedule C Line 31 → Schedule 1 Line 3 → Form 1040 Line 8',
      preparerNotes: 'Net profit identity: Total Income − COGS − Operating Expenses (− guaranteed payments) = Net Profit.',
      label: 'Net profit',
    },
  });
  const hasSeTax = modeHasSelfEmploymentTax(entityMode);
  if (hasSeTax) {
    pushRow({
      section: 'Tax Flow', category: 'Self-Employment Tax', amount: totalSeTax, deductibleAmount: 0,
      description: 'Self-employment tax (informational)',
      map: {
        fedForm: 'Schedule SE', fedLine: 'Line 12', caForm: '—', caLine: '—',
        whereThisGoes: 'Self-employment tax → Schedule SE → Schedule 2 Line 21 → Form 1040 Line 23 (½ deduction → Schedule 1 Line 15)',
        preparerNotes: 'Computed from member net SE earnings × 15.3% (sum of K-1 allocations). CA has no separate SE tax.',
        label: 'Self-employment tax',
      },
    });
  } else {
    pushRow({
      section: 'Tax Flow', category: 'Self-Employment Tax', amount: 0, deductibleAmount: 0,
      description: 'Self-employment tax — not applicable',
      map: {
        fedForm: '—', fedLine: '—', caForm: '—', caLine: '—',
        whereThisGoes: `Self-employment tax does not apply to ${entityMode === 's_corp' ? 'S-corporation' : 'C-corporation'} distributions`,
        preparerNotes: 'Owner compensation for an S-corp/C-corp is paid as W-2 wages via payroll, not subject to SE tax.',
        label: 'Self-employment tax (n/a)',
      },
    });
  }

  // ── Federal form-flow chain (per auditor spec) ─────────
  const taxFlow = hasSeTax
    ? [
        'Schedule C Line 31',
        'Schedule 1 Line 3',
        'Form 1040 Line 8',
        'Schedule SE',
        'Schedule 2 Line 21',
        'Form 1040 Line 23',
      ]
    : entityMode === 's_corp'
      ? ['Form 1120-S', 'Schedule K-1 (1120-S)', "Shareholder Form 1040 Schedule E", 'CA Form 100S']
      : ['Form 1120', 'CA Form 100'];

  // ── Schedule C mapping (aggregate by federal line) ─────
  const schedCAgg = new Map<string, { line: string; label: string; amount: number }>();
  for (const r of rows) {
    if (r.federalForm !== SCHED_C || r.federalLine === '—' || !r.federalLine) continue;
    if (r.section === 'Tax Flow') continue; // net-profit marker isn't a line item
    const cur = schedCAgg.get(r.federalLine) ?? { line: r.federalLine, label: '', amount: 0 };
    if (!cur.label) {
      const found = Object.values({ ...TAX_EXP_MAP, ...GEN_EXP_MAP }).find((m) => m.fedLine === r.federalLine);
      cur.label = (found ?? (r.federalLine === '1' ? INCOME_MAP : OTHER_MAP)).label;
    }
    cur.amount += r.deductibleAmount;
    schedCAgg.set(r.federalLine, cur);
  }
  const scheduleCMapping = Array.from(schedCAgg.values())
    .sort((a, b) => parseFloat(a.line.replace(/[a-z]/g, '')) - parseFloat(b.line.replace(/[a-z]/g, '')))
    .map((x) => ({ line: x.line, label: x.label, amount: centsToFixed(x.amount) }));

  // ── Warnings: structural / cross-check ─────────────────
  warnings.push({ level: 'info', code: 'casino_not_included', message: CASINO_MESSAGE });

  if (!input.entityModeConfigured) {
    warnings.push({ level: 'warning', code: 'entity_mode_not_configured',
      message: `Tax entity mode not explicitly configured. Falling back to "${entityMode}" — set settings.taxEntityMode (sole_prop / partnership / s_corp / c_corp).` });
  }

  const ownershipSum = input.members.reduce((s, m) => s + (m.ownershipPct || 0), 0);
  if (entityMode === 'partnership') {
    if (input.members.length < 2) {
      warnings.push({ level: 'warning', code: 'mode_conflict',
        message: `Entity mode is Partnership (1065/568) but only ${input.members.length} member(s) are defined — a partnership requires 2+ members. Consider Schedule C (sole proprietor) mode.` });
    }
    if (input.members.length > 0 && Math.round(ownershipSum) !== 100) {
      warnings.push({ level: 'warning', code: 'mode_conflict',
        message: `Member ownership percentages sum to ${ownershipSum}% (must equal 100%).` });
    }
  } else if (entityMode === 'sole_prop' && input.members.length > 1) {
    warnings.push({ level: 'warning', code: 'mode_conflict',
      message: `Entity mode is Schedule C (sole proprietor) but ${input.members.length} members are defined — Schedule C allows a single owner. Consider Partnership (1065/568) mode.` });
  } else if ((entityMode === 's_corp' || entityMode === 'c_corp') && input.members.length > 0 && Math.round(ownershipSum) !== 100) {
    warnings.push({ level: 'warning', code: 'mode_conflict',
      message: `Shareholder ownership percentages sum to ${ownershipSum}% (must equal 100%).` });
  }

  const opexRowTotal = rows
    .filter((r) => r.section === 'Operating Expense')
    .reduce((s, r) => s + r.deductibleAmount, 0);
  if (opexRowTotal !== totals.operatingExpenses) {
    warnings.push({ level: 'error', code: 'total_mismatch',
      message: `Operating-expense rows sum to ${centsToFixed(opexRowTotal)} but the summary reports ${centsToFixed(totals.operatingExpenses)} (delta ${centsToFixed(opexRowTotal - totals.operatingExpenses)}).` });
  }
  const expectedNet = totals.totalIncome - totals.cogs - totals.operatingExpenses - totals.guaranteedPayments;
  if (expectedNet !== totals.netProfit) {
    warnings.push({ level: 'error', code: 'total_mismatch',
      message: `Net profit identity off: totalIncome − COGS − operatingExpenses − guaranteedPayments = ${centsToFixed(expectedNet)} but summary net profit is ${centsToFixed(totals.netProfit)} (delta ${centsToFixed(expectedNet - totals.netProfit)}).` });
  }
  for (const [k, v] of Object.entries(totals)) {
    if (typeof v === 'number' && v < 0 && k !== 'netProfit') {
      warnings.push({ level: 'warning', code: 'negative_value',
        message: `Summary total "${k}" is negative (${centsToFixed(v)}).` });
    }
  }

  // ── Notes ──────────────────────────────────────────────
  notes.push(ORGANIZER_DISCLAIMER);
  notes.push('All amounts derived from already-computed Tax Center totals; no tax math was recomputed by this export.');
  notes.push('Meals are reported at 50% deductible per IRC §274(n); the DeductibleAmount column reflects the 50% figure.');
  notes.push(`Net profit identity: Total Income (${centsToFixed(totals.totalIncome)}) − COGS (${centsToFixed(totals.cogs)}) − Operating Expenses (${centsToFixed(totals.operatingExpenses)}) = Net Profit (${centsToFixed(totals.netProfit)}).`);
  if (entityMode === 'partnership') {
    notes.push('Federal: partnership ordinary income → Form 1065 → Schedule K-1 per member. California: Form 568 + CA Schedule K-1 (568).');
  } else {
    notes.push('Federal: net profit → Schedule C Line 31 → Schedule 1 Line 3 → Form 1040 Line 8. SE tax → Schedule SE → Schedule 2 → Form 1040 Line 23.');
  }

  // ── Assemble ───────────────────────────────────────────
  const cogsTotal = input.inventory.beginningInventory + supplierPurchaseTotal + cogsCategoryExpenses
    - refundedReturns - input.inventory.endingInventory;
  const totalDeductionsCA = totals.cogs + totals.operatingExpenses + totals.guaranteedPayments;

  // CA Form 568: $800 min franchise tax + LLC fee tier on total CA income.
  const caGrossCents = posIncomeBreakdown.productGross + posIncomeBreakdown.repairRevenue + posIncomeBreakdown.phoneGross;
  const isCaLlcOrCorp = modeIsCaLlcOrCorp(entityMode);
  const isLlc = entityMode === 'partnership';
  const feeTier = caLlcFeeTier(caGrossCents);

  return {
    meta: {
      schema: 'tax-organizer-v1', year, locale, entityMode,
      entityModeConfigured: input.entityModeConfigured,
      currency: 'USD', moneyUnit: 'dollars', disclaimer: ORGANIZER_DISCLAIMER,
      casinoPlayIncluded: false, casinoAdjustmentPending: true, casinoMessage: CASINO_MESSAGE,
    },
    taxFlow,
    business,
    summary: {
      totalIncome: centsToFixed(totals.totalIncome),
      posProfit: centsToFixed(totals.posProfit),
      manualIncome: centsToFixed(totals.manualIncome),
      cogs: centsToFixed(totals.cogs),
      operatingExpenses: centsToFixed(totals.operatingExpenses),
      guaranteedPayments: centsToFixed(totals.guaranteedPayments),
      netProfit: centsToFixed(totals.netProfit),
    },
    income: {
      pos: {
        productProfit: centsToFixed(posIncomeBreakdown.productProfit),
        productGross: centsToFixed(posIncomeBreakdown.productGross),
        productCOGS: centsToFixed(posIncomeBreakdown.productCOGS),
        phoneNetCommission: centsToFixed(posIncomeBreakdown.phoneNetCommission),
        phoneGross: centsToFixed(posIncomeBreakdown.phoneGross),
        phonePaidToCarrier: centsToFixed(posIncomeBreakdown.phonePaidToCarrier),
        repairProfit: centsToFixed(posIncomeBreakdown.repairProfit),
        repairRevenue: centsToFixed(posIncomeBreakdown.repairRevenue),
        repairCOGS: centsToFixed(posIncomeBreakdown.repairCOGS),
      },
      manualEntries: input.manualIncomeEntries.map((i) => ({
        date: i.date, source: i.source, category: i.category,
        amount: centsToFixed(i.amount), notes: i.notes || '',
      })),
      adjustments: {
        otherIncome: centsToFixed(input.adjustments.otherIncome),
        returnsRefunds: centsToFixed(input.adjustments.returnsRefunds),
      },
      total: centsToFixed(totals.totalIncome),
    },
    cogs: {
      beginningInventory: centsToFixed(input.inventory.beginningInventory),
      endingInventory: centsToFixed(input.inventory.endingInventory),
      supplierPurchases: centsToFixed(supplierPurchaseTotal),
      cogsCategoryExpenses: centsToFixed(cogsCategoryExpenses),
      refundedReturns: centsToFixed(refundedReturns),
      total: centsToFixed(cogsTotal),
      supplierRows,
    },
    operatingExpenses: {
      byCategory: Array.from(byCategoryMap.values()).sort((a, b) => b.deductibleCents - a.deductibleCents),
      total: centsToFixed(opexRowTotal),
      totalDeductible: centsToFixed(opexRowTotal),
    },
    categories: {
      vehicle: centsToFixed(bucketTotals.vehicle),
      rent: centsToFixed(bucketTotals.rent),
      utilities: centsToFixed(bucketTotals.utilities),
      insurance: centsToFixed(bucketTotals.insurance),
      supplies: centsToFixed(bucketTotals.supplies),
      repairs: centsToFixed(bucketTotals.repairs),
      fees: centsToFixed(bucketTotals.fees),
      meals: centsToFixed(bucketTotals.meals),
      mealsDeductible: centsToFixed(Math.round(bucketTotals.meals * MEALS_DEDUCTIBLE_PCT)),
    },
    netProfit: centsToFixed(totals.netProfit),
    memberSplit,
    federalMapping: {
      grossIncome: { line: 'Schedule C Line 1', where: 'Gross receipts/sales → Line 1 → Gross income Line 7' },
      cogs: { line: 'Schedule C Part III Line 42', where: 'COGS → Part III Line 42 → Line 4 (subtracted from gross receipts)' },
      grossProfit: { line: 'Schedule C Line 5', where: 'Gross receipts (Line 1) − COGS (Line 4) = Gross profit (Line 5)' },
      netProfit: { line: 'Schedule C Line 31', where: 'Line 31 → Schedule 1 Line 3 → Form 1040 Line 8' },
      selfEmploymentTax: { amount: centsToFixed(hasSeTax ? totalSeTax : 0), where: hasSeTax ? 'Schedule SE → Schedule 2 Line 21 → Form 1040 Line 23' : 'Not applicable (S-corp/C-corp owner pay is W-2 wages)' },
      ...(entityMode === 'partnership' ? {
        form1065: {
          line1aGrossReceipts: centsToFixed(posIncomeBreakdown.productGross + posIncomeBreakdown.repairRevenue),
          line2Cogs: centsToFixed(totals.cogs),
          line8TotalIncome: centsToFixed(totals.totalIncome),
          line10GuaranteedPayments: centsToFixed(totals.guaranteedPayments),
          line22Or23OrdinaryIncome: centsToFixed(totals.netProfit),
          k1: memberSplit.map((m) => ({
            member: m.name,
            box1OrdinaryIncome: centsToFixed(m.ordinaryIncomeShare),
            box4GuaranteedPayments: centsToFixed(m.guaranteedPayments),
            box14SelfEmployment: centsToFixed(m.netSEEarnings),
          })),
        },
      } : {}),
    },
    californiaMapping: {
      form: entityMode === 'partnership' ? 'CA Form 568 (LLC Return of Income)'
        : entityMode === 's_corp' ? 'CA Form 100S (S Corporation)'
        : entityMode === 'c_corp' ? 'CA Form 100 (Corporation)'
        : 'CA Schedule CA (540) / Schedule C',
      llcGrossReceipts: centsToFixed(posIncomeBreakdown.productGross + posIncomeBreakdown.repairRevenue + posIncomeBreakdown.phoneGross),
      totalIncome: centsToFixed(totals.totalIncome),
      totalDeductions: centsToFixed(totalDeductionsCA),
      ordinaryIncomeLoss: centsToFixed(totals.netProfit),
      memberAllocation: memberSplit.map((m) => ({
        member: m.name, pct: m.ownershipPct,
        ordinaryShare: centsToFixed(m.ordinaryIncomeShare),
        capitalEnding: centsToFixed(m.endingCapital),
      })),
      caAdjustments: centsToFixed(0),
      notes: [
        'Form 568: LLC gross receipts may trigger the CA LLC fee (FTB) in addition to the $800 minimum franchise tax — verify the fee tier.',
        'Ordinary income/loss flows to CA Schedule K (568) and is allocated to members via CA Schedule K-1 (568).',
        'CA may decouple from federal on §179/bonus depreciation and some deductions — review CA adjustments (currently 0; none detected by this V1 export).',
      ],
    },
    californiaForm568: {
      annualTax800: isCaLlcOrCorp,
      annualTax800Cents: isCaLlcOrCorp ? 80000 : 0,
      estimatedFee: isLlc ? feeTier.feeCents : 0,
      estimatedFeeTier: isLlc ? feeTier.tier : 'n/a (LLC fee applies to LLCs only)',
      totalIncome: totals.totalIncome,
      ordinaryIncome: totals.netProfit,
      caAdjustmentsPending: 0,
      memberAllocations: memberSplit.map((m) => ({
        member: m.name,
        pct: m.ownershipPct,
        ordinaryShare: m.ordinaryIncomeShare,
        capitalEnding: m.endingCapital,
      })),
      notes: [
        isCaLlcOrCorp
          ? `CA $800 minimum franchise tax applies (FTB Form ${isLlc ? '568' : entityMode === 's_corp' ? '100S' : '100'}).`
          : 'Sole proprietor: no $800 CA minimum franchise tax (reported on owner Form 540).',
        isLlc
          ? `Estimated CA LLC fee tier on gross receipts ${centsToFixed(caGrossCents)}: ${feeTier.tier}. Verify against FTB Form 3536.`
          : 'CA LLC fee (Form 568) applies only to LLCs.',
        'Member capital / 50-50 profit allocation flows to CA Schedule K-1 (568). caAdjustmentsPending is a V1 placeholder (0).',
        'Money fields in this block are integer CENTS.',
      ],
    },
    scheduleCMapping,
    rows,
    warnings,
    notes,
  };
}

// ── CSV serializer ───────────────────────────────────────
const CSV_HEADERS = [
  'Year', 'Section', 'Category', 'Vendor', 'Description',
  'Amount', 'DeductibleAmount',
  'FederalForm', 'FederalLine', 'CaliforniaForm', 'CaliforniaLine',
  'WhereThisGoes', 'PreparerNotes', 'Notes',
];

/** RFC-4180-ish field escaping. */
function csvCell(v: string | number): string {
  const s = String(v ?? '');
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function organizerToCsv(org: TaxOrganizer): string {
  const lines: string[] = [CSV_HEADERS.join(',')];
  for (const r of org.rows) {
    lines.push([
      r.year,
      csvCell(r.section),
      csvCell(r.category),
      csvCell(r.vendor),
      csvCell(r.description),
      centsToFixed(r.amount),
      centsToFixed(r.deductibleAmount),
      csvCell(r.federalForm),
      csvCell(r.federalLine),
      csvCell(r.californiaForm),
      csvCell(r.californiaLine),
      csvCell(r.whereThisGoes),
      csvCell(r.preparerNotes),
      csvCell(r.notes),
    ].join(','));
  }
  return lines.join('\r\n');
}

// ── Print HTML serializer ────────────────────────────────
function escHtml(s: unknown): string {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const PRINT_STRINGS: Record<OrgLocale, Record<string, string>> = {
  en: {
    title: 'Tax Organizer', summary: 'Year Summary', totalIncome: 'Total Income',
    cogs: 'COGS', operatingExpenses: 'Operating Expenses', netProfit: 'Net Profit',
    expenses: 'Operating Expenses by Category', members: 'Member Split (K-1 / 568)',
    schedC: 'Schedule C Mapping', california: 'California — Form 568',
    warnings: 'Warnings & Notes', category: 'Category',
    amount: 'Amount', deductible: 'Deductible', line: 'Line', member: 'Member', share: 'Share',
    federalFlow: 'Federal Flow', generated: 'Generated by CellHub Pro · Tax Organizer V1',
  },
  es: {
    title: 'Organizador Fiscal', summary: 'Resumen Anual', totalIncome: 'Ingreso Total',
    cogs: 'COGS', operatingExpenses: 'Gastos Operativos', netProfit: 'Utilidad Neta',
    expenses: 'Gastos Operativos por Categoría', members: 'Reparto entre Socios (K-1 / 568)',
    schedC: 'Mapeo Schedule C', california: 'California — Form 568',
    warnings: 'Advertencias y Notas', category: 'Categoría',
    amount: 'Monto', deductible: 'Deducible', line: 'Línea', member: 'Socio', share: 'Parte',
    federalFlow: 'Flujo Federal', generated: 'Generado por CellHub Pro · Organizador Fiscal V1',
  },
  pt: {
    title: 'Organizador Fiscal', summary: 'Resumo Anual', totalIncome: 'Receita Total',
    cogs: 'COGS', operatingExpenses: 'Despesas Operacionais', netProfit: 'Lucro Líquido',
    expenses: 'Despesas Operacionais por Categoria', members: 'Divisão entre Sócios (K-1 / 568)',
    schedC: 'Mapeamento Schedule C', california: 'California — Form 568',
    warnings: 'Avisos e Notas', category: 'Categoria',
    amount: 'Valor', deductible: 'Dedutível', line: 'Linha', member: 'Sócio', share: 'Parte',
    federalFlow: 'Fluxo Federal', generated: 'Gerado pelo CellHub Pro · Organizador Fiscal V1',
  },
};

export function organizerToPrintHtml(org: TaxOrganizer): string {
  const S = PRINT_STRINGS[org.meta.locale] ?? PRINT_STRINGS.en;
  const b = org.business;
  const warnRows = org.warnings.map((w) =>
    `<li class="w-${escHtml(w.level)}"><b>${escHtml(w.level.toUpperCase())}</b> — ${escHtml(w.message)}</li>`).join('');
  const expRows = org.operatingExpenses.byCategory.map((c) =>
    `<tr><td>${escHtml(c.category)}</td><td class="r">$${escHtml(centsToFixed(c.amountCents))}</td><td class="r">$${escHtml(centsToFixed(c.deductibleCents))}</td></tr>`).join('');
  const schedRows = org.scheduleCMapping.map((m) =>
    `<tr><td>${escHtml(m.line)}</td><td>${escHtml(m.label)}</td><td class="r">$${escHtml(m.amount)}</td></tr>`).join('');
  const memberRows = org.memberSplit.map((m) =>
    `<tr><td>${escHtml(m.name)}</td><td class="r">${escHtml(m.ownershipPct)}%</td><td class="r">$${escHtml(centsToFixed(m.ordinaryIncomeShare))}</td></tr>`).join('');
  const fm = org.federalMapping;
  const ca = org.californiaMapping;
  const f568 = org.californiaForm568;
  const entityLabel = org.meta.entityMode === 'partnership' ? 'Partnership / LLC (1065 · CA 568)'
    : org.meta.entityMode === 's_corp' ? 'S-Corporation (1120-S · CA 100S)'
    : org.meta.entityMode === 'c_corp' ? 'C-Corporation (1120 · CA 100)'
    : 'Sole Proprietor (Schedule C · CA 540)';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escHtml(S.title)} ${org.meta.year}</title><style>
    @page{size:letter;margin:0.5in}*{margin:0;padding:0;box-sizing:border-box}
    body{font-family:Arial,Helvetica,sans-serif;font-size:10pt;color:#111;background:#fff;padding:0.25in}
    h1{font-size:16pt;margin-bottom:2px}h2{font-size:11pt;margin:14px 0 4px;border-bottom:1px solid #999;padding-bottom:2px}
    .muted{color:#555;font-size:8.5pt}
    .disc{background:#fef3c7;border:1px solid #f59e0b;border-radius:6px;padding:7px 10px;font-size:8.5pt;color:#92400e;margin:8px 0}
    table{width:100%;border-collapse:collapse;margin-top:4px}th,td{padding:3px 6px;border-bottom:1px solid #ddd;font-size:9pt;text-align:left}
    th{background:#f3f3f3;font-weight:700}td.r,th.r{text-align:right}
    .summary{display:flex;gap:18px;flex-wrap:wrap;margin-top:8px}
    .stat{border:1px solid #ccc;border-radius:6px;padding:8px 12px;min-width:120px}
    .stat .lbl{font-size:8pt;color:#666;text-transform:uppercase}.stat .val{font-size:14pt;font-weight:800}
    ul{margin:6px 0 0 18px}li{font-size:8.5pt;margin:2px 0}
    .flow li{list-style:none;margin:3px 0}
    .w-error{color:#b91c1c}.w-warning{color:#b45309}.w-info{color:#1d4ed8}
    .foot{margin-top:18px;font-size:8pt;color:#888}
  </style></head><body>
    <h1>${escHtml(S.title)} — ${org.meta.year}</h1>
    <div class="muted">${escHtml(b.name)}${b.ein ? ' · EIN ' + escHtml(b.ein) : ''}<br>
      ${escHtml(b.address)} ${escHtml(b.city)} ${escHtml(b.state)} ${escHtml(b.zip)}<br>
      ${escHtml(b.phone)}${b.email ? ' · ' + escHtml(b.email) : ''} · ${escHtml(entityLabel)}${org.meta.entityModeConfigured ? '' : ' ⚠️ mode not configured'}</div>

    <div class="disc">${escHtml(org.meta.disclaimer)}</div>

    <h2>${escHtml(S.summary)}</h2>
    <div class="summary">
      <div class="stat"><div class="lbl">${escHtml(S.totalIncome)}</div><div class="val">$${escHtml(org.summary.totalIncome)}</div></div>
      <div class="stat"><div class="lbl">${escHtml(S.cogs)}</div><div class="val">$${escHtml(org.summary.cogs)}</div></div>
      <div class="stat"><div class="lbl">${escHtml(S.operatingExpenses)}</div><div class="val">$${escHtml(org.summary.operatingExpenses)}</div></div>
      <div class="stat"><div class="lbl">${escHtml(S.netProfit)}</div><div class="val">$${escHtml(org.summary.netProfit)}</div></div>
    </div>

    <h2>${escHtml(S.federalFlow)}</h2>
    <ul class="flow">
      <li>📥 ${escHtml(fm.grossIncome.where)}</li>
      <li>📦 ${escHtml(fm.cogs.where)}</li>
      <li>➖ ${escHtml(fm.grossProfit.where)}</li>
      <li>✅ ${escHtml(fm.netProfit.where)} — <b>$${escHtml(org.summary.netProfit)}</b></li>
      <li>🧾 ${escHtml(fm.selfEmploymentTax.where)} — $${escHtml(fm.selfEmploymentTax.amount)}</li>
    </ul>

    <h2>${escHtml(S.expenses)}</h2>
    <table><thead><tr><th>${escHtml(S.category)}</th><th class="r">${escHtml(S.amount)}</th><th class="r">${escHtml(S.deductible)}</th></tr></thead><tbody>${expRows}</tbody></table>

    <h2>${escHtml(S.schedC)}</h2>
    <table><thead><tr><th>${escHtml(S.line)}</th><th>${escHtml(S.category)}</th><th class="r">${escHtml(S.amount)}</th></tr></thead><tbody>${schedRows}</tbody></table>

    <h2>${escHtml(S.california)} (${escHtml(ca.form)})</h2>
    <table><tbody>
      <tr><td>LLC Gross Receipts</td><td class="r">$${escHtml(ca.llcGrossReceipts)}</td></tr>
      <tr><td>Total Income</td><td class="r">$${escHtml(ca.totalIncome)}</td></tr>
      <tr><td>Total Deductions</td><td class="r">$${escHtml(ca.totalDeductions)}</td></tr>
      <tr><td>Ordinary Income/Loss</td><td class="r">$${escHtml(ca.ordinaryIncomeLoss)}</td></tr>
      <tr><td>$800 Annual Minimum Tax</td><td class="r">${f568.annualTax800 ? '$' + escHtml(centsToFixed(f568.annualTax800Cents)) : 'n/a'}</td></tr>
      <tr><td>Estimated LLC Fee (${escHtml(f568.estimatedFeeTier)})</td><td class="r">$${escHtml(centsToFixed(f568.estimatedFee))}</td></tr>
      <tr><td>CA Adjustments</td><td class="r">$${escHtml(ca.caAdjustments)}</td></tr>
    </tbody></table>

    ${memberRows ? `<h2>${escHtml(S.members)}</h2>
    <table><thead><tr><th>${escHtml(S.member)}</th><th class="r">%</th><th class="r">${escHtml(S.share)}</th></tr></thead><tbody>${memberRows}</tbody></table>` : ''}

    <h2>${escHtml(S.warnings)}</h2>
    <ul>${warnRows}${org.notes.map((n) => `<li class="w-info">${escHtml(n)}</li>`).join('')}</ul>

    <div class="foot">${escHtml(S.generated)} · ${escHtml(org.meta.schema)}</div>
  </body></html>`;
}
