import { describe, it, expect } from 'vitest';
import type { LossSignal } from '@/services/intelligence/chat/whatIsLosingMoney';
import type { DropSignal } from '@/services/intelligence/chat/whyDidSalesDrop';
import type { AttentionItem } from '@/services/intelligence/chat/whoNeedsAttentionToday';
import type { RestockRecommendation } from '@/services/intelligence/chat/restockOpportunity';
import type { DiagnosisCause } from '@/services/intelligence/chat/whyIsTodaySlow';
import type { ProactiveAction } from '@/services/intelligence/proactive/types';
import type { ChatActionUI } from '@/services/intelligence/chat/handlers';
import {
  fromLossSignal,
  fromDropSignal,
  fromAttentionItem,
  fromRestockRecommendation,
  fromDiagnosisCause,
  fromProactiveAction,
} from './adapters';
import { normalizeDecisions } from './normalizeDecision';

// ── Fixtures ──────────────────────────────────────────────
// Minimal ChatActionUI fixtures. `payload` is cast since its internals are
// irrelevant to normalization (the adapters never read into it).
const readOnlyAction = { id: 'open1', label: 'Open' } as ChatActionUI; // no actionType → read-only
const mutatingAction = { id: 'wa1', label: 'WhatsApp', actionType: 'whatsapp' } as ChatActionUI;

const loss: LossSignal = {
  id: 'L1', category: 'low_margin_items', headline: 'H', evidence: 'E',
  exposureCents: 12345, recommendedAction: 'do X', score: 80,
  actions: [readOnlyAction], entityRef: { type: 'product', value: 'inv1' },
};

const drop: DropSignal = {
  id: 'D1', category: 'overall_revenue', headline: 'H', evidence: 'E',
  recommendedAction: 'do Y', estimatedImpactCents: 5000, dropPct: 30,
  severity: 'high', confidence: 'medium', score: 55, actions: [mutatingAction],
  entityRef: { type: 'customer', value: 'cust1' },
};

const attn: AttentionItem = {
  id: 'A1', domain: 'repair', entityId: 'rep1', entityName: 'iPhone 12',
  reason: 'ready 5d', recommendedAction: 'call customer', urgency: 'high',
  customerId: 'cust2', customerName: 'Jane', customerPhone: '555-0100', priorityScore: 62,
};

const restock: RestockRecommendation = {
  id: 'R1', name: 'Case', sku: 'SKU1', category: 'accessory', qty: 1, minQty: 5,
  priceCents: 1000, costCents: 400, marginCents: 600, marginRatio: 0.6,
  recentSales14d: 10, recentSales7d: 6, daysOfCover: 2, score: 77,
  reason: 'low stock', recommendedAction: 'reorder',
};

const diag: DiagnosisCause = {
  id: 'C1', category: 'traffic', headline: 'H', evidence: 'E',
  recommendedAction: 'promote', confidence: 'low', score: 40, actions: [],
};

const proactive: ProactiveAction = {
  id: 'P1', category: 'collection', priority: 'critical', title: 'Collect balance',
  reason: 'balance owed', recommendedAction: 'collect', estimatedImpactCents: 9000,
  entityType: 'layaway', entityId: 'lay1', workflowId: 'wf1', confidence: 0.8, createdAt: 0,
};

