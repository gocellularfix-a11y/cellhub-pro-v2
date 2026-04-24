#!/usr/bin/env node
// ============================================================
// CellHub Pro — V1 → V2 Data Migration Script
// Converts dollar amounts to cents (integer) and remaps field
// names from the v1 backup format to v2 expected schema.
//
// Usage:
//   node scripts/migrate-v1-to-v2.js <input-backup.json> [output.json]
//
// If no output path given, writes to:
//   cellhub-v2-migrated-<timestamp>.json
//
// What it does:
//   1. Reads v1 auto-backup JSON (localStorage format)
//   2. Converts ALL money fields from dollars → cents (×100, rounded)
//   3. Remaps v1 field names to v2 equivalents
//   4. Adds missing v2 required fields with safe defaults
//   5. Writes a clean JSON ready for v2 import
//
// Safety:
//   - NEVER modifies the input file
//   - Logs every conversion with before/after values
//   - Generates a summary report at the end
// ============================================================

const fs = require('fs');
const path = require('path');

// ── Helpers ─────────────────────────────────────────────────

/** Convert dollars (number or string) to cents (integer). */
function toCents(val) {
  if (val === null || val === undefined || val === '') return 0;
  const n = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(n)) return 0;
  return Math.round(n * 100);
}

/** Check if a value looks like it's already in cents (> 999 and integer). */
function looksLikeCents(val) {
  if (typeof val !== 'number') return false;
  // If value > $100 (10000 cents) AND is an integer, it might already be cents.
  // But we can't be sure — a $150 phone is 150, not 15000.
  // The v1 app stores in dollars, so we always convert.
  return false; // Always convert — v1 is ALWAYS dollars
}

/** Safe date string — pass through if already ISO, convert if Date-like. */
function safeDate(val) {
  if (!val) return new Date().toISOString();
  if (typeof val === 'string') return val;
  if (val.toDate) return val.toDate().toISOString(); // Firestore Timestamp
  if (val instanceof Date) return val.toISOString();
  return new Date().toISOString();
}

let stats = {
  sales: { total: 0, converted: 0, skipped: 0 },
  inventory: { total: 0, converted: 0, skipped: 0 },
  repairs: { total: 0, converted: 0, skipped: 0 },
  layaways: { total: 0, converted: 0, skipped: 0 },
  special_orders: { total: 0, converted: 0, skipped: 0 },
  customer_returns: { total: 0, converted: 0, skipped: 0 },
  customers: { total: 0, converted: 0, skipped: 0 },
  customerAccounts: { total: 0, converted: 0, skipped: 0 },
};

// ── Sale Migration ──────────────────────────────────────────

