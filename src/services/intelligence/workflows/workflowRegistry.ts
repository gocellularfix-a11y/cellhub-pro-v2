// INTELLIGENCE-OPERATIONAL-WORKFLOW-SESSIONS-V1
// Workflow definitions — ordered steps per type, entity constraints, TTL.
// Deterministic: no AI, no I/O.

import type { WorkflowStepKind, OperationalWorkflowType } from './types';
import type { EntityKind } from '../entityAccess/types';

export interface WorkflowDefinition {
  type: OperationalWorkflowType;
  steps: WorkflowStepKind[];
  labelEn: string;
  labelEs: string;
  requiredEntityKinds: EntityKind[];
  ttlMs: number;
}

export const PAYMENT_COLLECTION_WORKFLOW: WorkflowDefinition = {
  type: 'payment_collection',
  steps: ['detect_entity', 'confirm_amount', 'navigate_to_entity', 'complete'],
  labelEn: 'Payment Collection',
  labelEs: 'Cobro de Pago',
  requiredEntityKinds: ['customer', 'repair', 'layaway'],
  ttlMs: 10 * 60_000,
};

export const REPAIR_FOLLOWUP_WORKFLOW: WorkflowDefinition = {
  type: 'repair_followup',
  steps: ['detect_entity', 'navigate_to_entity', 'send_message', 'complete'],
  labelEn: 'Repair Follow-up',
  labelEs: 'Seguimiento de Reparación',
  requiredEntityKinds: ['repair'],
  ttlMs: 10 * 60_000,
};

export const CUSTOMER_OUTREACH_WORKFLOW: WorkflowDefinition = {
  type: 'customer_outreach',
  steps: ['detect_entity', 'navigate_to_entity', 'send_message', 'complete'],
  labelEn: 'Customer Outreach',
  labelEs: 'Contacto a Cliente',
  requiredEntityKinds: ['customer'],
  ttlMs: 10 * 60_000,
};

export const INVENTORY_PROMOTION_WORKFLOW: WorkflowDefinition = {
  type: 'inventory_promotion',
  steps: ['detect_entity', 'navigate_to_entity', 'confirm_action', 'complete'],
  labelEn: 'Inventory Promotion',
  labelEs: 'Promoción de Inventario',
  requiredEntityKinds: ['inventory_product'],
  ttlMs: 10 * 60_000,
};

export const WORKFLOW_REGISTRY: Record<OperationalWorkflowType, WorkflowDefinition> = {
  payment_collection:  PAYMENT_COLLECTION_WORKFLOW,
  repair_followup:     REPAIR_FOLLOWUP_WORKFLOW,
  customer_outreach:   CUSTOMER_OUTREACH_WORKFLOW,
  inventory_promotion: INVENTORY_PROMOTION_WORKFLOW,
};

export function getWorkflowDefinition(type: OperationalWorkflowType): WorkflowDefinition {
  return WORKFLOW_REGISTRY[type];
}
