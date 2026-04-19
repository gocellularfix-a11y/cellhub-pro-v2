// CellHub Intelligence — Repair Analyzer
import type { Repair, RepairStatus } from '@/store/types';
import { Insight, RepairMetrics } from '../types';
import { getDaysAgo } from '../utils/dateHelpers';

export class RepairAnalyzer {
  private repairs: Repair[];
  private storeId?: string;
  private lang: string;

  constructor(repairs: Repair[], storeId?: string, lang: string = 'en') {
    this.repairs = repairs;
    this.storeId = storeId;
    this.lang = lang;
  }

  filterByWindow(window: { start: Date; end: Date }): Repair[] {
    return this.repairs.filter(r => {
      const created = new Date(r.createdAt as string);
      return created >= window.start && created <= window.end;
    });
  }

  filterByStore(repairs: Repair[]): Repair[] {
    if (!this.storeId) return repairs;
    return repairs.filter(r => (r as any).storeId === this.storeId);
  }

  getMetrics(window?: { start: Date; end: Date }): RepairMetrics {
    const filtered = this.filterByStore(window ? this.filterByWindow(window) : this.repairs);
    const completed = filtered.filter(r => r.status === 'picked_up');
    const totalCompleted = completed.length;

    let totalTurnaround = 0;
    for (const repair of completed) {
      if (repair.completedAt) {
        const start = new Date(repair.createdAt as string).getTime();
        const end = new Date(repair.completedAt as string).getTime();
        totalTurnaround += (end - start) / (1000 * 60 * 60);
      }
    }
    const avgTurnaroundHours = totalCompleted > 0 ? totalTurnaround / totalCompleted : 0;

    const byType: Record<string, number> = {};
    for (const repair of filtered) {
      const issue = repair.issue?.toLowerCase() || 'unknown';
      let type = 'other';
      if (issue.includes('screen')) type = 'screen';
      else if (issue.includes('battery')) type = 'battery';
      else if (issue.includes('charge')) type = 'charging';
      else if (issue.includes('water') || issue.includes('liquid')) type = 'water_damage';
      else if (issue.includes('software') || issue.includes('update')) type = 'software';
      else if (issue.includes('speaker') || issue.includes('mic')) type = 'audio';
      else if (issue.includes('camera')) type = 'camera';
      byType[type] = (byType[type] || 0) + 1;
    }

    const cutoff = getDaysAgo(7);
    const overdue = filtered.filter(r => {
      if (r.status === 'picked_up' || r.status === 'cancelled') return false;
      const created = new Date(r.createdAt as string);
      return created < cutoff;
    });

    return {
      totalCompleted,
      avgTurnaroundHours,
      byType,
      overdueCount: overdue.length,
    };
  }

  getByStatus(): Record<RepairStatus, number> {
    const filtered = this.filterByStore(this.repairs);
    const byStatus: Record<string, number> = {};
    for (const repair of filtered) {
      const status = repair.status || 'received';
      byStatus[status] = (byStatus[status] || 0) + 1;
    }
    return byStatus as Record<RepairStatus, number>;
  }

  getTurnaroundTimeByType(): Record<string, number> {
    const completed = this.filterByStore(
      this.repairs.filter(r => r.status === 'picked_up' && r.completedAt)
    );
    const byType: Record<string, { total: number; count: number }> = {};

    for (const repair of completed) {
      const issue = repair.issue?.toLowerCase() || 'unknown';
      let type = 'other';
      if (issue.includes('screen')) type = 'screen';
      else if (issue.includes('battery')) type = 'battery';
      else if (issue.includes('charge')) type = 'charging';
      else if (issue.includes('water') || issue.includes('liquid')) type = 'water_damage';
      else if (issue.includes('software')) type = 'software';
      else if (issue.includes('speaker') || issue.includes('mic')) type = 'audio';
      else if (issue.includes('camera')) type = 'camera';

      if (!byType[type]) byType[type] = { total: 0, count: 0 };
      const start = new Date(repair.createdAt as string).getTime();
      const end = new Date(repair.completedAt as string).getTime();
      byType[type].total += (end - start) / (1000 * 60 * 60);
      byType[type].count += 1;
    }

    const result: Record<string, number> = {};
    for (const [type, data] of Object.entries(byType)) {
      result[type] = data.count > 0 ? data.total / data.count : 0;
    }
    return result;
  }

