// CellHub Intelligence — Repair Scorer
import type { Repair, RepairStatus } from '@/store/types';
import { getDaysAgo } from '../utils/dateHelpers';

export interface RepairScore {
  repairId: string;
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  priorityScore: number;
  turnaroundScore: number;
  profitabilityScore: number;
  customerRiskScore: number;
  factors: string[];
}

export class RepairScorer {
  private repairs: Repair[];
  private storeId?: string;
  private lang: string;

  constructor(repairs: Repair[], storeId?: string, lang: string = 'en') {
    this.repairs = repairs;
    this.storeId = storeId;
    this.lang = lang;
  }

  private filterByStore<T extends { storeId?: string }>(items: T[]): T[] {
    if (!this.storeId) return items;
    return items.filter(item => (item as any).storeId === this.storeId);
  }

  // R-INTEL-SCORER-INDEX-V2: optional pre-bucketed customer→repairs index
  // so scoreAll can build it ONCE instead of paying O(R²) inside
  // calculateCustomerRiskScore. Direct callers without the index still work.
  calculateScore(
    repair: Repair,
    prebuiltCustomerRepairs?: Repair[],
  ): RepairScore {
    const priorityScore = this.calculatePriorityScore(repair);
    const turnaroundScore = this.calculateTurnaroundScore(repair);
    const profitabilityScore = this.calculateProfitabilityScore(repair);
    const customerRiskScore = this.calculateCustomerRiskScore(repair, prebuiltCustomerRepairs);

    const totalScore = (priorityScore * 0.35 + turnaroundScore * 0.30 + profitabilityScore * 0.20 + customerRiskScore * 0.15);

    let grade: RepairScore['grade'];
    if (totalScore >= 90) grade = 'A';
    else if (totalScore >= 75) grade = 'B';
    else if (totalScore >= 60) grade = 'C';
    else if (totalScore >= 40) grade = 'D';
    else grade = 'F';

    const factors: string[] = [];
    if (priorityScore >= 70) factors.push(this.lang === 'es' ? 'Alta prioridad' : 'High priority');
    if (turnaroundScore >= 70) factors.push(this.lang === 'es' ? 'Tiempo crítico' : 'Critical time');
    if (profitabilityScore >= 70) factors.push(this.lang === 'es' ? 'Alta rentabilidad' : 'High profitability');
    if (customerRiskScore >= 50) factors.push(this.lang === 'es' ? 'Cliente importante' : 'Important customer');

    return {
      repairId: repair.id,
      score: Math.round(totalScore),
      grade,
      priorityScore,
      turnaroundScore,
      profitabilityScore,
      customerRiskScore,
      factors,
    };
  }

  private calculatePriorityScore(repair: Repair): number {
    let score = 0;

    const priorityMap: Record<string, number> = {
      urgent: 100,
      high: 80,
      normal: 50,
      low: 20,
    };
    score += priorityMap[repair.priority] || 50;

    const statusMap: Record<string, number> = {
      received: 80,
      diagnosing: 60,
      waiting_parts: 40,
      in_progress: 100,
      ready: 20,
      picked_up: 0,
      cancelled: 0,
    };
    score = (score + (statusMap[repair.status] || 0)) / 2;

    return Math.min(score, 100);
  }

  private calculateTurnaroundScore(repair: Repair): number {
    let score = 100;

    const created = new Date(repair.createdAt as string);
    const daysSinceCreated = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);

    if (daysSinceCreated >= 7) score = 10;
    else if (daysSinceCreated >= 5) score = 30;
    else if (daysSinceCreated >= 3) score = 50;
    else if (daysSinceCreated >= 2) score = 70;
    else score = 90;

    if (repair.completedAt) {
      const completed = new Date(repair.completedAt as string);
      const hoursToComplete = (completed.getTime() - created.getTime()) / (1000 * 60 * 60);
      if (hoursToComplete <= 24) score = 100;
      else if (hoursToComplete <= 48) score = 80;
      else if (hoursToComplete <= 72) score = 60;
      else if (hoursToComplete <= 96) score = 40;
      else score = 20;
    }

