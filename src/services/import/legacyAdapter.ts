// ============================================================
// CellHub Pro — Legacy v1 → v2 Import Adapter
// Normalizes v1 shape (dollars, field name variants, case-insensitive
// categories/statuses) to v2 canonical shape (cents, Title Case,
// plural categories, storeId-tagged).
//
// This adapter owns ALL migration vocabulary. storage.ts delegates
// to it — never adds mapping logic inline.
//
// Port of scripts/legacy/migrate-v1-to-v2.js (retired standalone
// script). Future adapters follow the same pattern:
//   src/services/import/<source>Adapter.ts
// ============================================================

// ── Types ────────────────────────────────────────────────────

export interface NormalizationStats {
  total: number;
  converted: number;
  passthrough: number;
}

export interface NormalizationResult {
  /** Normalized data object ready for storage.ts to merge into localStorage. */
  normalized: Record<string, unknown>;
  /** Per-collection counters. */
  stats: Record<string, NormalizationStats>;
  /** Non-fatal issues the user should review. */
  warnings: string[];
}

// ── Internal helpers (NOT exported) ──────────────────────────

/** Convert dollars (number or string) to cents (integer). */
function toCents(val: unknown): number {
  if (val === null || val === undefined || val === '') return 0;
  const n = typeof val === 'string' ? parseFloat(val) : Number(val);
  if (isNaN(n)) return 0;
  return Math.round(n * 100);
}

/** Safe date string — pass through if already ISO, convert if Date-like. */
function safeDate(val: unknown): string {
  if (!val) return new Date().toISOString();
  if (typeof val === 'string') return val;
  if (val instanceof Date) return val.toISOString();
  const anyVal = val as { toDate?: () => Date };
  if (typeof anyVal.toDate === 'function') return anyVal.toDate().toISOString();
  return new Date().toISOString();
}

/** Title Case a string (preserves word boundaries on spaces only). */
function titleCase(s: string): string {
  return String(s).split(' ').map((w) =>
    w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  ).join(' ');
}

// ── Mapping functions (exported — vocabulary source of truth) ─

export function mapItemCategory(cat: unknown): string {
  if (!cat || cat === '' || cat === null || cat === undefined) return 'Uncategorized';
  const c = String(cat).toLowerCase().trim();

  // Phone payment special category (v2 uses spaced Title Case)
  if (c === 'phone_payment' || c === 'phonepayment' || c === 'phone payment' || c === 'phone payments') return 'Phone Payments';

  // Inventory standard categories — plural Title Case
  if (c === 'phone' || c === 'phones') return 'Phones';
  if (c === 'accessory' || c === 'accessories') return 'Accessories';
  if (c === 'part' || c === 'parts') return 'Parts';
  if (c === 'service' || c === 'services' || c === 'servicio' || c === 'servicios') return 'Services';
  if (c === 'top_up' || c === 'topup' || c === 'top-up' || c === 'top-ups' || c === 'top up' || c === 'top ups') return 'Top-Ups';
  if (c === 'tablet' || c === 'tablets') return 'Tablets';
  if (c === 'ebike' || c === 'ebikes' || c === 'e-bike' || c === 'e-bikes') return 'Ebikes';
  if (c === 'hotspot' || c === 'hotspots') return 'Hotspots';
  if (c === 'laptop' || c === 'laptops') return 'Laptops';
  if (c === 'scooter' || c === 'scooters') return 'Scooters';

  // Order/sale special categories
  if (c === 'special_order' || c === 'special order' || c === 'special orders') return 'Special Orders';
  if (c === 'layaway' || c === 'layaways') return 'Layaways';
  if (c === 'return' || c === 'returns') return 'Returns';
  if (c === 'activation' || c === 'activations') return 'Activations';

  // Legacy catch
  if (c === 'uncategorized' || c === 'other') return 'Uncategorized';

  // Unknown category — Title Case attempt
  return titleCase(String(cat));
}

export function mapPaymentMethod(pm: unknown): string {
  if (!pm) return 'Cash';
  const p = String(pm).toLowerCase().trim();
  if (p === 'cash') return 'Cash';
  if (p === 'card' || p === 'credit card' || p === 'debit') return 'Card';
  if (p === 'split') return 'Split';
  if (p === 'store credit' || p === 'storecredit') return 'Store Credit';
  return titleCase(String(pm));
}

