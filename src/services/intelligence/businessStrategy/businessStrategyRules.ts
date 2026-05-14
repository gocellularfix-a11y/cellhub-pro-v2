import type { BusinessStrategyFocus, StrategyInput, StrategyType } from './businessStrategyTypes';

function strategy(
  type: StrategyType,
  title: string,
  detail: string,
  basePriority: number,
  score: number,
  suggestionKind: BusinessStrategyFocus['suggestionKind'],
  now: number,
): BusinessStrategyFocus {
  const confidence = score >= 4 ? 'high' : score >= 3 ? 'medium' : 'low';
  return { type, title, detail, priority: basePriority, confidence, suggestionKind, generatedAt: now };
}

export function ruleWorkflowStabilization(input: StrategyInput, now: number): BusinessStrategyFocus | null {
  let score = 0;
  if (input.activeWorkflowCount >= 2) score++;
  if (input.activeWorkflowCount >= 3) score++;
  if (input.workflowMomentumScore < 40) score++;
  if (input.conclusionTypes.includes('workflow_stability_risk')) score++;
  if (input.signalIds.includes('op_unfinished_workflows')) score++;
  if (score < 2) return null;
  return strategy('workflow_stabilization_focus', 'Stabilize pending workflows', 'Multiple workflows need attention', 10, score, 'operational', now);
}

export function ruleCollectionFocus(input: StrategyInput, now: number): BusinessStrategyFocus | null {
  let score = 0;
  if (input.overdueLayawayCount >= 2) score++;
  if (input.overdueLayawayCount >= 4) score++;
  if (input.collectionMomentumScore < 45) score++;
  if (input.rhythmMode === 'collection_mode') score++;
  if (input.conclusionTypes.includes('collection_escalation')) score++;
  if (score < 2) return null;
  return strategy('collection_focus', 'Recover unpaid balances now', 'Overdue layaway accounts need follow-up', 9, score, 'collect', now);
}

export function ruleRepairCleanupFocus(input: StrategyInput, now: number): BusinessStrategyFocus | null {
  let score = 0;
  if (input.overdueRepairCount >= 2) score++;
  if (input.overdueRepairCount >= 5) score++;
  if (input.rhythmMode === 'repair_overload') score++;
  if (input.conclusionTypes.includes('operational_overload')) score++;
  if (input.trendMode === 'risk_increasing') score++;
  if (score < 2) return null;
  return strategy('repair_cleanup_focus', 'Clear repair backlog', 'Overdue repairs need resolution', 8, score, 'operational', now);
}

export function ruleRecoveryFocus(input: StrategyInput, now: number): BusinessStrategyFocus | null {
  let score = 0;
  if (input.salesMomentumScore < 40) score++;
  if (input.rhythmMode === 'slow_day' || input.rhythmMode === 'low_activity') score++;
  if (input.trendMode === 'worsening') score++;
  if (input.conclusionTypes.includes('critical_customer_recovery')) score++;
  if (score < 2) return null;
  return strategy('recovery_focus', 'Focus on customer recovery', 'Sales slowing — reactivate customers', 7, score, 'retention', now);
}

export function ruleCustomerRetentionFocus(input: StrategyInput, now: number): BusinessStrategyFocus | null {
  let score = 0;
  if (input.conclusionTypes.includes('critical_customer_recovery')) score++;
  if (input.trendMode === 'recovering') score++;
  if (input.rhythmMode === 'revenue_recovery') score++;
  if (input.salesMomentumScore >= 45 && input.salesMomentumScore < 65) score++;
  if (score < 2) return null;
  return strategy('customer_retention_focus', 'Protect high-value customers', 'Recovery phase — retain key accounts', 6, score, 'retention', now);
}

export function ruleUpsellFocus(input: StrategyInput, now: number): BusinessStrategyFocus | null {
  let score = 0;
  if (input.rhythmMode === 'opportunity_window') score++;
  if (input.salesMomentumScore >= 65) score++;
  if (input.conclusionTypes.includes('upsell_momentum')) score++;
  if (input.trendMode === 'accelerating' || input.trendMode === 'opportunity_increasing') score++;
  if (input.revenueOpportunityCount >= 2) score++;
  if (score < 2) return null;
  return strategy('upsell_focus', 'Push accessory opportunities', 'Strong sales momentum — upsell now', 5, score, 'upsell', now);
}
