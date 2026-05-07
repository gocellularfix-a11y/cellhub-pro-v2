// CellHub Intelligence — Alert Engine
import type { Alert, AlertConfig, AlertContext, AlertStatus, AlertSeverity } from './AlertTypes';
import {
  DEFAULT_ALERT_CONFIGS,
  DEFAULT_THRESHOLDS,
  shouldFireAlert,
  ThresholdSet,
} from './thresholds';
import type { Sale, InventoryItem, Repair, Customer } from '@/store/types';
import { getDaysAgo } from '../utils/dateHelpers';

interface AlertState {
  lastFired: Record<string, Date>;
  activeAlerts: Alert[];
}

export class AlertEngine {
  private configs: AlertConfig[];
  private thresholds: ThresholdSet;
  private state: AlertState;
  private lang: string;
  private storeId?: string;

  constructor(
    thresholds: ThresholdSet = DEFAULT_THRESHOLDS,
    lang: string = 'en',
    storeId?: string
  ) {
    this.configs = DEFAULT_ALERT_CONFIGS;
    this.thresholds = thresholds;
    this.lang = lang;
    this.storeId = storeId;
    this.state = {
      lastFired: {},
      activeAlerts: [],
    };
  }

  private filterByStore<T extends { storeId?: string }>(items: T[]): T[] {
    if (!this.storeId) return items;
    return items.filter(item => (item as any).storeId === this.storeId);
  }

  // R-INTEL-ALERT-ENGINE-FUSE-PASS: previous version did ~10 separate
  // collection scans (each `.filter()` re-parsing `new Date(...)` per item)
  // plus an O(C × S × log S) churnRisk scan that re-filtered every customer's
  // sales then sorted them. Fused into one pass per collection: every cutoff
  // is precomputed once outside the loops, every record's createdAt is parsed
  // once, and churnRisk uses a single sales sweep building a
  // Map<customerId, latestTimestamp> instead of filter+sort per customer.
  // Same return contract; same business logic; same alert outcomes — just
  // single-pass arithmetic.
  private buildContext(
    sales: Sale[],
    inventory: InventoryItem[],
    repairs: Repair[],
    customers: Customer[]
  ): AlertContext {
    // Hoist all cutoffs once.
    const cutoff1d = getDaysAgo(1).getTime();
    const cutoff2d = getDaysAgo(2).getTime();
    const cutoffDeadStock = getDaysAgo(this.thresholds.inventory.deadStockDays).getTime();
    const cutoffOverdue = getDaysAgo(this.thresholds.repairs.overdueDays).getTime();
    const cutoffNewCustomer = getDaysAgo(30).getTime();
    const cutoffInactive = getDaysAgo(this.thresholds.customers.inactivityDays).getTime();
    const lowStockMax = this.thresholds.inventory.lowStockDays * 2;
    const minLoyaltyPoints = this.thresholds.customers.minLoyaltyPoints;

    // Single sales pass: today + prev-day buckets + per-customer last-sale
    // index for churnRisk in one sweep.
    let todayRevenue = 0;
    let recentSalesCount = 0;
    let prevRevenue = 0;
    const lastSaleByCustomer = new Map<string, number>();
    for (const s of sales) {
      const ts = new Date(s.createdAt as string).getTime();
      if (ts >= cutoff1d) {
        todayRevenue += s.total || 0;
        recentSalesCount++;
      } else if (ts >= cutoff2d) {
        prevRevenue += s.total || 0;
      }
      const cid = s.customerId;
      if (cid) {
        const prior = lastSaleByCustomer.get(cid);
        if (prior === undefined || ts > prior) lastSaleByCustomer.set(cid, ts);
      }
    }
    const trend = prevRevenue > 0 ? ((todayRevenue - prevRevenue) / prevRevenue) * 100 : 0;

    // Single inventory pass: lowStockCount + deadStockCount.
    let lowStockCount = 0;
    let deadStockCount = 0;
    for (const i of inventory) {
      const qty = i.qty || 0;
      if (qty <= 0) continue;
      if (qty <= lowStockMax) lowStockCount++;
      const created = new Date(i.createdAt as string).getTime();
      if (created < cutoffDeadStock) deadStockCount++;
    }

    // Single repairs pass: pending + overdue + highPriority + recentRepairRevenue.
    let pendingCount = 0;
    let overdueCount = 0;
    let highPriorityCount = 0;
    let recentRepairRevenue = 0;
    for (const r of repairs) {
      const status = r.status;
      const isClosed = status === 'picked_up' || status === 'cancelled';
      if (!isClosed) pendingCount++;
      if (r.priority === 'high' || r.priority === 'urgent') highPriorityCount++;
      if (!isClosed) {
        const created = new Date(r.createdAt as string).getTime();
        if (created < cutoffOverdue) overdueCount++;
      }
      recentRepairRevenue += r.total || r.estimatedCost || 0;
    }

    // Single customers pass: newCustomers + churnRisk + vipCount.
    let newCustomerCount = 0;
    let churnRiskCount = 0;
    let vipCount = 0;
    for (const c of customers) {
      const created = new Date((c as { createdAt?: string }).createdAt as string).getTime();
      if (created >= cutoffNewCustomer) newCustomerCount++;
      const lastTs = lastSaleByCustomer.get(c.id);
      if (lastTs === undefined || lastTs < cutoffInactive) churnRiskCount++;
      if (c.loyaltyPoints >= minLoyaltyPoints) vipCount++;
    }

    const grossMargin = recentRepairRevenue > 0 ? 100 : 0; // recentCOGS = 0 → identical to prior result

    return {
      sales: {
        dailyRevenue: todayRevenue,
        transactionCount: recentSalesCount,
        avgTransactionSize: recentSalesCount > 0 ? todayRevenue / recentSalesCount : 0,
        trend,
      },
      inventory: {
        totalItems: inventory.length,
        lowStockCount,
        deadStockCount,
        reorderAlertCount: lowStockCount,
      },
      repairs: {
        pendingCount,
        overdueCount,
        highPriorityCount,
        avgTurnaroundHours: 24,
      },
      customers: {
        totalCustomers: customers.length,
        newCustomers: newCustomerCount,
        churnRiskCount,
        vipCount,
      },
      financial: {
        grossMargin,
        expenseRatio: 50,
        cashFlow: todayRevenue,
      },
      timestamp: new Date(),
    };
  }

