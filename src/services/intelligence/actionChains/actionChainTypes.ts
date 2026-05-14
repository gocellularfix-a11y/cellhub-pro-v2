export type ActionChainType =
  | 'collection_recovery'
  | 'vip_customer_recovery'
  | 'repair_cleanup'
  | 'workflow_stabilization'
  | 'upsell_momentum';

export type ActionChainStepStatus = 'pending' | 'active' | 'completed' | 'skipped';

export interface ActionChainStep {
  id: string;
  label: string;
  /** Maps to an OperatorExecutableAction.id in the action execution registry. */
  actionId: string;
  status: ActionChainStepStatus;
  optional: boolean;
  recommended: boolean;
  metadata?: Record<string, string>;
}

export interface ActionChain {
  id: string;
  type: ActionChainType;
  title: string;
  detail?: string;
  priority: number;
  confidence: 'high' | 'medium' | 'low';
  currentStepIndex: number;
  steps: ActionChainStep[];
  relatedCustomerId?: string;
  relatedWorkflowId?: string;
  generatedAt: number;
}

// Primitive-only input — avoids circular imports from employeeOpsTypes.
export interface ChainInput {
  strategyType: string;
  conclusionTypes: string[];
  rhythmMode: string;
  activeWorkflowCount: number;
  overdueRepairCount: number;
  overdueLayawayCount: number;
  readyForPickupCount: number;
  signalIds: string[];
}

// Persisted state in localStorage — step-level progression only.
export interface ActiveChainState {
  chainType: ActionChainType;
  completedStepIds: string[];
  skippedStepIds: string[];
  startedAt: number;
  expiresAt: number;
}
