import type { ReasoningInput, OperationalReasoningConclusion } from './reasoningTypes';

const now = () => Date.now();

function conclusion(
  type: OperationalReasoningConclusion['type'],
  title: string,
  evidence: string[],
  score: number,
  opts: Pick<OperationalReasoningConclusion, 'recommendedActions' | 'relatedModules' | 'suggestionKind'> & { basePriority: number; detail?: string },
): OperationalReasoningConclusion {
  return {
    id: type,
    type,
    title,
    detail: opts.detail ?? evidence.slice(0, 2).join(' · '),
    priority: score >= 4 ? Math.min(10, opts.basePriority + 1) : opts.basePriority,
    confidence: score >= 4 ? 'high' : 'medium',
    evidence,
    recommendedActions: opts.recommendedActions,
    relatedModules: opts.relatedModules,
    suggestionKind: opts.suggestionKind,
    generatedAt: now(),
  };
}

export function ruleCriticalCustomerRecovery(i: ReasoningInput): OperationalReasoningConclusion | null {
  const hasVip      = i.revenueOpportunityTypes.includes('vip_retention');
  const hasInactive = i.revenueOpportunityTypes.includes('inactive_customer_recovery');
  const hasSlowRhythm = ['slow_day', 'low_activity', 'opportunity_window'].includes(i.rhythmMode);
  const hasRecoveryTrend = ['opportunity_increasing', 'recovering'].includes(i.trendMode);
  const hasBalance  = i.revenueOpportunityTypes.includes('unpaid_balance_recovery');

  const conditions = [hasVip, hasInactive, hasSlowRhythm, hasRecoveryTrend, hasBalance];
  const score = conditions.filter(Boolean).length;
  if (score < 2) return null;

  const evidence: string[] = [];
  if (hasVip)           evidence.push('VIP customer at risk of inactivity');
  if (hasInactive)      evidence.push('Inactive customers with purchase history');
  if (hasBalance)       evidence.push('Outstanding balance on account');
  if (hasSlowRhythm)    evidence.push(`Store in ${i.rhythmMode.replace('_', ' ')} mode`);
  if (hasRecoveryTrend) evidence.push('Opportunity momentum rising');

  return conclusion('critical_customer_recovery', 'Critical VIP recovery opportunity', evidence, score, {
    basePriority: 9,
    recommendedActions: ['act_open_customers'],
    relatedModules: ['customers'],
    suggestionKind: 'retention',
  });
}

export function ruleOperationalOverload(i: ReasoningInput): OperationalReasoningConclusion | null {
  const hasRepairRhythm   = i.rhythmMode === 'repair_overload';
  const hasWorseningTrend = ['worsening', 'risk_increasing'].includes(i.trendMode);
  const hasOverdueRepairs = i.overdueRepairCount >= 3;
  const hasWorkflows      = i.signalIds.includes('op_unfinished_workflows');
  const hasMultiWorkflows = i.activeWorkflowCount > 1;

  const score = [hasRepairRhythm, hasWorseningTrend, hasOverdueRepairs, hasWorkflows, hasMultiWorkflows].filter(Boolean).length;
  if (score < 2) return null;

  const evidence: string[] = [];
  if (hasRepairRhythm)   evidence.push('Repair overload detected');
  if (hasWorseningTrend) evidence.push(`Trend: ${i.trendMode.replace('_', ' ')}`);
  if (hasOverdueRepairs) evidence.push(`${i.overdueRepairCount} delayed repairs`);
  if (hasWorkflows)      evidence.push('Unfinished workflows pending');
  if (hasMultiWorkflows) evidence.push(`${i.activeWorkflowCount} active workflows`);

  return conclusion('operational_overload', 'Operational pressure increasing', evidence, score, {
    basePriority: 8,
    recommendedActions: ['act_open_repairs'],
    relatedModules: ['repairs'],
    suggestionKind: 'operational',
  });
}

export function ruleCollectionEscalation(i: ReasoningInput): OperationalReasoningConclusion | null {
  const hasCollectionRhythm    = i.rhythmMode === 'collection_mode';
  const hasUnpaid              = i.revenueOpportunityTypes.includes('unpaid_balance_recovery');
  const hasAbandonedWorkflow   = i.revenueOpportunityTypes.includes('abandoned_workflow_recovery');
  const hasOverdueLayaways     = i.overdueLayawayCount >= 2;
  const isCollectionSlowing    = i.collectionMomentumScore < 40;

  const score = [hasCollectionRhythm, hasUnpaid, hasAbandonedWorkflow, hasOverdueLayaways, isCollectionSlowing].filter(Boolean).length;
  if (score < 2) return null;

  const evidence: string[] = [];
  if (hasCollectionRhythm)  evidence.push('Store in collection mode');
  if (hasUnpaid)            evidence.push('Unpaid balances outstanding');
  if (hasAbandonedWorkflow) evidence.push('Abandoned payment workflow');
  if (hasOverdueLayaways)   evidence.push(`${i.overdueLayawayCount} layaways overdue`);
  if (isCollectionSlowing)  evidence.push('Collection activity declining');

  return conclusion('collection_escalation', 'Collection recovery should be prioritized', evidence, score, {
    basePriority: 9,
    recommendedActions: ['act_open_repairs', 'act_open_layaways'],
    relatedModules: ['repairs', 'layaways'],
    suggestionKind: 'collect',
  });
}

