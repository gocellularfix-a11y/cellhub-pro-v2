// INTELLIGENCE-UNIVERSAL-ENTITY-ACCESS-V1
// Deterministic adapters: raw module object → normalized ResolvedEntity.
// No AI/LLM/fuzzy. Pure structural conversion.

import type { ResolvedEntity } from './types';
import type {
  Customer, Repair, Unlock, SpecialOrder, Layaway,
  InventoryItem, Sale, Employee,
} from '@/store/types';
import {
  resolveCustomerActions,
  resolveRepairActions,
  resolveUnlockActions,
  resolveSpecialOrderActions,
  resolveLayawayActions,
  resolveSaleActions,
  resolvePhonePaymentActions,
  resolveInventoryProductActions,
  resolveEmployeeActions,
} from './entityActions';

function normTokens(...parts: (string | undefined | null)[]): string[] {
  return parts
    .filter((p): p is string => !!p)
    .map(p => p.toLowerCase().trim())
    .filter(p => p.length > 0);
}

function fmtCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// ── Customer ─────────────────────────────────────────────────────────────────

export function resolveCustomer(c: Customer): ResolvedEntity {
  const displayName = c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim();
  const phone = c.phones?.[0] ?? c.phone ?? '';
  return {
    kind: 'customer',
    id: c.id,
    title: displayName || 'Customer',
    subtitle: phone || c.email || undefined,
    searchableText: normTokens(displayName, phone, c.email, c.customerNumber, c.id),
    availableActions: resolveCustomerActions(c),
    raw: c,
  };
}

// ── Repair ───────────────────────────────────────────────────────────────────

export function resolveRepair(r: Repair): ResolvedEntity {
  const ticketNum = (r as any).ticketNumber as string | undefined;
  const idTag = ticketNum ?? r.id.slice(-8).toUpperCase();
  const title = `${r.device} — ${r.issue}`;
  const sub = `${r.customerName} · ${idTag} · ${r.status}`;
  return {
    kind: 'repair',
    id: r.id,
    title,
    subtitle: sub,
    searchableText: normTokens(
      r.customerName, r.customerPhone, r.device,
      r.deviceModel, r.issue, idTag, ticketNum, r.id,
      r.imei, r.status,
    ),
    availableActions: resolveRepairActions(r),
    raw: r,
  };
}

// ── Unlock ───────────────────────────────────────────────────────────────────

export function resolveUnlock(u: Unlock): ResolvedEntity {
  const title = `Unlock — ${u.device}`;
  const sub = `${u.customerName} · ${u.carrier} → ${u.targetCarrier ?? ''} · ${u.status}`;
  return {
    kind: 'unlock',
    id: u.id,
    title,
    subtitle: sub,
    searchableText: normTokens(
      u.customerName, u.customerPhone, u.device,
      u.imei, u.carrier, u.targetCarrier, u.status, u.id,
    ),
    availableActions: resolveUnlockActions(u),
    raw: u,
  };
}

// ── Special Order ─────────────────────────────────────────────────────────────

export function resolveSpecialOrder(so: SpecialOrder): ResolvedEntity {
  const title = so.itemDescription;
  const sub = `${so.customerName} · ${fmtCents(so.balance)} balance · ${so.status}`;
  return {
    kind: 'special_order',
    id: so.id,
    title,
    subtitle: sub,
    searchableText: normTokens(
      so.customerName, so.customerPhone, so.itemDescription,
      so.supplier, so.status, so.id,
    ),
    availableActions: resolveSpecialOrderActions(so),
    raw: so,
  };
}

// ── Layaway ───────────────────────────────────────────────────────────────────

export function resolveLayaway(l: Layaway): ResolvedEntity {
  const itemNames = l.items.map(i => i.name).join(', ');
  const title = itemNames || 'Layaway';
  const sub = `${l.customerName} · ${fmtCents(l.balance)} remaining · ${l.status}`;
  return {
    kind: 'layaway',
    id: l.id,
    title,
    subtitle: sub,
    searchableText: normTokens(
      l.customerName, l.customerPhone, itemNames, l.status, l.id,
    ),
    availableActions: resolveLayawayActions(l),
    raw: l,
  };
}

// ── Sale / Invoice ─────────────────────────────────────────────────────────────

export function resolveSale(s: Sale): ResolvedEntity {
  const isPhonePayment = s.items.some(i => i.category === 'phone_payment');
  if (isPhonePayment) return resolvePhonePaymentSale(s);
  const itemSummary = s.items.map(i => i.name).join(', ');
  const title = `Invoice ${s.invoiceNumber}`;
  const sub = `${s.customerName ?? 'Walk-in'} · ${fmtCents(s.total)} · ${s.status}`;
  return {
    kind: 'sale',
    id: s.id,
    title,
    subtitle: sub,
    searchableText: normTokens(
      s.invoiceNumber, s.customerName, s.customerPhone, itemSummary, s.id,
    ),
    availableActions: resolveSaleActions(s),
    raw: s,
  };
}

function resolvePhonePaymentSale(s: Sale): ResolvedEntity {
  const lines = s.items.filter(i => i.category === 'phone_payment');
  const phoneNums = [...new Set(lines.map(i => i.phoneNumber).filter(Boolean))].join(', ');
  const carriers  = [...new Set(lines.map(i => i.carrier).filter(Boolean))].join(', ');
  const title = `Phone Payment — ${carriers || 'carrier'} ${phoneNums ? `(${phoneNums})` : ''}`.trim();
  const sub = `${s.customerName ?? 'Walk-in'} · ${fmtCents(s.total)} · ${s.invoiceNumber}`;
  return {
    kind: 'phone_payment',
    id: s.id,
    title,
    subtitle: sub,
    searchableText: normTokens(
      s.invoiceNumber, s.customerName, s.customerPhone,
      phoneNums, carriers, s.id,
    ),
    availableActions: resolvePhonePaymentActions(s),
    raw: s,
  };
}

// ── Inventory Product ─────────────────────────────────────────────────────────

export function resolveInventoryProduct(p: InventoryItem): ResolvedEntity {
  const sub = `${p.category} · SKU ${p.sku} · qty ${p.qty} · ${fmtCents(p.price)}`;
  return {
    kind: 'inventory_product',
    id: p.id,
    title: p.name,
    subtitle: sub,
    searchableText: normTokens(
      p.name, p.sku, p.barcode, p.imei, p.brand, p.category, p.supplier, p.id,
    ),
    availableActions: resolveInventoryProductActions(p),
    raw: p,
  };
}

// ── Employee ──────────────────────────────────────────────────────────────────

export function resolveEmployee(e: Employee): ResolvedEntity {
  return {
    kind: 'employee',
    id: e.id,
    title: e.name,
    subtitle: `${e.role} · ${e.active ? 'active' : 'inactive'}`,
    searchableText: normTokens(e.name, e.role, e.phone, e.email, e.id),
    availableActions: resolveEmployeeActions(e),
    raw: e,
  };
}
