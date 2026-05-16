// R-INTELLIGENCE-LIVE-OPERATING-ASSISTANT-V1

export type LiveAssistTrigger =
  | 'critical_queue'
  | 'stalled_workflow'
  | 'execution_ready'
  | 'trend_warning'
  | 'idle_window'
  | 'morning_open';

export type LiveAssistActionType =
  | 'open_intelligence'
  | 'open_manager_queue'
  | 'open_execution_queue'
  | 'open_morning_digest'
  | 'open_entity';

export interface LiveAssistAction {
  type: LiveAssistActionType;
  entityType?: string;
  entityId?: string;
}

export interface LiveAssistSuggestion {
  id: string;
  trigger: LiveAssistTrigger;
  priority: 'critical' | 'high' | 'medium';
  headline: string;
  subline?: string;
  action: LiveAssistAction;
  createdAt: number;
}

export interface LiveAssistContext {
  idleMs: number;
  modalOpen: boolean;
  isFirstOpenToday: boolean;
}