export function mapSaleStatus(
  status: unknown,
  sale: { voided?: boolean; refunded?: boolean },
): string {
  // R-IMPORT-SALES-FIXES Path B: output matches SaleStatus type
  // ('completed' | 'voided' | 'refunded' | 'partial_refund'), which is
  // lowercase per types.ts:496. Previously emitted Title Case which
  // bypassed ~40 consumer filters checking `s.status !== 'voided'` etc.
  if (sale.voided) return 'voided';
  if (sale.refunded) return 'refunded';
  if (!status) return 'completed';
  const s = String(status).toLowerCase().trim();
  if (s === 'completed' || s === 'complete') return 'completed';
  if (s === 'voided' || s === 'void') return 'voided';
  if (s === 'refunded' || s === 'refund') return 'refunded';
  if (s === 'partial_refund' || s === 'partial refund') return 'partial_refund';
  return 'completed';
}

export function mapRepairStatus(status: unknown): string {
  if (!status) return 'Pending';
  const s = String(status).toLowerCase().trim();
  if (s === 'complete' || s === 'completed') return 'Completed';
  if (s === 'received') return 'Received';
  if (s === 'cancelled' || s === 'canceled') return 'Cancelled';
  if (s === 'in_progress' || s === 'in progress' || s === 'working') return 'In Progress';
  if (s === 'ready' || s === 'picked_up' || s === 'picked up') return 'Picked Up';
  if (s === 'pending' || s === 'new') return 'Pending';
  return titleCase(String(status));
}

export function mapLayawayStatus(status: unknown): string {
  if (!status) return 'Active';
  const s = String(status).toLowerCase().trim();
  if (s === 'active' || s === 'open') return 'Active';
  if (s === 'completed' || s === 'complete' || s === 'paid') return 'Completed';
  if (s === 'cancelled' || s === 'canceled') return 'Cancelled';
  if (s === 'refunded') return 'Refunded';
  return titleCase(String(status));
}

export function mapSpecialOrderStatus(status: unknown): string {
  if (!status) return 'Ordered';
  const s = String(status).toLowerCase().trim();
  if (s === 'ordered') return 'Ordered';
  if (s === 'picked up' || s === 'picked_up' || s === 'pickedup') return 'Picked Up';
  if (s === 'received') return 'Received';
  if (s === 'cancelled' || s === 'canceled') return 'Cancelled';
  if (s === 'refunded') return 'Refunded';
  if (s === 'pending') return 'Pending';
  return titleCase(String(status));
}

export function mapRepairPriority(p: unknown): string {
  if (!p) return 'Normal';
  const s = String(p).toLowerCase().trim();
  if (s === 'high' || s === 'urgent' || s === 'rush') return 'High';
  if (s === 'low') return 'Low';
  return 'Normal';
}

// ── Legacy shape detection ───────────────────────────────────

export function isLegacyBackup(source: Record<string, unknown>): boolean {
  const inv = source.inventory as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(inv) && inv.length > 0) {
    const sample = inv[0];
    if ('costPrice' in sample || 'salePrice' in sample || 'quantity' in sample) return true;
    if (sample._migrated !== 'v2-cents') return true;
  }
  const reps = source.repairs as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(reps) && reps.length > 0) {
    if (typeof reps[0].laborCost === 'string') return true;
  }
  return false;
}

// ── Per-collection normalization (exported) ──────────────────

export function normalizeLegacyInventoryItem(item: Record<string, any>): Record<string, unknown> {
  if (item._migrated === 'v2-cents') return item;
  return {
    id: item.id,
    sku: item.sku || '',
    barcode: item.barcode || '',
    imei: item.imei || item.sku || '', // v1 sometimes puts IMEI in sku for phones
    name: item.name || '',
    description: item.description || '',
    category: mapItemCategory(item.category),
    condition: item.condition || 'New',
    brand: item.brand || '',
    cost: toCents(item.costPrice ?? item.cost ?? 0),        // v1: costPrice → v2: cost
    price: toCents(item.salePrice ?? item.price ?? 0),      // v1: salePrice → v2: price
    qty: item.quantity ?? item.qty ?? item.stock ?? 0,       // v1: quantity/stock → v2: qty
    minQty: item.minStockLevel ?? item.minQty ?? 0,
    cbeEligible: false,                                       // default, user adjusts per item
    screenFeeEligible: false,
    taxable: true,
    taxMode: item.taxMode || 'sales',
    supplier: item.supplier || '',
    location: item.location || '',
    notes: item.notes || '',
    createdAt: safeDate(item.createdAt),
    updatedAt: item.updatedAt ? safeDate(item.updatedAt) : undefined,
    lastRestocked: item.lastRestocked || '',
    storeId: 'default',
    _migrated: 'v2-cents',
  };
}

