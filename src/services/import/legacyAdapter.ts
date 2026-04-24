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
  if (sale.voided) return 'Voided';
  if (sale.refunded) return 'Refunded';
  if (!status) return 'Completed';
  const s = String(status).toLowerCase().trim();
  if (s === 'completed' || s === 'complete') return 'Completed';
  if (s === 'voided' || s === 'void') return 'Voided';
  if (s === 'refunded' || s === 'refund') return 'Refunded';
  if (s === 'partial_refund' || s === 'partial refund') return 'Partial Refund';
  return 'Completed';
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

  return { normalized, stats, warnings };
}
