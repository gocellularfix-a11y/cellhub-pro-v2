// CellHub Intelligence — Schema Adapter
//
// Normalizes legacy/mixed production data to the canonical v2 schema
// that the Intelligence Engine expects.
//
// WHY THIS EXISTS
// ---------------
// The TypeScript types in `@/store/types` declare a canonical v2 schema,
// but the production data still uses a mix of v1 and partially-migrated v2
// field names. The Intelligence Engine was written against the canonical
// schema; this adapter bridges the gap so the engine can run against real
// data without modification.
//
// Known legacy fields mapped here:
//   - InventoryItem:  costPrice → cost, salePrice → price, quantity/stock → qty
//   - Customer:       legacy smsConsent/smsOptIn/smsOptOut → communicationConsent
//                     (defensive fold; primary migration in customerNormalize);
//                     injects defaults for storeCredit, referralCode, referredBy
//   - Repair:         total → estimatedCost, deposit → depositAmount,
//                     deviceType → device, model → deviceModel, updatedAt →
//                     completedAt (only when status indicates completion);
//                     normalizes status/priority casing
//   - SaleItem:       itemId → inventoryId
//
// REMOVE THIS FILE when the underlying data is fully migrated to the
// canonical v2 schema (see scripts/migrate-v1-to-v2.js).

import type {
  Sale,
  SaleItem,
  Customer,
  Repair,
  RepairPart,
  InventoryItem,
  InventoryCategory,
} from '@/store/types';

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Convert a value to cents (integer). Handles dollars-as-float,
 * dollars-as-string, and values already in cents.
 *
 * Heuristic: if the value is an integer >= 1000, assume it is already
 * in cents. Otherwise multiply by 100.
 */
function toCents(val: unknown): number {
  if (val === null || val === undefined || val === '') return 0;
  const n = typeof val === 'string' ? parseFloat(val) : Number(val);
  if (!Number.isFinite(n)) return 0;
  if (Number.isInteger(n) && n >= 1000) return n;
  return Math.round(n * 100);
}

function isCompletedStatus(status: unknown): boolean {
  if (typeof status !== 'string') return false;
  const s = status.toLowerCase().replace(/\s+/g, '_');
  return s === 'complete' || s === 'completed' || s === 'picked_up';
}

/**
 * Map legacy capitalized status values to engine-expected lowercase tokens.
 * Returns a string (RepairStatus is typed as `string`) so custom statuses
 * pass through unchanged.
 */
function normalizeStatus(status: unknown): string {
  if (typeof status !== 'string' || !status) return 'received';
  const s = status.toLowerCase().replace(/\s+/g, '_');
  if (s === 'complete' || s === 'completed') return 'picked_up';
  return s;
}

/**
 * Narrow priority to one of the four engine-supported values.
 * Anything unrecognized falls back to 'normal'.
 */
function normalizePriority(priority: unknown): 'low' | 'normal' | 'high' | 'urgent' {
  if (typeof priority !== 'string') return 'normal';
  const p = priority.toLowerCase();
  if (p === 'low' || p === 'normal' || p === 'high' || p === 'urgent') return p;
  return 'normal';
}

// ── Inventory ────────────────────────────────────────────────────────

export function adaptInventory(raw: unknown[]): InventoryItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => {
    const rec = r as Record<string, unknown>;
    return {
      ...(rec as object),
      id: String(rec.id ?? ''),
      sku: String(rec.sku ?? ''),
      name: String(rec.name ?? ''),
      category: (rec.category as InventoryCategory) ?? ('accessory' as InventoryCategory),
      cost: rec.cost != null ? Number(rec.cost) : toCents(rec.costPrice),
      price: rec.price != null ? Number(rec.price) : toCents(rec.salePrice),
      qty: Number(rec.qty ?? rec.quantity ?? rec.stock ?? 0),
      minQty: Number(rec.minQty ?? rec.minStockLevel ?? 0),
      cbeEligible: Boolean(rec.cbeEligible),
      taxable: rec.taxable !== undefined ? Boolean(rec.taxable) : true,
      createdAt: (rec.createdAt as string | Date) ?? new Date().toISOString(),
    } as InventoryItem;
  });
}

// ── Customer ─────────────────────────────────────────────────────────

export function adaptCustomer(raw: unknown[]): Customer[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => {
    const rec = r as Record<string, unknown>;
    const firstName = String(rec.firstName ?? '');
    const lastName = String(rec.lastName ?? '');
    const derivedName = rec.name ?? `${firstName} ${lastName}`.trim();
    return {
      ...(rec as object),
      id: String(rec.id ?? ''),
      firstName,
      lastName,
      name: String(derivedName),
      phone: String(rec.phone ?? ''),
      email: String(rec.email ?? ''),
      notes: String(rec.notes ?? ''),
      customerNumber: String(rec.customerNumber ?? ''),
      loyaltyPoints: Number(rec.loyaltyPoints ?? 0),
      storeCredit: Number(rec.storeCredit ?? 0),
      // R-COMMS-CONSENT-UNIFY: SMS consent migration moved to
      // customerNormalize.ts. This adapter no longer touches consent.
      communicationConsent:
        rec.communicationConsent !== undefined
          ? Boolean(rec.communicationConsent)
          : Boolean(rec.smsConsent || rec.smsOptIn) && !rec.smsOptOut,
      referralCode: rec.referralCode != null ? String(rec.referralCode) : undefined,
      referredBy: rec.referredBy != null ? String(rec.referredBy) : undefined,
      createdAt: (rec.createdAt as string | Date) ?? new Date().toISOString(),
    } as Customer;
  });
}