export function normalizeLegacySale(s: Record<string, any>): Record<string, unknown> {
  if (s._migrated === 'v2-cents') return s;

  const items = (s.items || []).map((item: Record<string, any>) => ({
    id: item.id || item.itemId || '',
    inventoryId: item.itemId || item.id || '',
    name: item.name || '',
    sku: item.sku || '',
    imei: item.imei || '',
    category: mapItemCategory(item.category || item.type || 'other'),
    price: toCents(item.price),
    originalPrice: item.originalPrice ? toCents(item.originalPrice) : undefined,
    qty: item.quantity || item.qty || 1,
    cost: toCents(item.cost),
    notes: item.notes || '',
    cbeEligible: !!item.batteryFeeEnabled,
    screenFeeEligible: !!item.screenFeeEnabled,
    taxable: item.taxable !== false, // default true
    // Preserve phone payment metadata
    ...(item.type === 'phone_payment' ? {
      carrier: item.carrier || '',
      phoneNumber: item.phoneNumber || '',
      plan: item.plan || '',
      commissionRate: item.commissionRate,
    } : {}),
    // Return tracking
    ...(item.returnedQty ? { returnedQty: item.returnedQty } : {}),
    ...(item.fullyReturned ? { fullyReturned: item.fullyReturned } : {}),
  }));

  return {
    id: s.id,
    invoiceNumber: s.invoiceNumber || '',
    customerId: s.customerId || '',
    customerName: s.customerName || '',
    customerPhone: s.customerPhone || '',
    items,
    subtotal: toCents(s.subtotal),
    discount: s.discount || 0,            // percentage — not dollars, don't convert
    discountAmount: toCents(s.discountAmount),
    discountReason: s.discountReason || '',
    taxRate: s.taxRate || 0,              // rate, not dollars — don't convert
    taxAmount: toCents(s.taxAmount),
    salesTax: s.salesTax !== undefined ? toCents(s.salesTax) : undefined,
    utilityTax: s.utilityTax !== undefined ? toCents(s.utilityTax) : undefined,
    mobileSurcharge: s.mobileSurcharge !== undefined ? toCents(s.mobileSurcharge) : undefined,
    cbeTotal: toCents(s.cbeFee || s.cbeTotal || 0),
    screenFeeTotal: toCents(s.screenFee || 0),
    creditCardFee: s.creditCardFee !== undefined ? toCents(s.creditCardFee) : undefined,
    total: toCents(s.total),
    paymentMethod: mapPaymentMethod(s.paymentMethod),
    cashReceived: toCents(s.cashAmount || s.cashReceived || 0),
    changeDue: toCents(s.change || s.changeDue || 0),
    status: mapSaleStatus(s.status, s),
    employeeId: s.employeeId || '',
    employeeName: s.employeeName || '',
    notes: s.notes || '',
    voidReason: s.voidReason || '',
    refundReason: s.refundReason || '',
    hasReturn: s.hasReturn || false,
    lastReturnAt: s.lastReturnAt || '',
    storeCreditUsed: s.storeCreditUsed ? toCents(s.storeCreditUsed) : undefined,
    createdAt: safeDate(s.createdAt),
    updatedAt: s.updatedAt ? safeDate(s.updatedAt) : undefined,
    // R-IMPORT-SALES-FIXES Path B: stamp default storeId to match the
    // pattern used by inventory/repair/layaway/specialOrder adapters.
    // Without this, imported sales have `storeId: undefined` — harmless
    // today since `belongs(undefined)` passes, but breaks on first
    // multi-store activation.
    storeId: 'default',
    _migrated: 'v2-cents',
  };
}

