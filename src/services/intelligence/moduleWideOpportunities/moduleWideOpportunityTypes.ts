// R-INTELLIGENCE-MODULE-WIDE-ACTIONS-V1
// Types for cross-module actionable opportunity detection.
// Each ModuleOpportunity is deterministic — no invented numbers.

import type { Repair, Layaway, Customer, Sale, InventoryItem } from '@/store/types';

export type OpportunityModule = 'repairs' | 'inventory' | 'customers' | 'layaways' | 'approvals' | 'unlocks' | 'special_orders';
export type OpportunitySeverity = 'critical' | 'high' | 'medium' | 'low';
export type OpportunityConfidence = 'high' | 'medium' | 'low';

// R-INTELLIGENCE-EXECUTABLE-ACTIONS-V1
export type OpportunityActionType =
  | 'whatsapp_followup'
  | 'open_repair'
  | 'open_customer'
  | 'open_layaway'
  | 'queue_manager_review'
  | 'open_inventory'
  | 'open_unlock'
  | 'open_special_order'
  | 'callback_reminder';

export interface ExecutableOpportunityAction {
  actionType: OpportunityActionType;
  labelKey: string;
  entityId?: string;
  entityName?: string;
  customerId?: string;
  customerPhone?: string;
  customerName?: string;
  customMessage?: string;
}

export interface ModuleOpportunity {
  id: string;
  module: OpportunityModule;
  severity: OpportunitySeverity;
  titleKey: string;
  summaryKey: string;
  evidence: string[];
  recommendedAction: string;
  confidence: OpportunityConfidence;
  executableAction?: {
    type: string;
    payload: Record<string, unknown>;
  };
  // R-INTELLIGENCE-EXECUTABLE-ACTIONS-V1: typed executable actions per opportunity
  actions?: ExecutableOpportunityAction[];
  createdAt: number;
}

export interface ModuleWideContext {
  repairs: Repair[];
  inventory: InventoryItem[];
  customers: Customer[];
  sales: Sale[];
  layaways: Layaway[];
}