// ── Repair ───────────────────────────────────────────────────────────

export function adaptRepair(raw: unknown[]): Repair[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => {
    const rec = r as Record<string, unknown>;

    // estimatedCost: prefer explicit field; fall back to `total` (already cents
    // in real data) or `subtotal` (dollars in real data → toCents()).
    const estCost =
      rec.estimatedCost != null
        ? Number(rec.estimatedCost)
        : rec.total != null
          ? Number(rec.total)
          : toCents(rec.subtotal);

    // depositAmount: prefer explicit field; fall back to `deposit` which is
    // dollars in real data.
    const depAmount =
      rec.depositAmount != null ? Number(rec.depositAmount) : toCents(rec.deposit);

    const balance = rec.balance != null ? Number(rec.balance) : Math.max(0, estCost - depAmount);

    const status = normalizeStatus(rec.status);
    const completedAt =
      rec.completedAt ??
      (isCompletedStatus(rec.status) ? rec.updatedAt : undefined);

    return {
      ...(rec as object),
      id: String(rec.id ?? ''),
      customerName: String(rec.customerName ?? ''),
      customerPhone: String(rec.customerPhone ?? ''),
      device: String(rec.device ?? rec.deviceType ?? ''),
      deviceModel: rec.deviceModel != null ? String(rec.deviceModel) : (rec.model != null ? String(rec.model) : undefined),
      issue: String(rec.issue ?? ''),
      status,
      parts: Array.isArray(rec.parts) ? (rec.parts as RepairPart[]) : [],
      laborCost: Number(rec.laborCost ?? 0),
      estimatedCost: estCost,
      depositAmount: depAmount,
      balance,
      total: rec.total != null ? Number(rec.total) : estCost,
      techNotes: String(rec.techNotes ?? rec.internalNotes ?? ''),
      priority: normalizePriority(rec.priority),
      createdAt: (rec.createdAt as string | Date) ?? new Date().toISOString(),
      completedAt: completedAt as string | Date | undefined,
    } as Repair;
  });
}

// ── Sales ────────────────────────────────────────────────────────────

/**
 * Normalize name for cross-collection matching.
 * Matches the logic used by both engine analyzers (si.name === item.name)
 * but trims trailing whitespace and uppercases — handles the real data
 * where inventory names have trailing spaces (e.g. "SAMSUNG A13 64 GB ").
 */
function normalizeNameForMatch(name: unknown): string {
  if (typeof name !== 'string') return '';
  return name.trim().toUpperCase();
}

function adaptSaleItem(
  raw: unknown,
  nameToInventoryId?: Map<string, string>
): SaleItem {
  const rec = raw as Record<string, unknown>;

  // Resolve inventoryId: explicit → itemId (v1 alias) → name-match lookup.
  let inventoryId: string | undefined;
  if (rec.inventoryId != null) {
    inventoryId = String(rec.inventoryId);
  } else if (rec.itemId != null) {
    inventoryId = String(rec.itemId);
  } else if (nameToInventoryId && typeof rec.name === 'string') {
    const match = nameToInventoryId.get(normalizeNameForMatch(rec.name));
    if (match) inventoryId = match;
  }

  return {
    ...(rec as object),
    id: String(rec.id ?? ''),
    name: String(rec.name ?? ''),
    inventoryId,
    category: (rec.category as InventoryCategory) ?? ('accessory' as InventoryCategory),
    price: Number(rec.price ?? 0),
    qty: Number(rec.qty ?? 0),
    cost: rec.cost != null ? Number(rec.cost) : undefined,
    cbeEligible: Boolean(rec.cbeEligible),
    taxable: rec.taxable !== undefined ? Boolean(rec.taxable) : true,
  } as SaleItem;
}

/**
 * Adapt raw sales. Optionally pass already-adapted inventory to enable
 * name-based inventoryId enrichment for legacy sale items that lack
 * both `inventoryId` and `itemId`.
 */
export function adaptSale(
  raw: unknown[],
  adaptedInventory?: InventoryItem[]
): Sale[] {
  if (!Array.isArray(raw)) return [];

  // Build name → inventoryId lookup once per adaptSale() call.
  let nameToInventoryId: Map<string, string> | undefined;
  if (adaptedInventory && adaptedInventory.length > 0) {
    nameToInventoryId = new Map<string, string>();
    for (const inv of adaptedInventory) {
      const key = normalizeNameForMatch(inv.name);
      if (key && !nameToInventoryId.has(key)) {
        nameToInventoryId.set(key, inv.id);
      }
    }
  }

  return raw.map((s) => {
    const rec = s as Record<string, unknown>;
    const items = Array.isArray(rec.items)
      ? rec.items.map((si) => adaptSaleItem(si, nameToInventoryId))
      : [];
    return {
      ...(rec as object),
      id: String(rec.id ?? ''),
      invoiceNumber: String(rec.invoiceNumber ?? ''),
      items,
      subtotal: Number(rec.subtotal ?? 0),
      taxAmount: Number(rec.taxAmount ?? 0),
      cbeTotal: Number(rec.cbeTotal ?? rec.cbeFee ?? 0),
      total: Number(rec.total ?? 0),
      paymentMethod: String(rec.paymentMethod ?? 'cash'),
      status: (rec.status as Sale['status']) ?? 'completed',
      createdAt: (rec.createdAt as string | Date) ?? new Date().toISOString(),
    } as Sale;
  });
}