    const remainingHours = repair.estimatedCompletion
      ? (new Date(repair.estimatedCompletion).getTime() - Date.now()) / (1000 * 60 * 60)
      : 48;
    if (remainingHours < 0) score = Math.min(score, 20);
    else if (remainingHours < 24) score = Math.min(score, 40);

    return Math.min(score, 100);
  }

  private calculateProfitabilityScore(repair: Repair): number {
    let score = 50;

    const total = repair.estimatedCost || 0;
    const deposit = repair.depositAmount || 0;
    const partsCost = repair.parts.reduce((sum, p) => sum + (p.cost || 0) * p.qty, 0);
    const laborCost = repair.laborCost || 0;

    if (total > 0) {
      const profit = total - partsCost - laborCost;
      const margin = profit / total;
      if (margin >= 0.4) score += 40;
      else if (margin >= 0.3) score += 30;
      else if (margin >= 0.2) score += 20;
      else if (margin >= 0.1) score += 10;
    }

    if (deposit >= total * 0.5) score += 20;
    else if (deposit >= total * 0.25) score += 10;

    return Math.min(score, 100);
  }

  // R-INTEL-SCORER-INDEX-V2: prebuiltCustomerRepairs is the bucket of all
  // repairs for `repair.customerId` (built once by scoreAll). We exclude self
  // by id to match the original `r.id !== repair.id` filter.
  private calculateCustomerRiskScore(repair: Repair, prebuiltCustomerRepairs?: Repair[]): number {
    let score = 30;

    if (repair.customerId) score += 20;

    let customerRepairsCount: number;
    if (prebuiltCustomerRepairs) {
      // Exclude self.
      let count = 0;
      for (const r of prebuiltCustomerRepairs) {
        if (r.id !== repair.id) count++;
      }
      customerRepairsCount = count;
    } else {
      customerRepairsCount = this.repairs.filter(r => r.customerId === repair.customerId && r.id !== repair.id).length;
    }
    if (customerRepairsCount > 0) score += 20;
    if (customerRepairsCount >= 3) score += 20;

    if (repair.warranty) score += 20;

    return Math.min(score, 100);
  }

  // R-INTEL-SCORER-INDEX-V2: build customer→repairs index ONCE before
  // iterating, then thread per-repair bucket through calculateScore.
  // Reduces calculateCustomerRiskScore: was O(R²) (filter `this.repairs`
  // per repair) → O(R) total. For 1k repairs: ~1M ops → ~1k ops.
  scoreAll(): RepairScore[] {
    const filtered = this.filterByStore(this.repairs);

    const repairsByCustomer = new Map<string, Repair[]>();
    for (const r of this.repairs) {
      const cid = r.customerId;
      if (!cid) continue;
      const arr = repairsByCustomer.get(cid);
      if (arr) arr.push(r);
      else repairsByCustomer.set(cid, [r]);
    }

    return filtered
      .map(r => this.calculateScore(r, r.customerId ? (repairsByCustomer.get(r.customerId) || []) : []))
      .sort((a, b) => b.score - a.score);
  }

  getUrgent(count: number = 10): RepairScore[] {
    return this.scoreAll().filter(s => s.grade === 'F' || s.grade === 'D').slice(0, count);
  }

  getInProgress(): RepairScore[] {
    const inProgressStatuses: RepairStatus[] = ['received', 'diagnosing', 'waiting_parts', 'in_progress'];
    return this.scoreAll().filter(s => {
      const repair = this.repairs.find(r => r.id === s.repairId);
      return repair && inProgressStatuses.includes(repair.status);
    });
  }

  getDistribution(): Record<RepairScore['grade'], number> {
    const all = this.scoreAll();
    const dist: Record<string, number> = {};
    for (const score of all) {
      dist[score.grade] = (dist[score.grade] || 0) + 1;
    }
    return dist as Record<RepairScore['grade'], number>;
  }
}