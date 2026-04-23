// ============================================================
// CellHub Intelligence — Cross-Module Correlations
// R-INTEL-CROSS-F3
//
// Finds signals that span analyzer boundaries. Today's analyzers are
// siloed (sales / inventory / repairs / customers / financial), each
// looking at its own slice. The real value in a POS/repair shop is
// cross-module: "repair volume up in category X → stock accessory Y".
//
// Pure compute, no side effects. Callers pass raw data; results are
// consumable by the engine (to fold into Insight[]) or directly by UI.
// ============================================================

import type { InventoryItem, Repair, Sale } from '@/store/types';
import { getDaysAgo } from './utils/dateHelpers';
import { correlationCoefficient } from './utils/statistics';

// ── Repair type classifier ────────────────────────────────
// Centralized so correlations + RepairAnalyzer stay in sync.
// TODO: move RepairAnalyzer's inline classifier to consume this.
export function classifyRepairIssue(issue: string | undefined): string {
  const s = (issue || '').toLowerCase();
  if (s.includes('screen') || s.includes('pantalla') || s.includes('display')) return 'screen';
  if (s.includes('battery') || s.includes('bateria') || s.includes('batería')) return 'battery';
  if (s.includes('charge') || s.includes('carga') || s.includes('port')) return 'charging';
  if (s.includes('water') || s.includes('liquid') || s.includes('agua')) return 'water_damage';
  if (s.includes('software') || s.includes('update') || s.includes('firmware')) return 'software';
  if (s.includes('speaker') || s.includes('mic') || s.includes('audio') || s.includes('bocina')) return 'audio';
  if (s.includes('camera') || s.includes('camara') || s.includes('cámara')) return 'camera';
  return 'other';
}

// Keywords in inventory item names that correlate with each repair type.
// Not exhaustive — shop owners can improve this by naming products clearly.
const REPAIR_INVENTORY_KEYWORDS: Record<string, string[]> = {
  screen: ['screen', 'protector', 'pantalla', 'glass', 'vidrio', 'tempered', 'mica'],
  battery: ['battery', 'bateria', 'batería', 'charger', 'cargador'],
  charging: ['cable', 'charger', 'cargador', 'port', 'puerto', 'adapter'],
  water_damage: ['case', 'waterproof', 'funda', 'cover'],
  audio: ['earphone', 'headphone', 'audifono', 'audífono', 'speaker'],
  camera: ['lens', 'lente', 'camera'],
  software: [],
  other: [],
};

export interface RepairInventoryGap {
  repairType: string;
  recentRepairCount: number;
  topDeviceModels: Array<{ model: string; count: number }>;
  relatedInventoryCount: number;
  lowStockRelatedItems: Array<{ id: string; name: string; qty: number }>;
  correlationScore: number;     // r — daily repair vol vs daily related-accessory sales
  confidence: number;           // 0..1 — grows with n data points
}

// Main entry: scan recent repairs, classify, cross-reference inventory
// by name-keyword matching, score opportunity via correlation coefficient
// on daily series.
export function findRepairInventoryGaps(
  repairs: Repair[],
  inventory: InventoryItem[],
  sales: Sale[],
  windowDays: number = 60,
  lowStockThreshold: number = 5,
): RepairInventoryGap[] {
  const windowStart = getDaysAgo(windowDays);
  const recentRepairs = repairs.filter(r => {
    const d = new Date(r.createdAt as string);
    return d >= windowStart;
  });
  const recentSales = sales.filter(s => {
    const d = new Date(s.createdAt as string);
    return d >= windowStart && s.status !== 'voided';
  });

  // Group repairs by type.
  const repairsByType = new Map<string, Repair[]>();
  for (const r of recentRepairs) {
    const type = classifyRepairIssue(r.issue);
    if (!repairsByType.has(type)) repairsByType.set(type, []);
    repairsByType.get(type)!.push(r);
  }

  const results: RepairInventoryGap[] = [];

  for (const [type, bucket] of repairsByType) {
    if (type === 'other' || type === 'software') continue;
    if (bucket.length < 3) continue; // low signal

    const keywords = REPAIR_INVENTORY_KEYWORDS[type] || [];
    if (keywords.length === 0) continue;

    // Top device models (up to 3) for this repair type.
    const modelCounts = new Map<string, number>();
    for (const r of bucket) {
      const model = (r.device || '').trim();
      if (!model) continue;
      modelCounts.set(model, (modelCounts.get(model) || 0) + 1);
    }
    const topDeviceModels = Array.from(modelCounts.entries())
      .map(([model, count]) => ({ model, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    // Related inventory: items whose name contains any of the keywords.
    const relatedItems = inventory.filter(item => {
      const name = (item.name || '').toLowerCase();
      return keywords.some(kw => name.includes(kw));
    });

    const lowStockRelated = relatedItems
      .filter(item => (item.qty || 0) > 0 && (item.qty || 0) <= lowStockThreshold)
      .map(item => ({
        id: item.id,
        name: item.name,
        qty: item.qty || 0,
      }))
      .sort((a, b) => a.qty - b.qty)
      .slice(0, 5);

    // Correlation — daily repair count vs daily related-accessory units sold.
    const dailyRepairCount: number[] = new Array(windowDays).fill(0);
    const dailyAccessoryUnits: number[] = new Array(windowDays).fill(0);
    for (const r of bucket) {
      const dayIdx = Math.floor(
        (new Date(r.createdAt as string).getTime() - windowStart.getTime())
        / (1000 * 60 * 60 * 24),
      );
      if (dayIdx >= 0 && dayIdx < windowDays) {
        dailyRepairCount[dayIdx] += 1;
      }
    }
    const relatedItemNames = new Set(relatedItems.map(i => i.name));
    for (const sale of recentSales) {
      const dayIdx = Math.floor(
        (new Date(sale.createdAt as string).getTime() - windowStart.getTime())
        / (1000 * 60 * 60 * 24),
      );
      if (dayIdx < 0 || dayIdx >= windowDays) continue;
      for (const si of sale.items || []) {
        if (relatedItemNames.has(si.name)) {
          dailyAccessoryUnits[dayIdx] += si.qty || 0;
        }
      }
    }
    const correlationScore = correlationCoefficient(dailyRepairCount, dailyAccessoryUnits);
    // Confidence grows with repair bucket size, capped at 0.9.
    const confidence = Math.min(0.9, bucket.length / 20);

    results.push({
      repairType: type,
      recentRepairCount: bucket.length,
      topDeviceModels,
      relatedInventoryCount: relatedItems.length,
      lowStockRelatedItems: lowStockRelated,
      correlationScore,
      confidence,
    });
  }

  return results.sort((a, b) => b.recentRepairCount - a.recentRepairCount);
}