  getHighPriorityRepairs(): Repair[] {
    return this.filterByStore(
      this.repairs.filter(r => r.priority === 'high' || r.priority === 'urgent')
    );
  }

  generateInsights(window?: { start: Date; end: Date }): Insight[] {
    const insights: Insight[] = [];
    const metrics = this.getMetrics(window);

    if (metrics.overdueCount > 0) {
      insights.push({
        id: 'repair-overdue',
        category: 'repairs',
        severity: 'critical',
        title: 'Overdue Repairs',
        titleEs: 'Reparaciones Atrasadas',
        description: `${metrics.overdueCount} repairs are overdue (>7 days).`,
        descriptionEs: `${metrics.overdueCount} reparaciones están atrasadas (>7 días).`,
        metric: metrics.overdueCount,
        metricLabel: this.lang === 'es' ? 'Reparaciones atrasadas' : 'Overdue repairs',
        actionLabel: this.lang === 'es' ? 'Ver Reparaciones' : 'View Repairs',
        actionRoute: 'repairs',
        confidence: 0.95,
        generatedAt: new Date(),
        expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
      });
    }

    const highPriority = this.getHighPriorityRepairs();
    if (highPriority.length > 0) {
      insights.push({
        id: 'repair-high-priority',
        category: 'repairs',
        severity: 'warning',
        title: 'High Priority Repairs',
        titleEs: 'Reparaciones Prioritarias',
        description: `${highPriority.length} repairs marked high/urgent priority.`,
        descriptionEs: `${highPriority.length} reparaciones marcadas como alta/urgente.`,
        metric: highPriority.length,
        metricLabel: this.lang === 'es' ? 'Reparaciones prioritarias' : 'Priority repairs',
        actionLabel: this.lang === 'es' ? 'Ver Reparaciones' : 'View Repairs',
        actionRoute: 'repairs',
        confidence: 0.9,
        generatedAt: new Date(),
        expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
      });
    }

    if (metrics.avgTurnaroundHours > 48) {
      insights.push({
        id: 'repair-slow-turnaround',
        category: 'repairs',
        severity: 'info',
        title: 'Repair Turnaround Slow',
        titleEs: 'Reparaciones Lentas',
        description: `Average turnaround is ${Math.round(metrics.avgTurnaroundHours)} hours.`,
        descriptionEs: `El tiempo promedio es ${Math.round(metrics.avgTurnaroundHours)} horas.`,
        metric: metrics.avgTurnaroundHours,
        metricLabel: this.lang === 'es' ? 'Horas promedio' : 'Avg hours',
        confidence: 0.85,
        generatedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
    }

    const statusDist = this.getByStatus();
    const inProgress = (statusDist['in_progress'] || 0) + (statusDist['diagnosing'] || 0) + (statusDist['waiting_parts'] || 0);
    if (inProgress > 10) {
      insights.push({
        id: 'repair-workflow',
        category: 'repairs',
        severity: 'info',
        title: 'Active Repairs',
        titleEs: 'Reparaciones Activas',
        description: `${inProgress} repairs currently in progress.`,
        descriptionEs: `${inProgress} reparaciones actualmente en proceso.`,
        metric: inProgress,
        metricLabel: this.lang === 'es' ? 'En proceso' : 'In progress',
        actionLabel: this.lang === 'es' ? 'Ver Reparaciones' : 'View Repairs',
        actionRoute: 'repairs',
        confidence: 0.95,
        generatedAt: new Date(),
        expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
      });
    }

    return insights;
  }
}