  evaluate(
    sales: Sale[],
    inventory: InventoryItem[],
    repairs: Repair[],
    customers: Customer[]
  ): Alert[] {
    const context = this.buildContext(sales, inventory, repairs, customers);
    const newAlerts: Alert[] = [];

    const salesConfig = this.configs.find(c => c.id === 'alert-sales-revenue-drop');
    if (salesConfig) {
      const lastFired = this.state.lastFired[salesConfig.id];
      if (shouldFireAlert(salesConfig, context.sales.trend, lastFired)) {
        newAlerts.push(this.createAlert(salesConfig, context.sales.trend, context.sales.dailyRevenue));
        this.state.lastFired[salesConfig.id] = new Date();
      }
    }

    const inventoryConfigs = this.configs.filter(c => c.category === 'inventory');
    for (const config of inventoryConfigs) {
      const lastFired = this.state.lastFired[config.id];
      let value = 0;
      if (config.id === 'alert-inventory-low-stock') value = context.inventory.lowStockCount;
      else if (config.id === 'alert-inventory-dead-stock') value = context.inventory.deadStockCount;
      else if (config.id === 'alert-inventory-overstock') value = context.inventory.deadStockCount;

      if (shouldFireAlert(config, value, lastFired)) {
        newAlerts.push(this.createAlert(config, value));
        this.state.lastFired[config.id] = new Date();
      }
    }

    const repairConfigs = this.configs.filter(c => c.category === 'repairs');
    for (const config of repairConfigs) {
      const lastFired = this.state.lastFired[config.id];
      let value = 0;
      if (config.id === 'alert-repair-overdue') value = context.repairs.overdueCount;
      else if (config.id === 'alert-repair-slow') value = context.repairs.avgTurnaroundHours;
      else if (config.id === 'alert-repair-workflow') value = context.repairs.pendingCount;

      if (shouldFireAlert(config, value, lastFired)) {
        newAlerts.push(this.createAlert(config, value));
        this.state.lastFired[config.id] = new Date();
      }
    }

    const customerConfigs = this.configs.filter(c => c.category === 'customers');
    for (const config of customerConfigs) {
      const lastFired = this.state.lastFired[config.id];
      if (shouldFireAlert(config, context.customers.churnRiskCount, lastFired)) {
        newAlerts.push(this.createAlert(config, context.customers.churnRiskCount));
        this.state.lastFired[config.id] = new Date();
      }
    }

    const financialConfigs = this.configs.filter(c => c.category === 'financial');
    for (const config of financialConfigs) {
      const lastFired = this.state.lastFired[config.id];
      let value = 0;
      if (config.id === 'alert-financial-margin') value = context.financial.grossMargin;
      else if (config.id === 'alert-financial-expense') value = context.financial.expenseRatio;

      if (shouldFireAlert(config, value, lastFired)) {
        newAlerts.push(this.createAlert(config, value));
        this.state.lastFired[config.id] = new Date();
      }
    }

    return newAlerts;
  }

  private createAlert(config: AlertConfig, metric: number, threshold?: number): Alert {
    return {
      id: `${config.id}-${Date.now()}`,
      configId: config.id,
      category: config.category,
      severity: config.severity,
      title: config.name,
      titleEs: config.nameEs,
      description: config.description,
      descriptionEs: config.descriptionEs,
      metric,
      threshold: threshold ?? config.threshold,
      triggerType: 'threshold',
      status: 'active',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    };
  }

  acknowledge(alertId: string, userId: string): void {
    const alert = this.state.activeAlerts.find(a => a.id === alertId);
    if (alert) {
      alert.status = 'acknowledged';
      alert.acknowledgedBy = userId;
      alert.acknowledgedAt = new Date();
    }
  }

  resolve(alertId: string, userId: string): void {
    const alert = this.state.activeAlerts.find(a => a.id === alertId);
    if (alert) {
      alert.status = 'resolved';
      alert.resolvedBy = userId;
      alert.resolvedAt = new Date();
    }
  }

  dismiss(alertId: string): void {
    const alert = this.state.activeAlerts.find(a => a.id === alertId);
    if (alert) {
      alert.status = 'dismissed';
    }
  }

  getActiveAlerts(): Alert[] {
    return this.state.activeAlerts.filter(a => a.status === 'active');
  }

  getAlertsByStatus(status: AlertStatus): Alert[] {
    return this.state.activeAlerts.filter(a => a.status === status);
  }

  getAlertsByCategory(category: Alert['category']): Alert[] {
    return this.state.activeAlerts.filter(a => a.category === category);
  }

  clearExpired(): void {
    const now = Date.now();
    this.state.activeAlerts = this.state.activeAlerts.filter(
      a => a.status !== 'resolved' && a.status !== 'dismissed' && a.expiresAt.getTime() > now
    );
  }
}