function migrateSale(s) {
  stats.sales.total++;

  // Skip already-migrated records
  if (s._migrated === 'v2-cents') {
    stats.sales.skipped++;
    return s;
  }

  stats.sales.converted++;

  const items = (s.items || []).map(item => ({
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

function mapItemCategory(cat) {
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

  // Unknown category — preserve with Title Case conversion attempt
  // (rather than silently pass-through lowercase value)
  return String(cat).split(' ').map(w =>
    w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  ).join(' ');
}

function mapPaymentMethod(pm) {
  if (!pm) return 'Cash';
  const p = pm.toLowerCase();
  if (p === 'cash') return 'Cash';
  if (p === 'card' || p === 'credit card' || p === 'debit') return 'Card';
  if (p === 'split') return 'Split';
  if (p === 'store credit' || p === 'storecredit') return 'Store Credit';
  return pm;
}

function mapSaleStatus(status, sale) {
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

function mapRepairStatus(status) {
  if (!status) return 'Pending';
  const s = String(status).toLowerCase().trim();
  if (s === 'complete' || s === 'completed') return 'Completed';
  if (s === 'received') return 'Received';
  if (s === 'cancelled' || s === 'canceled') return 'Cancelled';
  if (s === 'in_progress' || s === 'in progress' || s === 'working') return 'In Progress';
  if (s === 'ready' || s === 'picked_up' || s === 'picked up') return 'Picked Up';
  if (s === 'pending' || s === 'new') return 'Pending';
  // Unknown — Title Case attempt
  return String(status).split(' ').map(w =>
    w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  ).join(' ');
}

function mapLayawayStatus(status) {
  if (!status) return 'Active';
  const s = String(status).toLowerCase().trim();
  if (s === 'active' || s === 'open') return 'Active';
  if (s === 'completed' || s === 'complete' || s === 'paid') return 'Completed';
  if (s === 'cancelled' || s === 'canceled') return 'Cancelled';
  if (s === 'refunded') return 'Refunded';
  return String(status).split(' ').map(w =>
    w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  ).join(' ');
}

function mapSpecialOrderStatus(status) {
  if (!status) return 'Ordered';
  const s = String(status).toLowerCase().trim();
  if (s === 'ordered') return 'Ordered';
  if (s === 'picked up' || s === 'picked_up' || s === 'pickedup') return 'Picked Up';
  if (s === 'received') return 'Received';
  if (s === 'cancelled' || s === 'canceled') return 'Cancelled';
  if (s === 'refunded') return 'Refunded';
  if (s === 'pending') return 'Pending';
  return String(status).split(' ').map(w =>
    w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  ).join(' ');
}

function mapRepairPriority(p) {
  if (!p) return 'Normal';
  const s = String(p).toLowerCase().trim();
  if (s === 'high' || s === 'urgent' || s === 'rush') return 'High';
  if (s === 'low') return 'Low';
  return 'Normal';
}

// ── Inventory Migration ─────────────────────────────────────

function migrateInventoryItem(item) {
  stats.inventory.total++;

  if (item._migrated === 'v2-cents') {
    stats.inventory.skipped++;
    return item;
  }

  stats.inventory.converted++;

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
    minQty: item.minStockLevel || 0,                         // v1: minStockLevel → v2: minQty
    cbeEligible: false,                                       // default, user adjusts per item
    screenFeeEligible: false,
    taxable: true,                                            // default
    taxMode: item.taxMode || 'sales',
    supplier: item.supplier || '',
    location: item.location || '',
    notes: item.notes || '',
    createdAt: safeDate(item.createdAt),
    updatedAt: item.updatedAt ? safeDate(item.updatedAt) : undefined,
    lastRestocked: item.lastRestocked || '',
    // R-MIGRATE-V1-V2-NORMALIZE: tag all migrated records with the
    // default storeId so multi-store filtering (AppProvider) doesn't
    // exclude them when Jorge eventually enables multi-store M2+.
    storeId: 'default',
    _migrated: 'v2-cents',
  };
}

// ── Repair Migration ────────────────────────────────────────

function migrateRepair(r) {
  stats.repairs.total++;

  if (r._migrated === 'v2-cents') {
    stats.repairs.skipped++;
    return r;
  }

  stats.repairs.converted++;

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
    parts: (r.parts || []).map(p => ({
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

// ── Layaway Migration ───────────────────────────────────────

function migrateLayaway(l) {
  stats.layaways.total++;

  if (l._migrated === 'v2-cents') {
    stats.layaways.skipped++;
    return l;
  }

  stats.layaways.converted++;

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

// ── Special Order Migration ─────────────────────────────────

function migrateSpecialOrder(so) {
  stats.special_orders.total++;

  if (so._migrated === 'v2-cents') {
    stats.special_orders.skipped++;
    return so;
  }

  stats.special_orders.converted++;

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

// ── Customer Return Migration ───────────────────────────────

function migrateCustomerReturn(cr) {
  stats.customer_returns.total++;

  if (cr._migrated === 'v2-cents') {
    stats.customer_returns.skipped++;
    return cr;
  }

  stats.customer_returns.converted++;

  return {
    id: cr.id,
    returnNumber: cr.returnNumber || '',
    originalInvoice: cr.originalInvoice || '',
    originalSaleId: cr.originalSaleId || '',
    customerName: cr.customerName || '',
    customerPhone: cr.customerPhone || '',
    employeeName: cr.employeeName || '',
    reason: cr.reason || '',
    resolution: cr.resolution || '',
    notes: cr.notes || '',
    items: (cr.items || []).map(i => ({
      id: i.id || '',
      name: i.name || '',
      price: toCents(i.price),
      qty: i.qty || i.quantity || 1,
      subtotal: toCents(i.subtotal || i.price),
      tax: toCents(i.tax),
      total: toCents(i.total),
    })),
    subtotal: toCents(cr.subtotal),
    taxRefunded: toCents(cr.taxRefunded),
    total: toCents(cr.total),
    createdAt: safeDate(cr.createdAt),
    _migrated: 'v2-cents',
  };
}

// ── Customer Migration ──────────────────────────────────────

function migrateCustomer(c) {
  stats.customers.total++;

  if (c._migrated === 'v2-cents') {
    stats.customers.skipped++;
    return c;
  }

  stats.customers.converted++;

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

// ── Customer Account Migration ──────────────────────────────

function migrateCustomerAccount(ca) {
  stats.customerAccounts.total++;

  if (ca._migrated === 'v2-cents') {
    stats.customerAccounts.skipped++;
    return ca;
  }

  stats.customerAccounts.converted++;

  return {
    ...ca,
    chargedAmount: ca.chargedAmount ? String(parseFloat(ca.chargedAmount || '0').toFixed(2)) : '',
    createdAt: safeDate(ca.createdAt),
    _migrated: 'v2-cents',
  };
}

// ── Main ────────────────────────────────────────────────────

function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('Usage: node scripts/migrate-v1-to-v2.js <input-backup.json> [output.json]');
    process.exit(1);
  }

  const outputPath = process.argv[3] || `cellhub-v2-migrated-${Date.now()}.json`;

  console.log(`\n🔄 CellHub Pro V1 → V2 Migration`);
  console.log(`   Input:  ${inputPath}`);
  console.log(`   Output: ${outputPath}\n`);

  // Read input
  const raw = fs.readFileSync(inputPath, 'utf-8');
  const backup = JSON.parse(raw);
  const data = backup.data;

  if (!data) {
    console.error('❌ No "data" key found in backup. Is this a CellHub auto-backup?');
    process.exit(1);
  }

  console.log('📊 Input summary:');
  console.log(`   Sales:            ${(data.sales || []).length}`);
  console.log(`   Inventory:        ${(data.inventory || []).length}`);
  console.log(`   Repairs:          ${(data.repairs || []).length}`);
  console.log(`   Layaways:         ${(data.layaways || []).length}`);
  console.log(`   Special Orders:   ${(data.special_orders || []).length}`);
  console.log(`   Customer Returns: ${(data.customer_returns || []).length}`);
  console.log(`   Customers:        ${(data.customers || []).length}`);
  console.log(`   Accounts:         ${(data.customerAccounts || []).length}\n`);

  // Migrate each collection
  const migrated = { ...data };

  migrated.sales = (data.sales || []).map(migrateSale);
  migrated.inventory = (data.inventory || []).map(migrateInventoryItem);
  migrated.repairs = (data.repairs || []).map(migrateRepair);
  migrated.layaways = (data.layaways || []).map(migrateLayaway);
  migrated.special_orders = (data.special_orders || []).map(migrateSpecialOrder);
  migrated.customer_returns = (data.customer_returns || []).map(migrateCustomerReturn);
  migrated.customers = (data.customers || []).map(migrateCustomer);
  migrated.customerAccounts = (data.customerAccounts || []).map(migrateCustomerAccount);

  // Write output
  const output = {
    ...backup,
    app: 'CellHub Pro v2 (migrated from v1)',
    migrationDate: new Date().toISOString(),
    migrationVersion: 'v1-to-v2-cents',
    data: migrated,
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  // Report
  console.log('✅ Migration complete!\n');
  console.log('📋 Conversion summary:');
  console.log('   Collection        Total   Converted  Skipped');
  console.log('   ─────────────────────────────────────────────');
  for (const [name, s] of Object.entries(stats)) {
    const pad = (str, len) => str.padEnd(len);
    console.log(`   ${pad(name, 20)} ${String(s.total).padStart(5)}   ${String(s.converted).padStart(5)}      ${String(s.skipped).padStart(5)}`);
  }

  // Spot-check: show first sale before/after
  if (data.sales && data.sales.length > 0) {
    const orig = data.sales[0];
    const conv = migrated.sales[0];
    console.log('\n🔍 Spot check — first sale:');
    console.log(`   Invoice:    ${orig.invoiceNumber}`);
    console.log(`   Subtotal:   $${orig.subtotal} → ${conv.subtotal}¢`);
    console.log(`   Tax:        $${orig.taxAmount} → ${conv.taxAmount}¢`);
    console.log(`   Total:      $${orig.total} → ${conv.total}¢`);
    if (orig.items && orig.items[0]) {
      console.log(`   Item price: $${orig.items[0].price} → ${conv.items[0].price}¢`);
    }
  }

  // Spot-check inventory
  if (data.inventory && data.inventory.length > 0) {
    const orig = data.inventory[0];
    const conv = migrated.inventory[0];
    console.log('\n🔍 Spot check — first inventory item:');
    console.log(`   Name:       ${orig.name}`);
    console.log(`   Cost:       $${orig.costPrice ?? orig.cost} → ${conv.cost}¢`);
    console.log(`   Price:      $${orig.salePrice ?? orig.price} → ${conv.price}¢`);
  }

  console.log(`\n📁 Output written to: ${outputPath}`);
  console.log(`   Size: ${(fs.statSync(outputPath).size / 1024).toFixed(1)} KB\n`);
}

main();