export function normalizeLegacyRepair(r: Record<string, any>): Record<string, unknown> {
  if (r._migrated === 'v2-cents') return r;
  return {
    id: r.id,
    ticketNumber: r.ticketNumber || '',
    customerId: r.customerId || '',
    customerName: r.customerName || '',
    customerPhone: r.customerPhone || '',
    firstName: r.firstName || '',
    lastName: r.lastName || '',
    device: r.deviceType || r.device || '',
    deviceModel: r.model || r.deviceModel || '',
    imei: r.imei || '',
    issue: r.issue || '',
    diagnosis: r.diagnosis || '',
    status: mapRepairStatus(r.status),
    priority: mapRepairPriority(r.priority),
    parts: (r.parts || []).map((p: Record<string, any>) => ({
      ...p,
      cost: p.cost !== undefined ? toCents(p.cost) : 0,
      price: p.price !== undefined ? toCents(p.price) : 0,
    })),
    laborCost: toCents(r.laborCost),
    estimatedCost: toCents(r.subtotal || r.estimatedCost || r.total || 0),
    depositAmount: toCents(r.deposit || r.depositAmount || 0),
    balance: toCents(r.balance),
    total: toCents(r.total),
    partsTotal: toCents(r.partsTotal),
    taxAmount: toCents(r.taxAmount),
    taxRate: r.taxRate || 0,
    techNotes: r.internalNotes || r.techNotes || '',
    technicianName: r.technicianName || '',
    employeeName: r.employeeName || r.technicianName || '',
    estimatedCompletion: r.estimatedCompletion || '',
    warranty: r.warranty ? String(r.warranty) : '',
    notes: r.notes || '',
    password: r.password || '',
    carrier: r.carrier || '',
    paidViaSales: r.paidViaSales || false,
    lastPaymentVoided: r.lastPaymentVoided || false,
    lastPaymentVoidedAt: r.lastPaymentVoidedAt || '',
    lastPaymentVoidedBy: r.lastPaymentVoidedBy || '',
    lastPaymentVoidReason: r.lastPaymentVoidReason || '',
    createdAt: safeDate(r.createdAt),
    updatedAt: r.updatedAt ? safeDate(r.updatedAt) : undefined,
    storeId: 'default',
    _migrated: 'v2-cents',
  };
}

export function normalizeLegacyLayaway(l: Record<string, any>): Record<string, unknown> {
  if (l._migrated === 'v2-cents') return l;
  return {
    id: l.id,
    ticketNumber: l.ticketNumber || '',
    customerId: l.customerId || '',
    customerName: l.customerName || '',
    customerPhone: l.customerPhone || '',
    firstName: l.firstName || '',
    lastName: l.lastName || '',
    items: [{
      id: l.inventoryId || l.id,
      name: l.itemDescription || '',
      sku: l.itemSku || '',
      imei: l.imei || '',
      category: mapItemCategory(l.itemCategory),
      price: toCents(l.itemPrice),
      qty: 1,
    }],
    totalPrice: toCents(l.grandTotal || l.totalPrice || l.itemPrice || 0),
    taxAmount: toCents(l.taxAmount),
    taxable: l.taxable !== false,
    payments: [{
      id: 'initial-deposit',
      amount: toCents(l.deposit),
      method: 'Cash',
      date: safeDate(l.createdAt),
      employeeName: l.employeeName || '',
    }],
    paidAmount: toCents(l.deposit),
    balance: toCents(l.balance),
    status: mapLayawayStatus(l.status),
    notes: l.notes || '',
    employeeName: l.employeeName || '',
    inventoryId: l.inventoryId || null,
    manualEntry: l.manualEntry || false,
    depositRefunded: l.depositRefunded || false,
    cancelledAt: l.cancelledAt || '',
    completedAt: l.completedAt || '',
    pickupDate: l.pickupDate || '',
    createdAt: safeDate(l.createdAt),
    updatedAt: l.updatedAt ? safeDate(l.updatedAt) : undefined,
    storeId: 'default',
    _migrated: 'v2-cents',
  };
}

export function normalizeLegacySpecialOrder(so: Record<string, any>): Record<string, unknown> {
  if (so._migrated === 'v2-cents') return so;
  return {
    id: so.id,
    orderNumber: so.orderNumber || '',
    customerId: so.customerId || '',
    customerName: so.customerName || '',
    customerPhone: so.customerPhone || '',
    firstName: so.firstName || '',
    lastName: so.lastName || '',
    itemDescription: so.itemDescription || '',
    supplier: so.supplier || '',
    cost: toCents(so.cost),
    price: toCents(so.totalPrice || so.total || 0),
    depositAmount: toCents(so.deposit || so.depositPaid || so.depositAmount || 0),
    balance: toCents(so.balance || so.balanceDue || 0),
    taxAmount: so.taxAmount ? toCents(so.taxAmount) : 0,
    taxable: so.taxable || false,
    total: toCents(so.totalWithTax || so.total || so.totalPrice || 0),
    status: mapSpecialOrderStatus(so.status),
    notes: so.notes || '',
    eta: so.eta || '',
    employeeName: so.employeeName || so.createdBy || '',
    paymentType: so.paymentType || '',
    paidViaSales: so.paidViaSales || false,
    createdAt: safeDate(so.createdAt),
    updatedAt: so.updatedAt ? safeDate(so.updatedAt) : undefined,
    storeId: 'default',
    _migrated: 'v2-cents',
  };
}

