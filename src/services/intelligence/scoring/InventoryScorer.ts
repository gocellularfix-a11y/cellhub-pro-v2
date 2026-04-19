// CellHub Intelligence — Inventory Scorer
import type { InventoryItem } from '@/store/types';
import { getDaysAgo } from '../utils/dateHelpers';

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

  calculateScore(item: InventoryItem): InventoryScore {
    const velocityScore = this.calculateVelocityScore(item);
    const turnoverScore = this.calculateTurnoverScore(item);
    const freshnessScore = this.calculateFreshnessScore(item);
    const riskScore = this.calculateRiskScore(item);

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

  private calculateVelocityScore(item: InventoryItem): number {
    let score = 0;
    const qty = item.qty || 0;

    if (qty === 0) return 0;
    if (qty <= 2) score += 40;
    else if (qty <= 5) score += 30;
    else if (qty <= 10) score += 20;
    else score += 10;

    const recentSales = this.sales.filter(s => {
      const created = new Date(s.createdAt as string);
      return created >= getDaysAgo(30);
    });
    let salesQty = 0;
    for (const sale of recentSales) {
      for (const si of (sale.items || [])) {
        if (si.inventoryId === item.id || si.name === item.name) {
          salesQty += si.qty || 1;
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

  private calculateTurnoverScore(item: InventoryItem): number {
    let score = 0;

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

  private calculateRiskScore(item: InventoryItem): number {
    let score = 0;
    const qty = item.qty || 0;

    if (qty === 0) score += 50;
    else if (qty <= 2) score += 30;
    else if (qty <= 5) score += 20;
    else score += 10;

    const recentSales = this.sales.filter(s => {
      const created = new Date(s.createdAt as string);
      return created >= getDaysAgo(60);
    });
    const hasRecentSale = recentSales.some(s => {
      for (const si of (s.items || [])) {
        if (si.inventoryId === item.id || si.name === item.name) return true;
      }
      return false;
    });

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

  scoreAll(): InventoryScore[] {
    const filtered = this.filterByStore(this.inventory);
    return filtered.map(i => this.calculateScore(i)).sort((a, b) => b.score - a.score);
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