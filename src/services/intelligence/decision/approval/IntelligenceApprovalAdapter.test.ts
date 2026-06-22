import { describe, it, expect } from 'vitest';
import type { ChatActionUI } from '@/services/intelligence/chat/handlers';
import type { IntelligenceDecision } from '../IntelligenceDecision';
import {
  toApprovalRequest,
  buildApprovalRequest,
  deriveAffectedAmount,
  deriveEntityId,
} from './IntelligenceApprovalAdapter';

// ── Fixtures ──────────────────────────────────────────────
// Loose `over` so partial pendingDeal fixtures don't need every field.
function action(over: Record<string, unknown>): ChatActionUI {
  return { id: 'a', label: 'l', payload: {}, ...over } as ChatActionUI;
}

function decision(actions: ChatActionUI[], over: Partial<IntelligenceDecision> = {}): IntelligenceDecision {
  return {
    id: 'd1',
    domain: 'cash',
    observation: 'o',
    reasoning: 'because margin is thin',
    decision: 'apply discount',
    confidence: 50,
    confidenceBasis: 'from-score',
    score: 50,
    impactCents: 4242,
    urgency: 'medium',
    entityRef: { type: 'product', id: 'inv1' },
    actionPlan: { steps: ['apply discount'], actions },
    financialSensitive: true,
    safeToRunOnSecondary: false,
    source: { kind: 'loss', signal: {} as never },
    ...over,
  };
}

const ctx = { currentEmployee: { id: 'emp-7' } };

const discountAction = action({ actionType: 'discount' });
const whatsappAction = action({ actionType: 'whatsapp' });
const openAction = action({});
const dealAction = action({
  queueKind: 'pending_deal',
  pendingDeal: { inventoryId: 'inv-deal', originalPriceCents: 10000, proposedPriceCents: 8000, qty: 2 },
});

describe('toApprovalRequest — decision-driven', () => {
  it('discount decision → DISCOUNT_OVERRIDE with mapped fields', () => {
    const req = toApprovalRequest(decision([discountAction]), ctx);
    expect(req).not.toBeNull();
    expect(req).toEqual({
      actionType: 'DISCOUNT_OVERRIDE',
      requestedByEmployeeId: 'emp-7',
      entityId: 'inv1', // from decision.entityRef.id
      affectedAmount: 4242, // from decision.impactCents (no deal attached)
      reason: 'because margin is thin',
    });
  });

  it('pending_deal decision → precise deal delta + inventoryId', () => {
    const req = toApprovalRequest(decision([dealAction]), ctx);
    expect(req?.actionType).toBe('DISCOUNT_OVERRIDE');
    expect(req?.entityId).toBe('inv-deal'); // deal inventoryId wins over entityRef
    expect(req?.affectedAmount).toBe(4000); // (10000 - 8000) * 2
  });

  it('soft-queue (WhatsApp) decision → null (no approvalGuard route)', () => {
    expect(toApprovalRequest(decision([whatsappAction]), ctx)).toBeNull();
  });

  it('none (navigation) decision → null', () => {
    expect(toApprovalRequest(decision([openAction]), ctx)).toBeNull();
  });
});

describe('buildApprovalRequest — covers all money mappings', () => {
  it('DISCOUNT_OVERRIDE field sources', () => {
    const req = buildApprovalRequest('DISCOUNT_OVERRIDE', decision([discountAction]), ctx);
    expect(req.actionType).toBe('DISCOUNT_OVERRIDE');
    expect(req.requestedByEmployeeId).toBe('emp-7');
    expect(req.entityId).toBe('inv1');
    expect(req.affectedAmount).toBe(4242);
    expect(req.reason).toBe('because margin is thin');
  });

  it('PRICE_OVERRIDE maps with identical field sources', () => {
    const req = buildApprovalRequest('PRICE_OVERRIDE', decision([discountAction]), ctx);
    expect(req.actionType).toBe('PRICE_OVERRIDE');
    expect(req.entityId).toBe('inv1');
    expect(req.affectedAmount).toBe(4242);
  });

  it('REFUND maps with identical field sources (forward-ready)', () => {
    const req = buildApprovalRequest('REFUND', decision([discountAction]), ctx);
    expect(req.actionType).toBe('REFUND');
    expect(req.requestedByEmployeeId).toBe('emp-7');
    expect(req.reason).toBe('because margin is thin');
  });
});

describe('field-source edge cases', () => {
  it('missing entity → entityId undefined', () => {
    const d = decision([discountAction], { entityRef: undefined });
    expect(deriveEntityId(d)).toBeUndefined();
    expect(toApprovalRequest(d, ctx)?.entityId).toBeUndefined();
  });

  it('missing impact (and no deal) → affectedAmount undefined', () => {
    const d = decision([discountAction], { impactCents: undefined });
    expect(deriveAffectedAmount(d)).toBeUndefined();
    expect(toApprovalRequest(d, ctx)?.affectedAmount).toBeUndefined();
  });

  it('missing employee → requestedByEmployeeId empty string', () => {
    const req = toApprovalRequest(decision([discountAction]), { currentEmployee: null });
    expect(req?.requestedByEmployeeId).toBe('');
  });

  it('deal delta never negative (proposed > original clamps to 0)', () => {
    const weird = action({
      pendingDeal: { inventoryId: 'x', originalPriceCents: 5000, proposedPriceCents: 9000, qty: 1 },
    });
    expect(deriveAffectedAmount(decision([weird]))).toBe(0);
  });
});

describe('determinism', () => {
  it('same decision + ctx → deep-equal request', () => {
    const d = decision([dealAction]);
    expect(toApprovalRequest(d, ctx)).toEqual(toApprovalRequest(d, ctx));
  });
});