/**
 * Customer returns are intentionally kept in the legacy dollars shape per
 * project spec. This normalizer only tags _migrated so the idempotency
 * guard works on subsequent runs — no money conversion.
 */
export function normalizeLegacyCustomerReturn(cr: Record<string, any>): Record<string, unknown> {
  if (cr._migrated === 'v2-cents') return cr;
  return { ...cr, _migrated: 'v2-cents' };
}

export function normalizeLegacyCustomer(c: Record<string, any>): Record<string, unknown> {
  if (c._migrated === 'v2-cents') return c;
  return {
    ...c, // preserve all fields (phones[], carriers[], etc.)
    // Money fields
    storeCredit: toCents(c.storeCredit || 0),
    totalSpent: toCents(c.totalSpent || 0),
    monthlyPayment: c.monthlyPayment || '', // kept as string per v2 type
    // Ensure required v2 fields
    firstName: c.firstName || (c.name || '').split(' ')[0] || '',
    lastName: c.lastName || (c.name || '').split(' ').slice(1).join(' ') || '',
    name: c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim(),
    phone: c.phone || (c.phones || [])[0] || '',
    email: c.email || '',
    loyaltyPoints: c.loyaltyPoints || 0,
    customerNumber: c.customerNumber || '',
    notes: c.notes || '',
    smsConsent: c.smsConsent || c.smsOptIn || false,
    createdAt: safeDate(c.createdAt),
    _migrated: 'v2-cents',
  };
}

// ── Legacy tax_* routing ─────────────────────────────────────
//
// v1 stored tax forms as TOP-LEVEL keys outside settings: `tax_1040_2025`,
// `tax_exp_2025`, `tax_members`, etc. v2 expects them nested inside
// `settings.taxData.byYear[YYYY]` + `settings.partnership`. This routine
// walks every `tax_*` key in the source and rebuilds the v2-native shape
// while converting dollar money fields to cents.
//
// Empty-default objects (all-zero money + empty strings) are skipped so
// pristine years don't pollute v2 settings with zero-filled forms.
// Unrecognized `tax_*` keys get warnings (defensive against v1 drift).
// ─────────────────────────────────────────────────────────────

const VALID_FILING_STATUS = new Set(['single', 'married', 'mfs', 'hoh', 'qw']);

const BALANCE_SHEET_FIELDS = [
  'cashBegin', 'cashEnd',
  'accountsReceivableBegin', 'accountsReceivableEnd',
  'inventoryBegin', 'inventoryEnd',
  'otherCurrentAssetsBegin', 'otherCurrentAssetsEnd',
  'buildingsBegin', 'buildingsEnd',
  'accDepreciationBegin', 'accDepreciationEnd',
  'landBegin', 'landEnd',
  'otherAssetsBegin', 'otherAssetsEnd',
  'accountsPayableBegin', 'accountsPayableEnd',
  'shortTermDebtBegin', 'shortTermDebtEnd',
  'longTermDebtBegin', 'longTermDebtEnd',
  'otherLiabilitiesBegin', 'otherLiabilitiesEnd',
] as const;

const SCHEDULE_C_FIELDS = [
  'advertising', 'carAndTruck', 'commissions', 'contractLabor', 'depletion',
  'depreciation', 'employeeBenefits', 'insurance', 'mortgageInterest',
  'otherInterest', 'legalProfessional', 'officeExpense', 'pensionProfit',
  'rentVehicles', 'rentProperty', 'repairs', 'supplies', 'taxesLicenses',
  'travel', 'meals', 'utilities', 'wages', 'otherExpenses', 'homeOffice',
] as const;

const SCHEDULE_M_FIELDS = [
  'federalIncomeTax', 'excessCapitalLosses', 'incomeNotRecorded',
  'expensesNotDeducted', 'taxExemptInterest', 'deductionsNotCharged',
] as const;

