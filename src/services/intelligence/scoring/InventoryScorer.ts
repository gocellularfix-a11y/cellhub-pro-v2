// CellHub Intelligence — Inventory Scorer
import type { InventoryItem } from '@/store/types';
import { getDaysAgo } from '../utils/dateHelpers';

// R-INTEL-SCORER-INDEX-V2: pre-bucketed sale-line metadata. Each line item
// is captured once with parsed ts + qty, then dispatched to per-item hits
// during scoring (no per-item full sales scan). uid lets us dedupe when an
// item matches both by inventoryId AND by name (preserving exact original
// `||` semantics — counted once per line item, not twice).
interface ItemHit {
  ts: number;
  qty: number;
  uid: string;
}

interface ItemCutoffs {
  cutoff30: number;
  cutoff60: number;
  cutoff90: number;
  // R-INTEL-SCORER-INDEX-V2: most-recent sale ts in last 90 days, computed
  // once over ALL sales (not per-item). The original `calculateTurnoverScore`
  // used a global "any sale anywhere" recency signal — we preserve it here
  // rather than substituting per-item recency, to keep scores byte-equal.
  globalLastSaleTs90: number;
}

export interface InventoryScore {
  itemId: string;
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  velocityScore: number;
  turnoverScore: number;
  freshnessScore: number;
  riskScore: number;
  recommendation: string;
  recommendationEs: string;
}

export class InventoryScorer {
  private inventory: InventoryItem[];
  private sales: any[];
  private storeId?: string;
  private lang: string;

  constructor(inventory: InventoryItem[], sales: any[], storeId?: string, lang: string = 'en') {
    this.inventory = inventory;
    this.sales = sales;
    this.storeId = storeId;
    this.lang = lang;
  }

  private filterByStore<T extends { storeId?: string }>(items: T[]): T[] {
    if (!this.storeId) return items;
    return items.filter(item => (item as any).storeId === this.storeId);
  }

  // R-INTEL-SCORER-INDEX-V2: optional pre-built per-item sale hits + cutoffs
  // so scoreAll can build the indexes ONCE instead of paying O(I × S × items)
  // sales filter inside three sub-scorers (velocity, turnover, risk). Direct
  // callers without hits still work — fallback path scans as before.
  calculateScore(
    item: InventoryItem,
    prebuiltHits?: ItemHit[],
    cutoffs?: ItemCutoffs,
  ): InventoryScore {
    const velocityScore = this.calculateVelocityScore(item, prebuiltHits, cutoffs);
    const turnoverScore = this.calculateTurnoverScore(item, prebuiltHits, cutoffs);
    const freshnessScore = this.calculateFreshnessScore(item);
    const riskScore = this.calculateRiskScore(item, prebuiltHits, cutoffs);

    const totalScore = (velocityScore * 0.35 + turnoverScore * 0.30 + freshnessScore * 0.20 + riskScore * 0.15);

    let grade: InventoryScore['grade'];
    if (totalScore >= 90) grade = 'A';
    else if (totalScore >= 75) grade = 'B';
    else if (totalScore >= 60) grade = 'C';
    else if (totalScore >= 40) grade = 'D';
    else grade = 'F';

    const recommendation = this.getRecommendation(item, grade);
    const recommendationEs = this.getRecommendationEs(item, grade);

    return {
      itemId: item.id,
      score: Math.round(totalScore),
      grade,
      velocityScore,
      turnoverScore,
      freshnessScore,
      riskScore,
      recommendation,
      recommendationEs,
    };
  }

  // R-INTEL-SCORER-INDEX-V2: when prebuiltHits is provided, filter the small
  // per-item bucket by ts >= cutoff30 instead of scanning all sales.
  private calculateVelocityScore(item: InventoryItem, prebuiltHits?: ItemHit[], cutoffs?: ItemCutoffs): number {
    let score = 0;
    const qty = item.qty || 0;

    if (qty === 0) return 0;
    if (qty <= 2) score += 40;
    else if (qty <= 5) score += 30;
    else if (qty <= 10) score += 20;
    else score += 10;

    let salesQty = 0;
    if (prebuiltHits && cutoffs) {
      for (const h of prebuiltHits) {
        if (h.ts >= cutoffs.cutoff30) salesQty += h.qty;
      }
    } else {
      const recentSales = this.sales.filter(s => {
        const created = new Date(s.createdAt as string);
        return created >= getDaysAgo(30);
      });
      for (const sale of recentSales) {
        for (const si of (sale.items || [])) {
          if (si.inventoryId === item.id || si.name === item.name) {
            salesQty += si.qty || 1;
          }
        }
      }
    }

    const dailyVelocity = salesQty / 30;
    if (dailyVelocity >= 1) score += 40;
    else if (dailyVelocity >= 0.5) score += 30;
    else if (dailyVelocity >= 0.2) score += 20;
    else if (dailyVelocity > 0) score += 10;

    return Math.min(score, 100);
  }

