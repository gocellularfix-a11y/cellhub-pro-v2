import { describe, it, expect } from 'vitest';
import type { IntelligenceDecision, DecisionUrgency, DecisionSource } from '../IntelligenceDecision';
import type { ChatActionUI } from '@/services/intelligence/chat/handlers';
import { prepareAction, derivePreparedType } from './prepareAction';
import { renderDraft, type TemplateContext } from './templates';
import type { PreparedActionType } from './PreparedAction';

// ── Fixtures ──────────────────────────────────────────────
function action(over: Record<string, unknown>): ChatActionUI {
  return { id: 'a', label: 'l', payload: {}, ...over } as ChatActionUI;
}

let n = 0;
function decision(over: Partial<IntelligenceDecision> = {}): IntelligenceDecision {
  n += 1;
  return {
    id: over.id ?? `d${n}`,
    domain: 'cash',
    observation: 'obs',
    reasoning: 'why',
    decision: 'do it',
    confidence: 50,
    confidenceBasis: 'from-score',
    score: 50,
    impactCents: 10_000,
    urgency: 'medium' as DecisionUrgency,
    actionPlan: { steps: ['do it'], actions: [] },
    financialSensitive: false,
    safeToRunOnSecondary: true,
    source: { kind: 'loss', signal: {} as never } as DecisionSource,
    ...over,
  };
}

const attention = (domain: string) =>
  ({ kind: 'attention', signal: { domain } as never } as DecisionSource);
const proactive = (category: string) =>
  ({ kind: 'proactive', signal: { category } as never } as DecisionSource);

// ── derivePreparedType — structural mapping (no text parsing) ──
describe('derivePreparedType', () => {
  it('maps attention domains deterministically', () => {
    expect(derivePreparedType(decision({ source: attention('repair') }))).toBe('READY_PICKUP');
    expect(derivePreparedType(decision({ source: attention('layaway') }))).toBe('OVERDUE_LAYAWAY');
    expect(derivePreparedType(decision({ source: attention('external_payment') }))).toBe('OVERDUE_LAYAWAY');
    expect(derivePreparedType(decision({ source: attention('customer_churn') }))).toBe('OUTREACH');
    expect(derivePreparedType(decision({ source: attention('store_credit') }))).toBe('OUTREACH');
    expect(derivePreparedType(decision({ source: attention('special_order') }))).toBe('GENERIC');
  });

  it('maps proactive categories deterministically', () => {
    expect(derivePreparedType(decision({ source: proactive('repair_followup') }))).toBe('STALE_REPAIR');
    expect(derivePreparedType(decision({ source: proactive('collection') }))).toBe('OVERDUE_LAYAWAY');
    expect(derivePreparedType(decision({ source: proactive('vip_retention') }))).toBe('OUTREACH');
    expect(derivePreparedType(decision({ source: proactive('revenue') }))).toBe('PAYMENT_OPPORTUNITY');
    expect(derivePreparedType(decision({ source: proactive('inventory') }))).toBe('GENERIC');
    expect(derivePreparedType(decision({ source: proactive('approval') }))).toBe('GENERIC');
  });

  it('internal-analysis sources fall back to GENERIC', () => {
    for (const kind of ['loss', 'drop', 'diagnosis', 'restock'] as const) {
      expect(derivePreparedType(decision({ source: { kind, signal: {} as never } as DecisionSource }))).toBe('GENERIC');
    }
  });
});

// ── prepareAction — field mapping + linkage ──
describe('prepareAction', () => {
  it('maps fields and links back to the Top Action via sourceTopActionId', () => {
    const d = decision({
      id: 'attention:r1',
      reasoning: 'Ready repair not picked up',
      observation: 'ready 5 days',
      source: attention('repair'),
      entityRef: { type: 'repair', id: 'r1', name: 'Maria' },
    });
    const p = prepareAction(d, { lang: 'en', now: 1234 });
    expect(p.id).toBe('prep:attention:r1');
    expect(p.sourceTopActionId).toBe('attention:r1'); // == TopAction.decisionId
    expect(p.type).toBe('READY_PICKUP');
    expect(p.title).toBe('Ready repair not picked up');
    expect(p.summary).toBe('ready 5 days');
    expect(p.preparedAt).toBe(1234); // stamped only because now was passed
    expect(p.draftContent).toContain('Maria');
  });

  it('reads approval requirement without enforcing (whatsapp → soft-queue)', () => {
    const d = decision({
      source: proactive('vip_retention'),
      actionPlan: { steps: ['msg'], actions: [action({ actionType: 'whatsapp' })] },
    });
    const p = prepareAction(d);
    expect(p.type).toBe('OUTREACH');
    expect(p.approvalRequired).toBe(true);
    expect(p.approvalKind).toBe('soft-queue');
  });

  it('carries financialSensitive through', () => {
    expect(prepareAction(decision({ financialSensitive: true })).financialSensitive).toBe(true);
  });

  it('is deterministic — same (decision, lang, now) → identical output', () => {
    const d = decision({ id: 'x', source: proactive('collection'), entityRef: { type: 'layaway', id: 'l1', name: 'Ana' } });
    expect(prepareAction(d, { lang: 'es', now: 7 })).toEqual(prepareAction(d, { lang: 'es', now: 7 }));
  });

  it('defaults: lang=en, no preparedAt stamped (identity-stable)', () => {
    const p = prepareAction(decision({ source: attention('repair'), entityRef: { type: 'repair', id: 'r', name: 'Bo' } }));
    expect(p.preparedAt).toBeUndefined();
    expect('preparedAt' in p).toBe(false);
    expect(p.draftContent).toContain('Hi Bo,');
  });

  it('preparedAt is present ONLY when now is explicitly provided', () => {
    const d = decision({ id: 'z', source: attention('layaway'), entityRef: { type: 'layaway', id: 'l9' } });
    expect(prepareAction(d).preparedAt).toBeUndefined();
    expect(prepareAction(d, { now: 999 }).preparedAt).toBe(999);
  });
});

// ── templates — bilingual, deterministic, name-safe ──
describe('templates', () => {
  const ctx = (over: Partial<TemplateContext> = {}): TemplateContext => ({
    lang: 'en', customerName: 'Sam', title: 't', reason: 'r', action: 'call the customer', ...over,
  });

  it('every type renders a non-empty draft in all three languages', () => {
    const types: PreparedActionType[] = ['READY_PICKUP', 'STALE_REPAIR', 'OVERDUE_LAYAWAY', 'OUTREACH', 'PAYMENT_OPPORTUNITY', 'GENERIC'];
    for (const t of types) {
      for (const lang of ['en', 'es', 'pt'] as const) {
        expect(renderDraft(t, ctx({ lang })).length).toBeGreaterThan(0);
      }
    }
  });

  it('personalizes with the name and degrades gracefully when missing', () => {
    expect(renderDraft('READY_PICKUP', ctx({ customerName: 'Sam' }))).toContain('Hi Sam,');
    expect(renderDraft('READY_PICKUP', ctx({ customerName: undefined }))).toContain('Hi,');
  });

  it('GENERIC echoes the internal action, no customer greeting', () => {
    const out = renderDraft('GENERIC', ctx({ action: 'reorder iPhone screens' }));
    expect(out).toContain('reorder iPhone screens');
    expect(out).not.toContain('Hi Sam');
  });
});