const FORM_1040_MONEY_FIELDS = [
  'wages', 'interestDividends', 'capitalGains', 'otherIncome1040',
  'iraDeduction', 'studentLoanInterest', 'hsaDeduction', 'otherAdjustments',
  'itemizedDeductions', 'childTaxCredit', 'earnedIncomeCredit', 'otherCredits',
  'federalWithholding', 'q1Payment', 'q2Payment', 'q3Payment', 'q4Payment',
] as const;

const FORM_1040_STRING_FIELDS = [
  'firstName', 'lastName', 'ssn', 'address', 'city', 'state', 'zip',
  'spouseFirstName', 'spouseLastName', 'spouseSsn',
] as const;

function allZero(o: Record<string, any>, fields: readonly string[]): boolean {
  return fields.every((f) => !o[f]);
}

export function normalizeLegacyTaxData(
  source: Record<string, unknown>,
  warnings: string[],
): {
  taxData?: { byYear: Record<string, Record<string, unknown>> };
  partnership?: Record<string, unknown>;
} {
  const byYear: Record<string, Record<string, unknown>> = {};
  let partnership: Record<string, unknown> | undefined;
  let members: unknown[] | undefined;

  const ensureYear = (year: string) => {
    if (!byYear[year]) byYear[year] = {};
    return byYear[year];
  };

  for (const key of Object.keys(source)) {
    if (!key.startsWith('tax_')) continue;
    const val = source[key];

    // ── Globals ────────────────────────────────────────────
    if (key === 'tax_partnership_info') {
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        partnership = { ...(val as Record<string, unknown>) };
      }
      continue;
    }
    if (key === 'tax_members') {
      if (Array.isArray(val)) {
        // v1 → v2 PartnershipMember field remap. v1 uses `ownership` (not
        // `ownershipPct`), `capitalAccountBeginning/Contributions/Distributions`
        // (not the v2 short names), `isGeneralPartner` (v2 calls it
        // `isManaging`). Without this remap, UI sites that call
        // `.toFixed()` on ownershipPct throw TypeError on every render that
        // touches members (CA540 tab, Schedule SE, K-1). Default
        // `isUSResident: true` since v1 had no analog — Jorge's shop is
        // all-domestic partners. Money fields: v1 dollars → v2 cents.
        members = val.map((m: any, i: number) => ({
          id: String(m?.id || `member-${Date.now()}-${i}`),
          name: String(m?.name || ''),
          ssn: String(m?.ssn || ''),
          ...(m?.ein ? { ein: String(m.ein) } : {}),
          address: String(m?.address || ''),
          city: String(m?.city || ''),
          state: String(m?.state || ''),
          zip: String(m?.zip || ''),
          ownershipPct: Number(m?.ownershipPct ?? m?.ownership ?? 0),
          isManaging: !!(m?.isManaging ?? m?.isGeneralPartner ?? false),
          isUSResident: m?.isUSResident !== undefined ? !!m.isUSResident : true,
          beginningCapital: toCents(m?.beginningCapital ?? m?.capitalAccountBeginning ?? 0),
          contributions: toCents(m?.contributions ?? m?.capitalContributions ?? 0),
          distributions: toCents(m?.distributions ?? m?.capitalDistributions ?? 0),
          guaranteedPayments: toCents(m?.guaranteedPayments ?? 0),
          ...(m?.notes ? { notes: String(m.notes) } : {}),
        }));
      }
      continue;
    }

    // ── Year-scoped keys: tax_<prefix>_<YYYY> ──────────────
    const match = key.match(/^tax_([a-zA-Z0-9]+)_(\d{4})$/);
    if (!match) {
      warnings.push(`Unrecognized legacy tax_* key: ${key}`);
      continue;
    }
    const prefix = match[1];
    const year = match[2];

    switch (prefix) {
      case 'exp':
        if (Array.isArray(val)) {
          ensureYear(year).expenses = val.map((e: any) => ({
            ...e, amount: toCents(e?.amount ?? 0),
          }));
        }
        break;

      case 'income':
        if (Array.isArray(val)) {
          ensureYear(year).income = val.map((e: any) => ({
            ...e, amount: toCents(e?.amount ?? 0),
          }));
        }
        break;

      case 'suppliers':
        if (Array.isArray(val)) {
          ensureYear(year).suppliers = val.map((e: any) => ({
            ...e, amount: toCents(e?.amount ?? 0),
          }));
        }
        break;

      case 'returns':
        if (Array.isArray(val)) {
          ensureYear(year).returns = val.map((e: any) => ({
            ...e, amount: toCents(e?.amount ?? 0),
          }));
        }
        break;

      case 'inv':
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          const o = val as any;
          ensureYear(year).inventory = {
            beginningInventory: toCents(o.beginningInventory ?? 0),
            endingInventory: toCents(o.endingInventory ?? 0),
          };
        }
        break;

      case 'adj':
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          const o = val as any;
          ensureYear(year).adjustments = {
            otherIncome: toCents(o.otherIncome ?? 0),
            returnsRefunds: toCents(o.returnsRefunds ?? 0),
          };
        }
        break;

      case 'ca540':
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          const o = val as any;
          ensureYear(year).ca540 = {
            caWithholding: toCents(o.caWithholding ?? 0),
            caQ1: toCents(o.caQ1 ?? 0),
            caQ2: toCents(o.caQ2 ?? 0),
            caQ3: toCents(o.caQ3 ?? 0),
            caQ4: toCents(o.caQ4 ?? 0),
            selfEmployedHealthInsuranceCA: toCents(o.selfEmployedHealthInsuranceCA ?? 0),
            otherCADeductions: toCents(o.otherCADeductions ?? 0),
            useStandardDeductionCA: !!o.useStandardDeductionCA,
            itemizedDeductionsCA: toCents(o.itemizedDeductionsCA ?? 0),
          };
        }
        break;

      case '1040': {
        if (!val || typeof val !== 'object' || Array.isArray(val)) break;
        const o = val as any;
        // Empty-object guard: all money zero AND all strings empty → skip
        if (
          allZero(o, FORM_1040_MONEY_FIELDS) &&
          FORM_1040_STRING_FIELDS.every((f) => !o[f]) &&
          !o.dependents
        ) break;

        let filingStatus = String(o.filingStatus || '').toLowerCase();
        if (!VALID_FILING_STATUS.has(filingStatus)) {
          warnings.push(
            `form1040 ${year}: filingStatus '${o.filingStatus}' invalid, defaulted to 'single'`,
          );
          filingStatus = 'single';
        }

        const form1040: Record<string, unknown> = {
          filingStatus,
          dependents: Number(o.dependents) || 0,
          useStandardDeduction: !!o.useStandardDeduction,
          firstName: String(o.firstName || ''),
          lastName: String(o.lastName || ''),
          ssn: String(o.ssn || ''),
          address: String(o.address || ''),
          city: String(o.city || ''),
          state: String(o.state || ''),
          zip: String(o.zip || ''),
        };
        for (const f of FORM_1040_MONEY_FIELDS) {
          form1040[f] = toCents(o[f] ?? 0);
        }
        // Spouse PII: include only if non-empty (optional fields).
        if (o.spouseFirstName) form1040.spouseFirstName = String(o.spouseFirstName);
        if (o.spouseLastName) form1040.spouseLastName = String(o.spouseLastName);
        if (o.spouseSsn) form1040.spouseSsn = String(o.spouseSsn);
        ensureYear(year).form1040 = form1040;
        break;
      }

      case 'balanceSheet': {
        if (!val || typeof val !== 'object' || Array.isArray(val)) break;
        const o = val as any;
        if (allZero(o, BALANCE_SHEET_FIELDS)) break; // pristine → skip
        const bs: Record<string, unknown> = {};
        for (const f of BALANCE_SHEET_FIELDS) bs[f] = toCents(o[f] ?? 0);
        ensureYear(year).balanceSheet = bs;
        break;
      }

      case 'dependents':
        if (Array.isArray(val) && val.length > 0) {
          ensureYear(year).dependents = val.map((d: any, i: number) => ({
            id: d?.id || `dep-${year}-${i}-${Date.now()}`,
            firstName: String(d?.firstName || ''),
            lastName: String(d?.lastName || ''),
            ssn: String(d?.ssn || ''),
            dateOfBirth: String(d?.dateOfBirth || ''),
            relationship: String(d?.relationship || 'Other'),
          }));
        }
        break;

      case 'draw':
        if (Array.isArray(val) && val.length > 0) {
          const normalizedDraws: Record<string, unknown>[] = [];
          for (const d of val) {
            const ok = d && typeof d === 'object' && !Array.isArray(d)
              && 'id' in d && 'memberId' in d && 'amount' in d && 'date' in d;
            if (!ok) {
              warnings.push(
                `tax_draw_${year}: entry with malformed shape skipped: ${JSON.stringify(d).slice(0, 100)}`,
              );
              continue;
            }
            const e = d as any;
            normalizedDraws.push({
              id: String(e.id),
              memberId: String(e.memberId),
              amount: toCents(e.amount ?? 0),
              date: String(e.date),
              ...(e.notes ? { notes: String(e.notes) } : {}),
            });
          }
          if (normalizedDraws.length > 0) {
            ensureYear(year).draws = normalizedDraws;
          }
        }
        break;

      case 'scheduleC': {
        if (!val || typeof val !== 'object' || Array.isArray(val)) break;
        const o = val as any;
        if (allZero(o, SCHEDULE_C_FIELDS)) break;
        const sc: Record<string, unknown> = {};
        for (const f of SCHEDULE_C_FIELDS) sc[f] = toCents(o[f] ?? 0);
        ensureYear(year).scheduleC = sc;
        break;
      }

      case 'scheduleM': {
        if (!val || typeof val !== 'object' || Array.isArray(val)) break;
        const o = val as any;
        if (allZero(o, SCHEDULE_M_FIELDS)) break;
        const sm: Record<string, unknown> = {};
        for (const f of SCHEDULE_M_FIELDS) sm[f] = toCents(o[f] ?? 0);
        ensureYear(year).scheduleM = sm;
        break;
      }

      default:
        warnings.push(`Unrecognized legacy tax_* key: ${key}`);
    }
  }

  // Drop years where nothing was populated.
  for (const y of Object.keys(byYear)) {
    if (Object.keys(byYear[y]).length === 0) delete byYear[y];
  }

  const result: {
    taxData?: { byYear: Record<string, Record<string, unknown>> };
    partnership?: Record<string, unknown>;
  } = {};
  if (Object.keys(byYear).length > 0) result.taxData = { byYear };
  if (partnership || members) {
    result.partnership = {
      ...(partnership || {}),
      ...(members ? { members } : {}),
    };
  }
  return result;
}