export function ruleRevenueRecoveryWindow(i: ReasoningInput): OperationalReasoningConclusion | null {
  const hasRecoveryRhythm  = ['slow_day', 'opportunity_window', 'revenue_recovery'].includes(i.rhythmMode);
  const hasValueOpps       = i.revenueOpportunityTypes.some((t) =>
    t === 'vip_retention' || t === 'inactive_customer_recovery');
  const hasPositiveTrend   = ['opportunity_increasing', 'recovering'].includes(i.trendMode);
  const hasEnoughOpps      = i.revenueOpportunityCount >= 4;

  const score = [hasRecoveryRhythm, hasValueOpps, hasPositiveTrend, hasEnoughOpps].filter(Boolean).length;
  if (score < 2) return null;

  const evidence: string[] = [];
  if (hasRecoveryRhythm)  evidence.push(`Store in ${i.rhythmMode.replace(/_/g, ' ')} mode`);
  if (hasValueOpps)       evidence.push('High-value customer opportunities available');
  if (hasPositiveTrend)   evidence.push('Opportunity momentum rising');
  if (hasEnoughOpps)      evidence.push(`${i.revenueOpportunityCount} revenue opportunities pending`);

  return conclusion('revenue_recovery_window', 'Strong recovery opportunity available', evidence, score, {
    basePriority: 8,
    recommendedActions: ['act_open_customers', 'act_open_pos'],
    relatedModules: ['customers', 'pos'],
    suggestionKind: 'follow_up',
  });
}

export function ruleUpsellMomentum(i: ReasoningInput): OperationalReasoningConclusion | null {
  const isAccelerating     = ['accelerating', 'improving'].includes(i.trendMode);
  const hasAttachOpps      = i.revenueOpportunityTypes.includes('missed_accessory_attach');
  const hasAttachSignal    = i.signalIds.includes('op_accessory_attach_opportunity');
  const hasSalesMomentum   = i.salesMomentumScore > 65;

  const score = [isAccelerating, hasAttachOpps, hasAttachSignal, hasSalesMomentum].filter(Boolean).length;
  if (score < 2) return null;

  const evidence: string[] = [];
  if (isAccelerating)   evidence.push(`Momentum ${i.trendMode}`);
  if (hasSalesMomentum) evidence.push('Sales pace above recent average');
  if (hasAttachOpps)    evidence.push('Accessory attach opportunities missed');
  if (hasAttachSignal)  evidence.push('Accessory attach signal active');

  return conclusion('upsell_momentum', 'Upsell momentum opportunity', evidence, score, {
    basePriority: 7,
    recommendedActions: ['act_open_pos'],
    relatedModules: ['pos'],
    suggestionKind: 'upsell',
  });
}

export function ruleWorkflowStabilityRisk(i: ReasoningInput): OperationalReasoningConclusion | null {
  const hasActiveWorkflows   = i.activeWorkflowCount >= 1;
  const hasAbandonedOpps     = i.revenueOpportunityTypes.includes('abandoned_workflow_recovery');
  const hasWorkflowSignal    = i.signalIds.includes('op_unfinished_workflows');
  const isWorkflowAccumulating = i.workflowMomentumScore > 60;

  const score = [hasActiveWorkflows, hasAbandonedOpps, hasWorkflowSignal, isWorkflowAccumulating].filter(Boolean).length;
  if (score < 2) return null;

  const evidence: string[] = [];
  if (hasActiveWorkflows)      evidence.push(`${i.activeWorkflowCount} pending workflow${i.activeWorkflowCount > 1 ? 's' : ''}`);
  if (hasAbandonedOpps)        evidence.push('Abandoned workflow detected');
  if (hasWorkflowSignal)       evidence.push('Unfinished workflow signal active');
  if (isWorkflowAccumulating)  evidence.push('Workflow activity increasing');

  return conclusion('workflow_stability_risk', 'Workflow completion quality declining', evidence, score, {
    basePriority: 7,
    recommendedActions: ['act_open_phone_payments', 'act_open_repairs'],
    relatedModules: ['phone-payments', 'repairs'],
    suggestionKind: 'operational',
  });
}
