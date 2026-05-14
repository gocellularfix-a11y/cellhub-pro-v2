// CellHub Intelligence — Action Execution Types
// Bubble-level executable action model. Distinct from the outreach/WhatsApp
// action queue (intelligence/actions.ts) — that system is for async messaging.
// This system handles synchronous navigation + workflow hand-offs in the bubble overlay.

import type { Customer, Repair, Layaway } from '@/store/types';
import type { CustomerBusinessProfile } from '@/services/intelligence/customerScoring/customerScoringTypes';

export type ActionCategory = 'customer' | 'payments' | 'repairs' | 'inventory' | 'operational';

/** safe = no confirmation needed. confirm/sensitive reserved for future write-path actions. */
export type SafetyLevel = 'safe' | 'confirm' | 'sensitive';

/**
 * Runtime context threaded into every action's canExecute / execute calls.
 * Built once per render cycle (useMemo) and passed down — actions never
 * capture stale closure values because they receive this ref fresh each call.
 */
export interface ActionExecutionContext {
  dispatch: (action: { type: string; payload?: unknown }) => void;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  repairs: Repair[];
  layaways: Layaway[];
  customers: Customer[];
  profile: CustomerBusinessProfile | null;
}

/**
 * A single executable action derived from a context suggestion.
 * Actions must be side-effect-free in canExecute and never mutate
 * financial state in execute.
 */
export interface OperatorExecutableAction {
  id: string;
  /** Short display label for the action pill button. Aim for ≤ 14 chars. */
  label: string;
  description?: string;
  priority: number;
  category: ActionCategory;
  safetyLevel: SafetyLevel;
  canExecute(ctx: ActionExecutionContext): boolean;
  execute(ctx: ActionExecutionContext): void;
}
