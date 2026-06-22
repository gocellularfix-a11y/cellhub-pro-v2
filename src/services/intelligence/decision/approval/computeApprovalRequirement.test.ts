import { describe, it, expect } from 'vitest';
import type { ChatActionUI } from '@/services/intelligence/chat/handlers';
import type { IntelligenceDecision } from '../IntelligenceDecision';
import { classifyAction, moneyApprovalTypeFor } from './classifyAction';
import { computeApprovalRequirement, logApprovalRequirementShadow } from './computeApprovalRequirement';

// ── Fixtures ──────────────────────────────────────────────
function action(over: Partial<ChatActionUI>): ChatActionUI {
  return { id: 'a', label: 'l', payload: {} as ChatActionUI['payload'], ...over } as ChatActionUI;
}

function decision(actions: ChatActionUI[], over: Partial<IntelligenceDecision> = {}): IntelligenceDecision {
  return {
    id: 'd1',
    domain: 'cash',
    observation: 'o',
    reasoning: 'r',
    decision: 'do something',
    confidence: 50,
    confidenceBasis: 'from-score',
    score: 50,
    urgency: 'medium',
    actionPlan: { steps: ['do something'], actions },
    financialSensitive: false,
    safeToRunOnSecondary: true,
    // signal body is irrelevant to approval classification.
    source: { kind: 'loss', signal: {} as never },
    ...over,
  };
}

const openAction = action({ /* navigation: no actionType, no queueKind */ });
const whatsappAction = action({ actionType: 'whatsapp' });
const reminderAction = action({ actionType: 'reminder' });
const managerReviewAction = action({ queueKind: 'manual_review' });
const discountAction = action({ actionType: 'discount' });
const dealAction = action({ queueKind: 'pending_deal' });

describe('classifyAction', () => {
  it('open / navigation actions → none', () => {
    expect(classifyAction(decision([openAction])).kind).toBe('none');
  });

  it('empty action plan → none', () => {
    expect(classifyAction(decision([])).kind).toBe('none');
  });

  it('outreach (WhatsApp) → soft-queue', () => {
    expect(classifyAction(decision([whatsappAction])).kind).toBe('soft-queue');
  });

  it('reminder → soft-queue', () => {
    expect(classifyAction(decision([reminderAction])).kind).toBe('soft-queue');
  });

  it('manager-review → soft-queue', () => {
    expect(classifyAction(decision([managerReviewAction])).kind).toBe('soft-queue');
  });

  it('discount → hard-gate DISCOUNT_OVERRIDE', () => {
    const c = classifyAction(decision([discountAction]));
    expect(c.kind).toBe('hard-gate');
    expect(c.approvalActionType).toBe('DISCOUNT_OVERRIDE');
    expect(c.routerActionType).toBe('discount');
  });

  it('deal draft (pending_deal) → hard-gate DISCOUNT_OVERRIDE', () => {
    const c = classifyAction(decision([dealAction]));
    expect(c.kind).toBe('hard-gate');
    expect(c.approvalActionType).toBe('DISCOUNT_OVERRIDE');
  });

  it('hard-gate wins over a co-present soft action', () => {
    expect(classifyAction(decision([whatsappAction, discountAction])).kind).toBe('hard-gate');
  });
});

describe('moneyApprovalTypeFor — forward-ready money mapping', () => {
  it('maps discount / price / refund tokens', () => {
    expect(moneyApprovalTypeFor('discount')).toBe('DISCOUNT_OVERRIDE');
    expect(moneyApprovalTypeFor('price')).toBe('PRICE_OVERRIDE');
    expect(moneyApprovalTypeFor('refund')).toBe('REFUND');
  });
  it('unknown token → undefined', () => {
    expect(moneyApprovalTypeFor('whatsapp')).toBeUndefined();
  });
});

describe('computeApprovalRequirement', () => {
  it('none decision → no approval, allowed on secondary', () => {
    const r = computeApprovalRequirement(decision([openAction]));
    expect(r.approvalRequired).toBe(false);
    expect(r.approvalKind).toBe('none');
    expect(r.allowedOnSecondary).toBe(true);
    expect(r.decisionId).toBe('d1');
  });

  it('outreach decision → approval required, soft-queue', () => {
    const r = computeApprovalRequirement(decision([whatsappAction]));
    expect(r.approvalRequired).toBe(true);
    expect(r.approvalKind).toBe('soft-queue');
    expect(r.approvalActionType).toBeUndefined();
  });

  it('discount decision → approval required, hard-gate, not secondary-safe', () => {
    const r = computeApprovalRequirement(decision([discountAction]));
    expect(r.approvalRequired).toBe(true);
    expect(r.approvalKind).toBe('hard-gate');
    expect(r.approvalActionType).toBe('DISCOUNT_OVERRIDE');
    expect(r.allowedOnSecondary).toBe(false); // requireApproval is never secondary-safe
  });

  it('refund/deal money path classifies as hard-gate', () => {
    // No current generator emits a refund action, so we exercise the deal path
    // (the actually-reachable hard-gate) and the forward-ready refund mapping.
    expect(computeApprovalRequirement(decision([dealAction])).approvalKind).toBe('hard-gate');
    expect(moneyApprovalTypeFor('refund')).toBe('REFUND');
  });

  it('is deterministic — same decision → deep-equal requirement', () => {
    const d = decision([discountAction]);
    expect(computeApprovalRequirement(d)).toEqual(computeApprovalRequirement(d));
  });

  it('shadow logging never throws', () => {
    const r = computeApprovalRequirement(decision([whatsappAction]));
    expect(() => logApprovalRequirementShadow(r)).not.toThrow();
  });
});
