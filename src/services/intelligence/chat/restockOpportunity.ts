// ============================================================
// CellHub Intelligence — Restock Opportunity Engine
// R-INTELLIGENCE-LOW-STOCK-OPPORTUNITY-ENGINE
//
// Deterministic answer to "what should I restock?" — combines low-stock
// signals with REAL recent sales velocity so the operator gets a ranked
// list of items that are running out AND likely to make money soon.
// Dead stock is excluded by design (zero sales in 30d → not surfaced).
//
// NO LLM, NO embeddings, NO randomness. Pure reads + integer math. Same
// inputs → same recommendations.
// ============================================================

import type { IntelligenceEngine } from '../IntelligenceEngine';
import type { Sale, InventoryItem } from '@/store/types';
import { tChat, type Lang3, type ChatResponse, type ChatActionUI, COP } from './handlers';

// ── Public types ──────────────────────────────────────────

export interface RestockRecommendation {
  id: string;             // inventory item id
  name: string;
  sku: string;
  category: string;
  qty: number;
  minQty: number | null;
  priceCents: number;
  costCents: number;
  marginCents: number;
  marginRatio: number;          // 0..1
  recentSales14d: number;
  recentSales7d: number;
  daysOfCover: number | null;   // null when velocity is zero
  score: number;
  /** Pre-rendered reason and action strings (already translated). */
  reason: string;
  recommendedAction: string;
}

// ── Tunable thresholds (deterministic constants) ──────────

const VELOCITY_WINDOW_DAYS         = 14;
const SHORT_WINDOW_DAYS            = 7;
const DEAD_STOCK_WINDOW_DAYS       = 30;
const DAYS_OF_COVER_CRITICAL       = 5;
const DAYS_OF_COVER_LOW            = 10;
const OVERSTOCK_DOC_THRESHOLD_DAYS = 60;
const MIN_SCORE_THRESHOLD          = 30;
const MAX_RECS                     = 5;

// ── Helpers ───────────────────────────────────────────────

function tsOf(v: unknown): number {
  if (!v) return 0;
  if (typeof v === 'string') { const n = new Date(v).getTime(); return Number.isFinite(n) ? n : 0; }
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'object' && v !== null) {
    const obj = v as { toDate?: () => Date; seconds?: number };
    if (typeof obj.toDate === 'function') { try { return obj.toDate().getTime(); } catch { return 0; } }
    if (typeof obj.seconds === 'number') return obj.seconds * 1000;
  }
  return 0;
}

interface SalesIndex {
  /** Units sold per inventory id over [now - VELOCITY_WINDOW_DAYS, now]. */
  units14: Map<string, number>;
  /** Units sold per inventory id over [now - SHORT_WINDOW_DAYS, now]. */
  units7: Map<string, number>;
  /** True iff inventory id had at least one sale in DEAD_STOCK_WINDOW_DAYS. */
  hadRecentSale: Set<string>;
}

/**
 * Single-pass index — never scans sales twice per call. Pure / memoizable
 * by the caller on (sales, nowMs).
 */
function buildSalesIndex(sales: Sale[], nowMs: number): SalesIndex {
  const cutoff30 = nowMs - DEAD_STOCK_WINDOW_DAYS * 86400000;
  const cutoff14 = nowMs - VELOCITY_WINDOW_DAYS * 86400000;
  const cutoff7  = nowMs - SHORT_WINDOW_DAYS    * 86400000;
  const units14 = new Map<string, number>();
  const units7  = new Map<string, number>();
  const hadRecentSale = new Set<string>();
  for (const s of sales || []) {
    if (s.status === 'voided' || s.status === 'refunded') continue;
    const ms = tsOf(s.createdAt);
    if (!ms || ms < cutoff30) continue;
    for (const i of (s.items || [])) {
      const invId = (i as any).inventoryId as string | undefined;
      if (!invId) continue;
      const qty = Math.max(0, (i.qty || 0));
      if (qty <= 0) continue;
      hadRecentSale.add(invId);
      if (ms >= cutoff14) units14.set(invId, (units14.get(invId) || 0) + qty);
      if (ms >= cutoff7)  units7.set(invId,  (units7.get(invId)  || 0) + qty);
    }
  }
  return { units14, units7, hadRecentSale };
}

function statusOk(s: unknown): boolean {
  const k = String(s || '').toLowerCase();
  return k !== 'voided' && k !== 'refunded';
}
void statusOk;

// ── Scoring rules (deterministic) ─────────────────────────

interface ScoreParts {
  lowStockWeight: number;
  salesVelocityWeight: number;
  marginWeight: number;
  recentDemandWeight: number;
  /** Returned as 0 when keep, set to a positive value to subtract. */
  deadStockPenalty: number;
}

