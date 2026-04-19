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

  private buildContext(
    sales: Sale[],
    inventory: InventoryItem[],
    repairs: Repair[],
    customers: Customer[]
  ): AlertContext {
    const recentSales = sales.filter(s => {
      const created = new Date(s.createdAt as string);
      return created >= getDaysAgo(1);
    });
    const prevSales = sales.filter(s => {
      const created = new Date(s.createdAt as string);
      return created >= getDaysAgo(2) && created < getDaysAgo(1);
    });

    const todayRevenue = recentSales.reduce((sum, s) => sum + (s.total || 0), 0);
    const prevRevenue = prevSales.reduce((sum, s) => sum + (s.total || 0), 0);
    const trend = prevRevenue > 0 ? ((todayRevenue - prevRevenue) / prevRevenue) * 100 : 0;

    const lowStock = inventory.filter(i => {
      if ((i.qty || 0) <= 0) return false;
      return (i.qty || 0) <= this.thresholds.inventory.lowStockDays * 2;
    });

    const deadStock = inventory.filter(i => {
      if ((i.qty || 0) <= 0) return false;
      const created = new Date(i.createdAt as string);
      return created < getDaysAgo(this.thresholds.inventory.deadStockDays);
    });

    const cutoff = getDaysAgo(this.thresholds.repairs.overdueDays);
    const overdue = repairs.filter(r => {
      if (r.status === 'picked_up' || r.status === 'cancelled') return false;
      const created = new Date(r.createdAt as string);
      return created < cutoff;
    });

    const highPriority = repairs.filter(
      r => r.priority === 'high' || r.priority === 'urgent'
    );

    const inactiveCustomerCutoff = getDaysAgo(this.thresholds.customers.inactivityDays);
    const churnRisk = customers.filter(c => {
      const lastSale = sales
        .filter(s => s.customerId === c.id)
        .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime())[0];
      if (!lastSale) return true;
      return new Date(lastSale.createdAt as string) < inactiveCustomerCutoff;
    });

    const recentRepairRevenue = repairs.reduce((sum, r) => sum + (r.total || r.estimatedCost || 0), 0);
    const recentCOGS = 0;
    const grossMargin = recentRepairRevenue > 0
      ? ((recentRepairRevenue - recentCOGS) / recentRepairRevenue) * 100
      : 0;

    return {
      sales: {
        dailyRevenue: todayRevenue,
        transactionCount: recentSales.length,
        avgTransactionSize: recentSales.length > 0 ? todayRevenue / recentSales.length : 0,
        trend,
      },
      inventory: {
        totalItems: inventory.length,
        lowStockCount: lowStock.length,
        deadStockCount: deadStock.length,
        reorderAlertCount: lowStock.length,
      },
      repairs: {
        pendingCount: repairs.filter(r => r.status !== 'picked_up' && r.status !== 'cancelled').length,
        overdueCount: overdue.length,
        highPriorityCount: highPriority.length,
        avgTurnaroundHours: 24,
      },
      customers: {
        totalCustomers: customers.length,
        newCustomers: customers.filter(c => {
          const created = new Date((c as any).createdAt as string);
          return created >= getDaysAgo(30);
        }).length,
        churnRiskCount: churnRisk.length,
        vipCount: customers.filter(c => c.loyaltyPoints >= this.thresholds.customers.minLoyaltyPoints).length,
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