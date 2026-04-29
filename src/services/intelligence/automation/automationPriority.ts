// R-INTEL-PHASE4.6-PRIORITY: Smart Automation Prioritization Engine
// Pure scoring function — no side effects, no state, no execution.
import type { AutomationQueueItem } from './automationQueue';

export interface AutomationPriorityResult {
  itemId: string;
  score: number;
  reasons: string[];
}

const KIND_BASE: Record<string, number> = {
  whatsapp_reconnect: 80,
  reminder_followup:  70,
  discount_review:    60,
  bundle_review:      55,
  manual_review:      40,
};

export function scoreAutomationItem(item: AutomationQueueItem): AutomationPriorityResult {
  const reasons: string[] = [];
  let score = KIND_BASE[item.kind] ?? 40;
  reasons.push(`kind:${item.kind}(${score})`);

  // Status modifier
  if (item.status === 'pending') {
    score += 20;
    reasons.push('pending(+20)');
  } else if (item.status === 'approved') {
    score += 10;
    reasons.push('approved(+10)');
  } else {
    score -= 50;
    reasons.push(`${item.status}(-50)`);
  }

  // Outcome history
  for (const log of item.outcomeLog ?? []) {
    switch (log.outcome) {
      case 'sale_created':        score += 30; reasons.push('sale_created(+30)'); break;
      case 'customer_responded':  score += 20; reasons.push('customer_responded(+20)'); break;
      case 'no_response':         score -= 15; reasons.push('no_response(-15)'); break;
      case 'not_relevant':        score -= 30; reasons.push('not_relevant(-30)'); break;
    }
  }

  // Target value
  if (item.customerName) { score += 10; reasons.push('has_customer(+10)'); }
  if (item.sku)           { score += 10; reasons.push('has_sku(+10)'); }

  return { itemId: item.id, score: Math.min(100, Math.max(0, score)), reasons };
}
