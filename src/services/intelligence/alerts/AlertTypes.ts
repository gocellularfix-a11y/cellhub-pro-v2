// CellHub Intelligence — Alert Types
export type AlertSeverity = 'critical' | 'warning' | 'info' | 'opportunity';
export type AlertCategory = 'sales' | 'inventory' | 'repairs' | 'customers' | 'financial' | 'system';
export type AlertStatus = 'active' | 'acknowledged' | 'resolved' | 'dismissed';
export type AlertTriggerType = 'threshold' | 'anomaly' | 'prediction' | 'manual';

export interface AlertConfig {
  id: string;
  name: string;
  nameEs: string;
  description: string;
  descriptionEs: string;
  category: AlertCategory;
  severity: AlertSeverity;
  enabled: boolean;
  threshold?: number;
  thresholdOperator?: 'gt' | 'lt' | 'eq' | 'gte' | 'lte';
  cooldownMinutes: number;
  notifyOn: AlertSeverity[];
}

export interface Alert {
  id: string;
  configId: string;
  category: AlertCategory;
  severity: AlertSeverity;
  title: string;
  titleEs: string;
  description: string;
  descriptionEs: string;
  metric?: number;
  threshold?: number;
  triggerType: AlertTriggerType;
  status: AlertStatus;
  acknowledgedBy?: string;
  acknowledgedAt?: Date;
  resolvedBy?: string;
  resolvedAt?: Date;
  createdAt: Date;
  expiresAt: Date;
  metadata?: Record<string, any>;
}

export interface AlertRule {
  id: string;
  name: string;
  nameEs: string;
  category: AlertCategory;
  evaluate: (context: AlertContext) => Alert | null;
}

export interface AlertContext {
  sales: {
    dailyRevenue: number;
    transactionCount: number;
    avgTransactionSize: number;
    trend: number;
  };
  inventory: {
    totalItems: number;
    lowStockCount: number;
    deadStockCount: number;
    reorderAlertCount: number;
  };
  repairs: {
    pendingCount: number;
    overdueCount: number;
    highPriorityCount: number;
    avgTurnaroundHours: number;
  };
  customers: {
    totalCustomers: number;
    newCustomers: number;
    churnRiskCount: number;
    vipCount: number;
  };
  financial: {
    grossMargin: number;
    expenseRatio: number;
    cashFlow: number;
  };
  timestamp: Date;
}