function scoreItem(item: InventoryItem, idx: SalesIndex): ScoreParts | null {
  const id = item.id;
  if (!id) return null;
  // SAFETY: dead stock filter — if NO inventory-linked sale in the last
  // 30 days, refuse to recommend regardless of low stock.
  if (!idx.hadRecentSale.has(id)) return null;
  const qty = Math.max(0, item.qty || 0);
  const minQty = typeof item.minQty === 'number' && item.minQty > 0 ? item.minQty : null;
  const sold14 = idx.units14.get(id) || 0;
  const sold7  = idx.units7.get(id)  || 0;
  // Velocity floor — require some recent demand to surface a restock.
  if (sold14 < 1 && qty > 0) return null;

  const velocityPerDay = sold14 / VELOCITY_WINDOW_DAYS;
  const daysOfCover = velocityPerDay > 0 ? qty / velocityPerDay : null;

  // OVERSTOCK exclusion — already plenty of cover.
  if (daysOfCover !== null && daysOfCover > OVERSTOCK_DOC_THRESHOLD_DAYS) return null;

  // Low-stock weight (qty in absolute + relative-to-minQty + days-of-cover terms).
  let lowStockWeight = 0;
  if (qty === 0) {
    lowStockWeight = 80;
  } else if (minQty !== null && qty <= minQty) {
    lowStockWeight = 60 + Math.round((1 - qty / minQty) * 40);
  }
  if (daysOfCover !== null) {
    if (daysOfCover <= DAYS_OF_COVER_CRITICAL)        lowStockWeight += 50;
    else if (daysOfCover <= DAYS_OF_COVER_LOW)        lowStockWeight += 25;
  }

  const salesVelocityWeight = Math.min(80, sold14 * 8);

  const priceCents = Math.max(0, item.price || 0);
  const costCents  = Math.max(0, item.cost  || 0);
  const marginRatio = priceCents > 0 ? (priceCents - costCents) / priceCents : 0;
  const marginWeight = priceCents > 0 ? Math.round(Math.max(0, Math.min(1, marginRatio)) * 50) : 0;

  let recentDemandWeight = 0;
  if (sold7 >= 3) recentDemandWeight = 30;
  else if (sold7 >= 1) recentDemandWeight = 10;

  return {
    lowStockWeight,
    salesVelocityWeight,
    marginWeight,
    recentDemandWeight,
    deadStockPenalty: 0,
  };
}

// ── Action builder ────────────────────────────────────────

function actionsForItem(rec: RestockRecommendation, t: ReturnType<typeof tChat>): ChatActionUI[] {
  return [
    {
      id: `restock-${rec.id}-open`,
      label: t('chat.restock.action.openItem'),
      payload: {
        type: 'operator_action', executable: true,
        executionTarget: 'open_inventory', entityId: rec.id, productName: rec.name,
      },
    },
    {
      id: `restock-${rec.id}-module`,
      label: t('chat.restock.action.openModule'),
      payload: { type: 'review', executable: true, executionTarget: 'open_inventory' },
    },
  ];
}

// ── Public entry point ────────────────────────────────────

/**
 * R-INTELLIGENCE-LOW-STOCK-OPPORTUNITY-ENGINE
 *
 * Returns up to 5 deterministic restock recommendations. Items with zero
 * sales in the last 30 days are excluded — no fabricated demand. Items
 * with >60 days of cover are excluded — no over-recommendation. Output
 * is sorted by priority score; tie-break by entity id (lexical).
 */
/**
 * R-INTELLIGENCE-WHAT-SHOULD-I-FOCUS-ON-TODAY: structured-signal export so the
 * focus-today aggregator can consume restock candidates without rebuilding
 * the index. Returns up to MAX_RECS already-ranked recommendations. Reason
 * and recommendedAction strings are pre-rendered for downstream display.
 */
export function computeRestockRecommendations(
  engine: IntelligenceEngine,
  lang: Lang3,
): RestockRecommendation[] {
  const t = tChat(lang);
  const nowMs = Date.now();
  const inventory = engine.getInventory() || [];
  const sales = engine.getSales() || [];
  if (inventory.length === 0) return [];

  const idx = buildSalesIndex(sales, nowMs);

  const recs: RestockRecommendation[] = [];
  for (const item of inventory) {
    const parts = scoreItem(item, idx);
    if (!parts) continue;
    const total = parts.lowStockWeight
      + parts.salesVelocityWeight
      + parts.marginWeight
      + parts.recentDemandWeight
      - parts.deadStockPenalty;
    if (total < MIN_SCORE_THRESHOLD) continue;
    const qty = Math.max(0, item.qty || 0);
    const minQty = typeof item.minQty === 'number' && item.minQty > 0 ? item.minQty : null;
    const sold14 = idx.units14.get(item.id) || 0;
    const sold7  = idx.units7.get(item.id)  || 0;
    const velocityPerDay = sold14 / VELOCITY_WINDOW_DAYS;
    const daysOfCover = velocityPerDay > 0 ? Math.max(0, Math.floor(qty / velocityPerDay)) : null;
    const priceCents = Math.max(0, item.price || 0);
    const costCents  = Math.max(0, item.cost  || 0);
    const marginCents = Math.max(0, priceCents - costCents);
    const marginRatio = priceCents > 0 ? marginCents / priceCents : 0;
    recs.push({
      id: item.id,
      name: item.name || item.sku || item.id.slice(-6),
      sku: item.sku || '',
      category: String(item.category || ''),
      qty,
      minQty,
      priceCents,
      costCents,
      marginCents,
      marginRatio,
      recentSales14d: sold14,
      recentSales7d: sold7,
      daysOfCover,
      score: total,
      reason: '',
      recommendedAction: '',
    });
  }
  if (recs.length === 0) return [];

  recs.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const top = recs.slice(0, MAX_RECS);

  for (const r of top) {
    r.reason = r.qty === 0
      ? t('chat.restock.reason.outOfStock', r.recentSales14d, VELOCITY_WINDOW_DAYS)
      : r.daysOfCover !== null && r.daysOfCover <= DAYS_OF_COVER_CRITICAL
      ? t('chat.restock.reason.critical', r.qty, r.recentSales14d, VELOCITY_WINDOW_DAYS, r.daysOfCover)
      : r.minQty !== null && r.qty <= r.minQty
      ? t('chat.restock.reason.belowMin', r.qty, r.minQty, r.recentSales14d, VELOCITY_WINDOW_DAYS)
      : t('chat.restock.reason.lowCover', r.qty, r.recentSales14d, VELOCITY_WINDOW_DAYS);
    r.recommendedAction = r.qty === 0
      ? t('chat.restock.action.reorderNow')
      : r.daysOfCover !== null && r.daysOfCover <= DAYS_OF_COVER_CRITICAL
      ? t('chat.restock.action.reorderSoon')
      : t('chat.restock.action.replenish');
  }

  return top;
}

