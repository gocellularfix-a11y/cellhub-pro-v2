import type { ActionChain, ActionChainStep, ChainInput } from './actionChainTypes';

function s(
  id: string,
  label: string,
  actionId: string,
  optional = false,
  recommended = true,
): ActionChainStep {
  return { id, label, actionId, status: 'pending', optional, recommended };
}

function chain(
  type: ActionChain['type'],
  title: string,
  detail: string,
  priority: number,
  confidence: ActionChain['confidence'],
  steps: ActionChainStep[],
  now: number,
): ActionChain {
  return { id: `chain_${type}`, type, title, detail, priority, confidence, currentStepIndex: 0, steps, generatedAt: now };
}

export function ruleWorkflowStabilization(input: ChainInput, now: number): ActionChain | null {
  const fires = input.strategyType === 'workflow_stabilization_focus' || input.activeWorkflowCount >= 2;
  if (!fires) return null;
  const confidence = input.activeWorkflowCount >= 3 || input.conclusionTypes.includes('workflow_stability_risk') ? 'high' : 'medium';
  return chain('workflow_stabilization', 'Stabilize Pending Workflows', 'Unfinished payment flows need resolution', 10, confidence, [
    s('resume_payment',    'Resume pending payment flow',  'act_resume_external_payment'),
    s('open_payments',     'Open payment flows queue',     'act_open_phone_payments'),
    s('review_repairs',    'Review repair queue',          'act_open_repairs',    true, false),
  ], now);
}

export function ruleCollectionRecovery(input: ChainInput, now: number): ActionChain | null {
  const fires = input.strategyType === 'collection_focus'
    || input.conclusionTypes.includes('collection_escalation')
    || input.overdueLayawayCount >= 3;
  if (!fires) return null;
  const confidence = input.overdueLayawayCount >= 4 || input.conclusionTypes.includes('collection_escalation') ? 'high' : 'medium';
  return chain('collection_recovery', 'Collection Recovery', 'Recover unpaid balances now', 9, confidence, [
    s('open_repairs',      'Open repairs with balances',   'act_open_repairs'),
    s('check_layaways',    'Check overdue layaways',        'act_open_layaways'),
    s('resume_payment',    'Resume pending payment flows',  'act_resume_external_payment', true, false),
    s('follow_up',         'Prepare customer follow-up',   'act_open_customers',          true, false),
  ], now);
}

export function ruleRepairCleanup(input: ChainInput, now: number): ActionChain | null {
  const fires = input.strategyType === 'repair_cleanup_focus'
    || input.overdueRepairCount >= 3
    || input.readyForPickupCount >= 3;
  if (!fires) return null;
  const confidence = input.overdueRepairCount >= 5 || input.conclusionTypes.includes('operational_overload') ? 'high' : 'medium';
  return chain('repair_cleanup', 'Repair Cleanup', 'Clear the repair backlog', 8, confidence, [
    s('open_repairs',      'Open repair queue',            'act_open_repairs'),
    s('check_balances',    'Review repair balances',       'act_open_layaways',   true, false),
    s('notify_customers',  'Notify pickup customers',      'act_open_customers',  true, false),
  ], now);
}

export function ruleVipCustomerRecovery(input: ChainInput, now: number): ActionChain | null {
  const fires = input.strategyType === 'customer_retention_focus'
    || input.strategyType === 'recovery_focus'
    || input.conclusionTypes.includes('critical_customer_recovery');
  if (!fires) return null;
  const confidence = input.conclusionTypes.includes('critical_customer_recovery') ? 'high' : 'medium';
  return chain('vip_customer_recovery', 'Customer Recovery', 'Re-engage high-value customers', 7, confidence, [
    s('open_customers',    'Open customer list',           'act_open_customers'),
    s('view_history',      'Review customer history',      'act_view_history',    true, false),
    s('whatsapp_follow_up','Send follow-up message',       'act_whatsapp_follow_up', true, false),
  ], now);
}

export function ruleUpsellMomentum(input: ChainInput, now: number): ActionChain | null {
  const fires = input.strategyType === 'upsell_focus'
    || input.conclusionTypes.includes('upsell_momentum')
    || input.rhythmMode === 'opportunity_window';
  if (!fires) return null;
  const confidence = input.conclusionTypes.includes('upsell_momentum') ? 'high' : 'medium';
  return chain('upsell_momentum', 'Upsell Momentum', 'Push accessory opportunities now', 5, confidence, [
    s('open_pos',          'Open POS for accessories',     'act_open_pos'),
    s('review_customers',  'Review customer opportunities','act_open_customers',  true, false),
  ], now);
}
