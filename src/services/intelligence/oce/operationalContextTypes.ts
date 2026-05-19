// R-OCE-V1 — Operational Context Engine Foundation
// Shared types for the internal "brain bus" — normalized operational signals
// readable by all Intelligence consumers. Pure types, no logic.

export type OperationalModule =
  | 'pos'
  | 'customers'
  | 'repairs'
  | 'inventory'
  | 'phone_payments'
  | 'layaways'
  | 'special_orders'
  | 'unlocks'
  | 'appointments'
  | 'returns'
  | 'expenses'
  | 'approvals'
  | 'outreach'
  | 'reports'
  | 'tax'
  | 'companion'
  | 'intelligence';

export type OperationalSignalType =
  | 'repair_ready'
  | 'payment_due'
  | 'vip_customer'
  | 'inactive_customer'
  | 'inventory_risk'
  | 'dead_stock'
  | 'slow_day'
  | 'approval_needed'
  | 'outreach_opportunity'
  | 'outreach_underperforming'
  | 'sale_opportunity'
  | 'operational_warning'
  | 'appointment_risk'
  | 'margin_risk'
  | 'system_status';

export type OperationalSeverity =
  | 'critical'
  | 'high'
  | 'medium'
  | 'low';

export interface OperationalSignal {
  id: string;
  type: OperationalSignalType;
  sourceModule: OperationalModule;
  severity: OperationalSeverity;
  title: string;
  detail?: string;
  entityId?: string;
  entityType?: string;
  customerId?: string;
  createdAt: number;
  actionable: boolean;
  actionTarget?: string;
  score: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface OperationalContextSnapshot {
  generatedAt: number;
  signals: OperationalSignal[];
  modules: Partial<Record<OperationalModule, {
    available: boolean;
    signalCount: number;
    highestSeverity?: OperationalSeverity;
  }>>;
}
