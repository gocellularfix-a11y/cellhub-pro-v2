// CellHub Intelligence — Alert Thresholds
import type { AlertConfig, AlertSeverity } from './AlertTypes';

export interface ThresholdSet {
  sales: {
    dailyRevenueDropPercent: number;
    dailyRevenueIncreasePercent: number;
    transactionCountMin: number;
    avgTransactionSizeMin: number;
  };
  inventory: {
    lowStockDays: number;
    deadStockDays: number;
    reorderPointDays: number;
    overstockDays: number;
    imeiAgingDays: number;
  };
  repairs: {
    overdueDays: number;
    turnaroundHoursMax: number;
    pendingCountMax: number;
  };
  customers: {
    inactivityDays: number;
    minLoyaltyPoints: number;
  };
  financial: {
    grossMarginMinPercent: number;
    expenseRatioMaxPercent: number;
    dailyCashFlowMin: number;
  };
}

export const DEFAULT_THRESHOLDS: ThresholdSet = {
  sales: {
    dailyRevenueDropPercent: -15,
    dailyRevenueIncreasePercent: 20,
    transactionCountMin: 5,
    avgTransactionSizeMin: 1000,
  },
  inventory: {
    lowStockDays: 7,
    deadStockDays: 60,
    reorderPointDays: 7,
    overstockDays: 90,
    imeiAgingDays: 45,
  },
  repairs: {
    overdueDays: 7,
    turnaroundHoursMax: 48,
    pendingCountMax: 15,
  },
  customers: {
    inactivityDays: 90,
    minLoyaltyPoints: 500,
  },
  financial: {
    grossMarginMinPercent: 20,
    expenseRatioMaxPercent: 80,
    dailyCashFlowMin: 0,
  },
};