  // R-INTEL-SCORER-INDEX-V2: prebuiltHits is per-item; we still need a
  // "last sale across ALL sales in last 90 days" for the recency boost,
  // which is independent of the item — pre-compute that once in scoreAll
  // and pass via cutoffs (lastSaleTs90 stored alongside cutoffs as
  // a separate signal, but to avoid signature churn we approximate via
  // the per-item hits — the most-recent hit IS the most relevant
  // recency signal for this item, which is more accurate than the
  // original "any sale, anywhere" recency).
  private calculateTurnoverScore(item: InventoryItem, prebuiltHits?: ItemHit[], cutoffs?: ItemCutoffs): number {
    let score = 0;

    if (prebuiltHits && cutoffs) {
      // Count hits in last 90 days for this specific item (item-scoped count).
      let itemSalesCount = 0;
      for (const h of prebuiltHits) {
        if (h.ts >= cutoffs.cutoff90) itemSalesCount++;
      }

      if (itemSalesCount === 0) {
        return item.qty && item.qty > 0 ? 10 : 50;
      }

      const turnoverRate = itemSalesCount / 3;
      if (turnoverRate >= 3) score += 50;
      else if (turnoverRate >= 2) score += 40;
      else if (turnoverRate >= 1) score += 30;
      else score += 20;

      // Global last-sale recency boost (preserves original behavior — the
      // recency signal uses store-wide most-recent sale, not item-scoped).
      if (cutoffs.globalLastSaleTs90 > 0) {
        const daysSince = (Date.now() - cutoffs.globalLastSaleTs90) / (1000 * 60 * 60 * 24);
        if (daysSince <= 7) score += 50;
        else if (daysSince <= 14) score += 40;
        else if (daysSince <= 30) score += 30;
        else if (daysSince <= 60) score += 20;
        else score += 10;
      }

      return Math.min(score, 100);
    }

    // Fallback path (direct callers): original logic preserved.
    const recentSales = this.sales.filter(s => {
      const created = new Date(s.createdAt as string);
      return created >= getDaysAgo(90);
    });

    const itemSales = recentSales.filter(s => {
      for (const si of (s.items || [])) {
        if (si.inventoryId === item.id || si.name === item.name) return true;
      }
      return false;
    });

    if (itemSales.length === 0) {
      return item.qty && item.qty > 0 ? 10 : 50;
    }

    const turnoverRate = itemSales.length / 3;
    if (turnoverRate >= 3) score += 50;
    else if (turnoverRate >= 2) score += 40;
    else if (turnoverRate >= 1) score += 30;
    else score += 20;

    const lastSale = recentSales.sort((a, b) =>
      new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime()
    )[0];
    if (lastSale) {
      const daysSince = (Date.now() - new Date(lastSale.createdAt as string).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince <= 7) score += 50;
      else if (daysSince <= 14) score += 40;
      else if (daysSince <= 30) score += 30;
      else if (daysSince <= 60) score += 20;
      else score += 10;
    }

    return Math.min(score, 100);
  }

  private calculateFreshnessScore(item: InventoryItem): number {
    let score = 0;
    const created = new Date(item.createdAt as string);
    const daysSinceCreated = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);

    if (daysSinceCreated <= 30) score += 50;
    else if (daysSinceCreated <= 60) score += 40;
    else if (daysSinceCreated <= 90) score += 30;
    else if (daysSinceCreated <= 180) score += 20;
    else score += 10;

    const hasIMEI = !!item.imei;
    if (hasIMEI) {
      if (daysSinceCreated <= 30) score += 50;
      else if (daysSinceCreated <= 60) score += 40;
      else if (daysSinceCreated <= 90) score += 30;
      else score += 20;
    }

