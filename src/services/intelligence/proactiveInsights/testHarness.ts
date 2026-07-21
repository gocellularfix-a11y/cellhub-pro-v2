// ============================================================
// I6-0A — shared TEST fixtures for the proactive insight suite.
// Test-support only: deterministic builders around the REAL engine API
// (IntelligenceEngine → canonical computeReportMoneyStats). Never imported
// by production code.
// ============================================================

import { IntelligenceEngine } from '../IntelligenceEngine';
import type { Customer, Sale, SaleItem } from '@/store/types';
import { buildProactiveContext } from './proactiveInsightEngine';
import type { ProactiveInsightContext } from './types';

/** Wed 2026-07-15 — current 7v7: 2026-07-08…14 vs 2026-07-01…07;
 *  carrier window30: 2026-06-15…2026-07-14. */
export const REF = new Date(2026, 6, 15, 12, 0, 0);

let seq = 0;

export interface ItemOpts {
  name?: string;
  cost?: number;
  carrier?: string;
  category?: string;
  isActivation?: boolean;
}

export function item(price: number, opts: ItemOpts = {}): SaleItem {
  return {
    id: `it-${++seq}`,
    name: opts.name ?? 'Case',
    category: (opts.category ?? 'accessory') as SaleItem['category'],
    price,
    qty: 1,
    cost: opts.cost ?? Math.round(price / 2),
    cbeEligible: false,
    taxable: true,
    ...(opts.carrier ? { carrier: opts.carrier } : {}),
    ...(opts.isActivation ? { isActivation: true } : {}),
  } as SaleItem;
}

export interface SaleOpts {
  items?: SaleItem[];
  status?: string;
  invoiceNumber?: string;
  customerId?: string | null;
  storeId?: string;
  isRefund?: boolean;
  customerName?: string;
}

export function sale(createdAt: string, price: number, opts: SaleOpts = {}): Sale {
  const items = opts.items ?? [item(price)];
  const customerId = opts.customerId === null ? undefined : (opts.customerId ?? 'c1');
  return {
    id: `s-${++seq}`,
    invoiceNumber: opts.invoiceNumber ?? `INV-${seq}`,
    items,
    subtotal: price,
    taxAmount: 0,
    cbeTotal: 0,
    total: price,
    paymentMethod: 'cash',
    status: opts.status ?? 'completed',
    createdAt,
    employeeName: 'Ana',
    ...(customerId ? { customerId } : {}),
    ...(opts.storeId ? { storeId: opts.storeId } : {}),
    ...(opts.isRefund ? { isRefund: true } : {}),
    ...(opts.customerName ? { customerName: opts.customerName } : {}),
  } as unknown as Sale;
}

export function engineWith(sales: Sale[], storeId?: string): IntelligenceEngine {
  return new IntelligenceEngine(
    sales, [] as Customer[], [], [],
    { lang: 'en', enableAlerts: false, enableScoring: false, cacheTimeoutMinutes: 15, ...(storeId ? { storeId } : {}) } as never,
    { customerReturns: [], settings: { defaultCommissionRate: 0.07 } } as never,
  );
}

export function contextOf(engine: IntelligenceEngine, ref: Date = REF): ProactiveInsightContext {
  return buildProactiveContext(engine.getStructuredQueryContext(ref));
}

/** N sales of `each` cents spread across the window days (deterministic). */
export function windowSales(startDay: number, month: string, n: number, each: number, opts: SaleOpts & { itemOpts?: ItemOpts } = {}): Sale[] {
  const { itemOpts, ...saleOpts } = opts;
  return Array.from({ length: n }, (_, i) =>
    sale(
      `2026-${month}-${String(startDay + (i % 7)).padStart(2, '0')}T10:00:00`,
      each,
      { ...saleOpts, items: itemOpts ? [item(each, itemOpts)] : saleOpts.items },
    ));
}
