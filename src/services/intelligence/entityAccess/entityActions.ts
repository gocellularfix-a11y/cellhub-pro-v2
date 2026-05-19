// INTELLIGENCE-UNIVERSAL-ENTITY-ACCESS-V1
// Centralized action mapping — single source of truth.
// Future chat handlers must read ResolvedEntity.availableActions
// instead of defining action lists inline.

import type { ResolvedEntity, EntityAction } from './types';
import type { Customer, Repair, Unlock, SpecialOrder, Layaway, InventoryItem, Sale, Employee } from '@/store/types';

function hasBalance(raw: unknown): boolean {
  const r = raw as Record<string, unknown>;
  return typeof r.balance === 'number' && (r.balance as number) > 0;
}

function hasPhone(raw: unknown): boolean {
  const r = raw as Record<string, unknown>;
  const phone = (r.customerPhone ?? r.phone ?? '') as string;
  return phone.replace(/\D/g, '').length >= 7;
}

export function resolveCustomerActions(c: Customer): EntityAction[] {
  const actions: EntityAction[] = ['open', 'open_history'];
  const phone = (c.phones?.[0] ?? c.phone ?? '').replace(/\D/g, '');
  if (phone.length >= 7) {
    actions.push('whatsapp', 'call');
  }
  return actions;
}

export function resolveRepairActions(r: Repair): EntityAction[] {
  const actions: EntityAction[] = ['open_ticket'];
  if (hasPhone(r)) actions.push('whatsapp', 'call');
  if (r.status === 'ready') actions.push('mark_ready');
  if (hasBalance(r)) actions.push('collect_payment');
  actions.push('follow_up');
  return actions;
}

export function resolveUnlockActions(u: Unlock): EntityAction[] {
  const actions: EntityAction[] = ['open_ticket'];
  if (hasPhone(u)) actions.push('whatsapp', 'call');
  if (hasBalance(u)) actions.push('collect_payment');
  actions.push('follow_up');
  return actions;
}

export function resolveSpecialOrderActions(so: SpecialOrder): EntityAction[] {
  const actions: EntityAction[] = ['open_ticket'];
  if (hasPhone(so)) actions.push('whatsapp', 'call');
  if (hasBalance(so)) actions.push('collect_payment');
  if (so.status === 'received') actions.push('mark_ready');
  actions.push('follow_up');
  return actions;
}

export function resolveLayawayActions(l: Layaway): EntityAction[] {
  const actions: EntityAction[] = ['open_ticket'];
  if (hasPhone(l)) actions.push('whatsapp', 'call');
  if (hasBalance(l)) actions.push('collect_payment');
  actions.push('follow_up');
  return actions;
}

export function resolveSaleActions(_s: Sale): EntityAction[] {
  return ['open'];
}

export function resolvePhonePaymentActions(s: Sale): EntityAction[] {
  const actions: EntityAction[] = ['open'];
  const phone = (s.customerPhone ?? '').replace(/\D/g, '');
  if (phone.length >= 7) actions.push('call');
  return actions;
}

export function resolveInventoryProductActions(_p: InventoryItem): EntityAction[] {
  return ['open', 'promote'];
}

export function resolveEmployeeActions(_e: Employee): EntityAction[] {
  return ['open'];
}

/** Derive available actions from a ResolvedEntity.kind + raw source. */
export function getEntityActions(entity: ResolvedEntity): EntityAction[] {
  switch (entity.kind) {
    case 'customer':         return resolveCustomerActions(entity.raw as Customer);
    case 'repair':           return resolveRepairActions(entity.raw as Repair);
    case 'unlock':           return resolveUnlockActions(entity.raw as Unlock);
    case 'special_order':    return resolveSpecialOrderActions(entity.raw as SpecialOrder);
    case 'layaway':          return resolveLayawayActions(entity.raw as Layaway);
    case 'sale':             return resolveSaleActions(entity.raw as Sale);
    case 'invoice':          return resolveSaleActions(entity.raw as Sale);
    case 'phone_payment':    return resolvePhonePaymentActions(entity.raw as Sale);
    case 'inventory_product':return resolveInventoryProductActions(entity.raw as InventoryItem);
    case 'employee':         return resolveEmployeeActions(entity.raw as Employee);
  }
}