export const DEFAULT_ALERT_CONFIGS: AlertConfig[] = [
  {
    id: 'alert-sales-revenue-drop',
    name: 'Revenue Drop Alert',
    nameEs: 'Alerta de Caída de Ingresos',
    description: 'Daily revenue dropped significantly',
    descriptionEs: 'Los ingresos diarios cayeron significativamente',
    category: 'sales',
    severity: 'critical',
    enabled: true,
    threshold: -15,
    thresholdOperator: 'lt',
    cooldownMinutes: 60,
    notifyOn: ['critical', 'warning'],
  },
  {
    id: 'alert-sales-revenue-surge',
    name: 'Revenue Surge',
    nameEs: 'Aumento de Ingresos',
    description: 'Daily revenue exceeded expectations',
    descriptionEs: 'Los ingresos diarios excedieron expectativas',
    category: 'sales',
    severity: 'info',
    enabled: true,
    threshold: 20,
    thresholdOperator: 'gt',
    cooldownMinutes: 240,
    notifyOn: ['info'],
  },
  {
    id: 'alert-inventory-low-stock',
    name: 'Low Stock Alert',
    nameEs: 'Alerta de Stock Bajo',
    description: 'Items running low on inventory',
    descriptionEs: 'Artículos con inventario bajo',
    category: 'inventory',
    severity: 'warning',
    enabled: true,
    threshold: 7,
    thresholdOperator: 'lte',
    cooldownMinutes: 120,
    notifyOn: ['warning', 'critical'],
  },
  {
    id: 'alert-inventory-dead-stock',
    name: 'Dead Stock Alert',
    nameEs: 'Alerta de Stock Muerto',
    description: 'Items with no sales in 60+ days',
    descriptionEs: 'Artículos sin ventas en 60+ días',
    category: 'inventory',
    severity: 'warning',
    enabled: true,
    threshold: 3,
    thresholdOperator: 'gte',
    cooldownMinutes: 1440,
    notifyOn: ['warning'],
  },
  {
    id: 'alert-inventory-overstock',
    name: 'Overstock Alert',
    nameEs: 'Alerta de Excedente',
    description: 'Items with excess inventory',
    descriptionEs: 'Artículos con inventario excesivo',
    category: 'inventory',
    severity: 'info',
    enabled: true,
    threshold: 5,
    thresholdOperator: 'gte',
    cooldownMinutes: 1440,
    notifyOn: ['info'],
  },
  {
    id: 'alert-repair-overdue',
    name: 'Overdue Repairs',
    nameEs: 'Reparaciones Atrasadas',
    description: 'Repairs overdue by 7+ days',
    descriptionEs: 'Reparaciones atrasadas 7+ días',
    category: 'repairs',
    severity: 'critical',
    enabled: true,
    threshold: 1,
    thresholdOperator: 'gte',
    cooldownMinutes: 30,
    notifyOn: ['critical', 'warning'],
  },
  {
    id: 'alert-repair-slow',
    name: 'Slow Turnaround',
    nameEs: 'Tiempo Lentoo',
    description: 'Repair turnaround exceeds 48 hours',
    descriptionEs: 'Tiempo de reparación excede 48 horas',
    category: 'repairs',
    severity: 'warning',
    enabled: true,
    threshold: 48,
    thresholdOperator: 'gt',
    cooldownMinutes: 240,
    notifyOn: ['warning'],
  },
  {
    id: 'alert-repair-workflow',
    name: 'Repair Workflow Congestion',
    nameEs: 'Congestionamiento de Reparaciones',
    description: 'Too many repairs in progress',
    descriptionEs: 'Demasiadas reparaciones en proceso',
    category: 'repairs',
    severity: 'warning',
    enabled: true,
    threshold: 15,
    thresholdOperator: 'gt',
    cooldownMinutes: 60,
    notifyOn: ['warning'],
  },
  {
    id: 'alert-customer-churn',
    name: 'Churn Risk',
    nameEs: 'Riesgo de Cancelación',
    description: 'Customers at risk of churning',
    descriptionEs: 'Clientes en riesgo de cancelacion',
    category: 'customers',
    severity: 'warning',
    enabled: true,
    threshold: 5,
    thresholdOperator: 'gte',
    cooldownMinutes: 1440,
    notifyOn: ['warning'],
  },
  {
    id: 'alert-financial-margin',
    name: 'Low Margin',
    nameEs: 'Margen Bajo',
    description: 'Gross margin below 20%',
    descriptionEs: 'Margen bruto por debajo de 20%',
    category: 'financial',
    severity: 'critical',
    enabled: true,
    threshold: 20,
    thresholdOperator: 'lt',
    cooldownMinutes: 240,
    notifyOn: ['critical', 'warning'],
  },
  {
    id: 'alert-financial-expense',
    name: 'High Expenses',
    nameEs: 'Gastos Altos',
    description: 'Expense ratio above 80%',
    descriptionEs: 'Ratio de gastos acima de 80%',
    category: 'financial',
    severity: 'warning',
    enabled: true,
    threshold: 80,
    thresholdOperator: 'gt',
    cooldownMinutes: 240,
    notifyOn: ['warning'],
  },
];

function applyThreshold(value: number, operator: string, threshold: number): boolean {
  switch (operator) {
    case 'gt': return value > threshold;
    case 'lt': return value < threshold;
    case 'eq': return value === threshold;
    case 'gte': return value >= threshold;
    case 'lte': return value <= threshold;
    default: return false;
  }
}

export function shouldFireAlert(
  config: AlertConfig,
  currentValue: number,
  lastFired?: Date
): boolean {
  if (!config.enabled) return false;
  if (!config.threshold) return false;
  if (!applyThreshold(currentValue, config.thresholdOperator || 'gt', config.threshold)) return false;
  
  if (lastFired) {
    const cooldownMs = config.cooldownMinutes * 60 * 1000;
    if (Date.now() - lastFired.getTime() < cooldownMs) return false;
  }
  
  return true;
}

export function getAlertConfigsByCategory(
  category: AlertConfig['category']
): AlertConfig[] {
  return DEFAULT_ALERT_CONFIGS.filter(c => c.category === category);
}

export function getAlertConfigsBySeverity(
  severity: AlertSeverity
): AlertConfig[] {
  return DEFAULT_ALERT_CONFIGS.filter(c => c.notifyOn.includes(severity));
}