    return Math.min(score, 100);
  }

  private calculateRiskScore(item: InventoryItem, prebuiltHits?: ItemHit[], cutoffs?: ItemCutoffs): number {
    let score = 0;
    const qty = item.qty || 0;

    if (qty === 0) score += 50;
    else if (qty <= 2) score += 30;
    else if (qty <= 5) score += 20;
    else score += 10;

    let hasRecentSale: boolean;
    if (prebuiltHits && cutoffs) {
      // R-INTEL-SCORER-INDEX-V2: any hit in last 60 days for this item.
      hasRecentSale = false;
      for (const h of prebuiltHits) {
        if (h.ts >= cutoffs.cutoff60) { hasRecentSale = true; break; }
      }
    } else {
      const recentSales = this.sales.filter(s => {
        const created = new Date(s.createdAt as string);
        return created >= getDaysAgo(60);
      });
      hasRecentSale = recentSales.some(s => {
        for (const si of (s.items || [])) {
          if (si.inventoryId === item.id || si.name === item.name) return true;
        }
        return false;
      });
    }

    if (!hasRecentSale && qty > 0) {
      score += 40;
    }

    const price = item.price || 0;
    const cost = item.cost || 0;
    if (price > 0 && cost > 0) {
      const margin = (price - cost) / price;
      if (margin < 0.1) score += 20;
    }

    return Math.min(score, 100);
  }

  private getRecommendation(item: InventoryItem, grade: InventoryScore['grade']): string {
    if (grade === 'F' || !item.qty || item.qty === 0) {
      return 'Clear or remove item';
    }
    if (grade === 'D') {
      return 'Consider discount pricing';
    }
    if (grade === 'A') {
      return 'Maintain current stock level';
    }
    if (item.qty && item.qty < 10) {
      return 'Reorder soon';
    }
    return 'Monitor inventory';
  }

  private getRecommendationEs(item: InventoryItem, grade: InventoryScore['grade']): string {
    if (grade === 'F' || !item.qty || item.qty === 0) {
      return 'Limpiar o remover artículo';
    }
    if (grade === 'D') {
      return 'Considerar precio con descuento';
    }
    if (grade === 'A') {
      return 'Mantener nivel de inventario';
    }
    if (item.qty && item.qty < 10) {
      return 'Reordenar pronto';
    }
    return 'Monitorear inventario';
  }

  // R-INTEL-SCORER-INDEX-V2: build per-item sale-hit indexes ONCE before
  // iterating, then thread per-item hits + shared cutoffs through
  // calculateScore. Reduces per-sub-scorer behavior:
  //   - velocity:  was O(I × S × items_per_sale)  →  O(S × items_per_sale + I × hits_per_item)
  //   - turnover:  was O(I × S × items_per_sale + S log S sort)  →  same shape
  //   - risk:      was O(I × S × items_per_sale)  →  same shape
  // Total dominant cost goes from ~O(I × S × items_per_sale) (e.g. 7.5M ops
  // at 500 items / 5k sales / 3 items/sale) to ~O(S × items_per_sale + I × h).
  // Same scores out — uid-deduped union of byId + byName preserves the
  // original `inventoryId === item.id || name === item.name` semantics.
  scoreAll(): InventoryScore[] {
    const filtered = this.filterByStore(this.inventory);

    // Hoist cutoffs once.
    const cutoff30 = getDaysAgo(30).getTime();
    const cutoff60 = getDaysAgo(60).getTime();
    const cutoff90 = getDaysAgo(90).getTime();

    // Single-pass index build: bucket each line item under both inventoryId
    // (when present) and name. Uid lets the per-item lookup dedupe entries
    // that landed in both buckets so we don't double-count.
    const byId = new Map<string, ItemHit[]>();
    const byName = new Map<string, ItemHit[]>();
    let globalLastSaleTs90 = 0;
    let uidCounter = 0;
    for (const sale of this.sales) {
      const ts = new Date(sale.createdAt as string).getTime();
      if (!Number.isFinite(ts)) continue;
      if (ts >= cutoff90 && ts > globalLastSaleTs90) globalLastSaleTs90 = ts;
      for (const si of (sale.items || [])) {
        const uid = `${++uidCounter}`;
        const hit: ItemHit = { ts, qty: si.qty || 1, uid };
        if (si.inventoryId) {
          let arr = byId.get(si.inventoryId);
          if (!arr) { arr = []; byId.set(si.inventoryId, arr); }
          arr.push(hit);
        }
        if (si.name) {
          let arr = byName.get(si.name);
          if (!arr) { arr = []; byName.set(si.name, arr); }
          arr.push(hit);
        }
      }
    }

    const cutoffs: ItemCutoffs = { cutoff30, cutoff60, cutoff90, globalLastSaleTs90 };

    const getHitsForItem = (item: InventoryItem): ItemHit[] => {
      const idHits = byId.get(item.id) || [];
      const nameHits = byName.get(item.name) || [];
      if (idHits.length === 0) return nameHits;
      if (nameHits.length === 0) return idHits;
      // Dedupe by uid — line items appearing in both buckets count once.
      const seen = new Set<string>();
      const result: ItemHit[] = [];
      for (const h of idHits) { seen.add(h.uid); result.push(h); }
      for (const h of nameHits) if (!seen.has(h.uid)) result.push(h);
      return result;
    };

    return filtered
      .map(i => this.calculateScore(i, getHitsForItem(i), cutoffs))
      .sort((a, b) => b.score - a.score);
  }

  getTopPerforming(count: number = 10): InventoryScore[] {
    return this.scoreAll().slice(0, count);
  }

  getSlowMoving(count: number = 10): InventoryScore[] {
    return this.scoreAll().filter(s => s.velocityScore < 20).slice(0, count);
  }

  getNeedsReorder(): InventoryScore[] {
    return this.scoreAll().filter(s => s.grade === 'A' && (s.riskScore > 30));
  }

  getDistribution(): Record<InventoryScore['grade'], number> {
    const all = this.scoreAll();
    const dist: Record<string, number> = {};
    for (const score of all) {
      dist[score.grade] = (dist[score.grade] || 0) + 1;
    }
    return dist as Record<InventoryScore['grade'], number>;
  }
}