// ── Top-level entry point ────────────────────────────────────

export function normalizeLegacyBackup(
  source: Record<string, unknown>,
): NormalizationResult {
  const normalized: Record<string, unknown> = { ...source };
  const stats: Record<string, NormalizationStats> = {};
  const warnings: string[] = [];

  const run = <T>(
    key: string,
    fn: (item: T) => Record<string, unknown>,
  ) => {
    const arr = source[key] as T[] | undefined;
    if (!Array.isArray(arr)) return;
    const collectionStats: NormalizationStats = {
      total: arr.length, converted: 0, passthrough: 0,
    };
    const out = arr.map((item: any) => {
      if (item._migrated === 'v2-cents') {
        collectionStats.passthrough++;
        return item;
      }
      collectionStats.converted++;
      try {
        return fn(item);
      } catch (e) {
        warnings.push(`${key}[${item.id || '?'}] normalization failed: ${String(e)}`);
        return item;
      }
    });
    normalized[key] = out;
    stats[key] = collectionStats;
  };

  run('inventory', normalizeLegacyInventoryItem);
  run('sales', normalizeLegacySale);
  run('repairs', normalizeLegacyRepair);
  run('layaways', normalizeLegacyLayaway);
  run('special_orders', normalizeLegacySpecialOrder);
  run('customer_returns', normalizeLegacyCustomerReturn);
  run('customers', normalizeLegacyCustomer);

  // R-IMPORT-TAX-DATA: collect legacy tax_* keys and route them into
  // settings.taxData.byYear + settings.partnership. Merges with any
  // existing settings.taxData/partnership already present in the source
  // (v2-native portions win only for fields absent from the legacy data).
  const taxDelta = normalizeLegacyTaxData(source, warnings);
  if (taxDelta.taxData || taxDelta.partnership) {
    const existingSettings = (source.settings && typeof source.settings === 'object' && !Array.isArray(source.settings))
      ? { ...(source.settings as Record<string, unknown>) }
      : {};
    if (taxDelta.taxData) {
      const existing = existingSettings.taxData as { byYear?: Record<string, unknown> } | undefined;
      existingSettings.taxData = {
        byYear: {
          ...(existing?.byYear || {}),
          ...taxDelta.taxData.byYear,
        },
      };
    }
    if (taxDelta.partnership) {
      const existing = existingSettings.partnership as Record<string, unknown> | undefined;
      existingSettings.partnership = {
        ...(existing || {}),
        ...taxDelta.partnership,
      };
    }
    normalized.settings = existingSettings;
  }

  return { normalized, stats, warnings };
}