describe('IntelligenceDecision adapters — field mapping', () => {
  it('LossSignal maps deterministically with margin sensitivity', () => {
    const d = fromLossSignal(loss);
    expect(d.id).toBe('loss:L1');
    expect(d.domain).toBe('inventory');
    expect(d.observation).toBe('E');
    expect(d.reasoning).toBe('H');
    expect(d.decision).toBe('do X');
    expect(d.confidence).toBe(80);
    expect(d.confidenceBasis).toBe('from-score');
    expect(d.score).toBe(80);
    expect(d.impactCents).toBe(12345);
    expect(d.urgency).toBe('critical'); // 80 >= 75
    expect(d.entityRef).toEqual({ type: 'product', id: 'inv1' });
    expect(d.financialSensitive).toBe(true); // low_margin_items
    expect(d.safeToRunOnSecondary).toBe(true); // read-only action
  });

  it('DropSignal maps categorical confidence + severity urgency', () => {
    const d = fromDropSignal(drop);
    expect(d.id).toBe('drop:D1');
    expect(d.domain).toBe('cash');
    expect(d.confidence).toBe(60); // medium
    expect(d.confidenceBasis).toBe('explicit');
    expect(d.urgency).toBe('high'); // severity
    expect(d.impactCents).toBe(5000);
    expect(d.financialSensitive).toBe(false); // revenue is visible
    expect(d.safeToRunOnSecondary).toBe(false); // whatsapp action mutates
  });

  it('AttentionItem maps entity + customer fields', () => {
    const d = fromAttentionItem(attn);
    expect(d.id).toBe('attention:A1');
    expect(d.domain).toBe('repair');
    expect(d.confidence).toBe(62); // from priorityScore
    expect(d.urgency).toBe('high');
    expect(d.entityRef).toEqual({
      type: 'repair', id: 'rep1', name: 'Jane', phone: '555-0100', customerId: 'cust2',
    });
    expect(d.actionPlan.actions).toEqual([]);
    expect(d.safeToRunOnSecondary).toBe(true);
  });

  it('RestockRecommendation is inventory + financially sensitive', () => {
    const d = fromRestockRecommendation(restock);
    expect(d.id).toBe('restock:R1');
    expect(d.domain).toBe('inventory');
    expect(d.impactCents).toBe(600); // marginCents
    expect(d.urgency).toBe('critical'); // 77 >= 75
    expect(d.financialSensitive).toBe(true);
    expect(d.entityRef).toEqual({ type: 'product', id: 'R1', name: 'Case' });
  });

  it('DiagnosisCause maps categorical confidence, no entityRef', () => {
    const d = fromDiagnosisCause(diag);
    expect(d.id).toBe('diagnosis:C1');
    expect(d.domain).toBe('ops');
    expect(d.confidence).toBe(30); // low
    expect(d.urgency).toBe('medium'); // 40 in [25,50)
    expect(d.entityRef).toBeUndefined();
    expect(d.safeToRunOnSecondary).toBe(true); // empty actions
  });

  it('ProactiveAction derives score from priority, confidence from unit', () => {
    const d = fromProactiveAction(proactive);
    expect(d.id).toBe('proactive:P1');
    expect(d.domain).toBe('cash');
    expect(d.score).toBe(90); // critical
    expect(d.confidence).toBe(80); // 0.8 * 100
    expect(d.urgency).toBe('critical');
    expect(d.impactCents).toBe(9000);
    expect(d.actionPlan.workflowId).toBe('wf1');
    expect(d.entityRef).toEqual({ type: 'layaway', id: 'lay1' });
  });
});

describe('IntelligenceDecision — no information loss', () => {
  it('carries each source signal verbatim', () => {
    expect(fromLossSignal(loss).source).toEqual({ kind: 'loss', signal: loss });
    expect(fromDropSignal(drop).source).toEqual({ kind: 'drop', signal: drop });
    expect(fromAttentionItem(attn).source).toEqual({ kind: 'attention', signal: attn });
    expect(fromRestockRecommendation(restock).source).toEqual({ kind: 'restock', signal: restock });
    expect(fromDiagnosisCause(diag).source).toEqual({ kind: 'diagnosis', signal: diag });
    expect(fromProactiveAction(proactive).source).toEqual({ kind: 'proactive', signal: proactive });
  });

  it('preserves generator-specific fields reachable through source.signal', () => {
    const d = fromRestockRecommendation(restock);
    // Fields with no top-level slot survive via source.signal.
    expect(d.source.kind).toBe('restock');
    if (d.source.kind === 'restock') {
      expect(d.source.signal.daysOfCover).toBe(2);
      expect(d.source.signal.costCents).toBe(400);
      expect(d.source.signal.recentSales7d).toBe(6);
    }
  });
});

describe('IntelligenceDecision — determinism', () => {
  it('same input → deep-equal output for every adapter', () => {
    expect(fromLossSignal(loss)).toEqual(fromLossSignal(loss));
    expect(fromDropSignal(drop)).toEqual(fromDropSignal(drop));
    expect(fromAttentionItem(attn)).toEqual(fromAttentionItem(attn));
    expect(fromRestockRecommendation(restock)).toEqual(fromRestockRecommendation(restock));
    expect(fromDiagnosisCause(diag)).toEqual(fromDiagnosisCause(diag));
    expect(fromProactiveAction(proactive)).toEqual(fromProactiveAction(proactive));
  });
});

describe('normalizeDecisions dispatcher', () => {
  it('routes each kind to its adapter', () => {
    expect(normalizeDecisions({ kind: 'loss', signals: [loss] })[0].id).toBe('loss:L1');
    expect(normalizeDecisions({ kind: 'drop', signals: [drop] })[0].id).toBe('drop:D1');
    expect(normalizeDecisions({ kind: 'attention', signals: [attn] })[0].id).toBe('attention:A1');
    expect(normalizeDecisions({ kind: 'restock', signals: [restock] })[0].id).toBe('restock:R1');
    expect(normalizeDecisions({ kind: 'diagnosis', signals: [diag] })[0].id).toBe('diagnosis:C1');
    expect(normalizeDecisions({ kind: 'proactive', signals: [proactive] })[0].id).toBe('proactive:P1');
  });

  it('returns one decision per input signal', () => {
    const out = normalizeDecisions({ kind: 'loss', signals: [loss, loss] });
    expect(out).toHaveLength(2);
  });
});