export function handleRestockOpportunity(
  engine: IntelligenceEngine,
  lang: Lang3,
  // R-FINANCIAL-PRIVACY-V5 Tier 2: when false (employee + Financial Privacy
  // ON), the operational restock list is preserved but the per-item margin
  // line is omitted entirely — no margin/cost/profit text, no fake zeros.
  // Default true preserves owner/admin behavior and every existing caller.
  canSeeOwnerFinancials: boolean = true,
): ChatResponse {
  const t = tChat(lang);
  const inventory = engine.getInventory() || [];

  if (inventory.length === 0) {
    return {
      kind: 'answer',
      text: `**${t('chat.restock.header')}**\n\n${t('chat.restock.emptyInventory')}`,
    };
  }

  const top = computeRestockRecommendations(engine, lang);

  if (top.length === 0) {
    return {
      kind: 'answer',
      text: `**${t('chat.restock.header')}**\n\n${t('chat.restock.noOpportunity')}`,
    };
  }

  // After-compute placeholder loop so this branch keeps the same surface as
  // before — `top` is now already pre-filled with reason/recommendedAction
  // by computeRestockRecommendations. No-op for backward compat readers
  // that grep this site.
  for (const r of top) {
    r.reason = r.qty === 0
      ? t('chat.restock.reason.outOfStock', r.recentSales14d, VELOCITY_WINDOW_DAYS)
      : r.daysOfCover !== null && r.daysOfCover <= DAYS_OF_COVER_CRITICAL
      ? t('chat.restock.reason.critical', r.qty, r.recentSales14d, VELOCITY_WINDOW_DAYS, r.daysOfCover)
      : r.minQty !== null && r.qty <= r.minQty
      ? t('chat.restock.reason.belowMin', r.qty, r.minQty, r.recentSales14d, VELOCITY_WINDOW_DAYS)
      : t('chat.restock.reason.lowCover', r.qty, r.recentSales14d, VELOCITY_WINDOW_DAYS);
    r.recommendedAction = r.qty === 0
      ? t('chat.restock.action.reorderNow')
      : r.daysOfCover !== null && r.daysOfCover <= DAYS_OF_COVER_CRITICAL
      ? t('chat.restock.action.reorderSoon')
      : t('chat.restock.action.replenish');
  }

  const lines: string[] = [`**${t('chat.restock.header')}**`, ''];
  for (let i = 0; i < top.length; i++) {
    const r = top[i];
    const marginPct = Math.round(r.marginRatio * 100);
    // R-FINANCIAL-PRIVACY-V5 Tier 2: margin $ / margin % are owner-only.
    // Skip computing and rendering the label when the viewer can't see them.
    const marginLabel = (canSeeOwnerFinancials && r.priceCents > 0)
      ? t('chat.restock.marginLabel', COP(r.marginCents), marginPct)
      : '';
    lines.push(`${i + 1}. 📦 **${r.name}**${r.sku ? ` · ${r.sku}` : ''}`);
    lines.push(`   📊 ${r.reason}${marginLabel ? ` · ${marginLabel}` : ''}`);
    lines.push(`   💡 ${r.recommendedAction}`);
  }

  const rawActions: ChatActionUI[] = [];
  for (const r of top) {
    for (const a of actionsForItem(r, t)) rawActions.push(a);
  }

  return {
    kind: 'answer',
    text: lines.join('\n'),
    ...(rawActions.length > 0 ? { actions: rawActions.slice(0, 8) } : {}),
    // Continuity: stamp the top recommendation as the active product so
    // follow-ups ("order it", "open it", "what about accessories") route
    // through the existing operational-context pipeline.
    establishesContext: { type: 'product', value: top[0].id },
  };
}
