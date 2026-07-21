// ============================================================
// I6-C2 — proactive consumer pure-logic tests.
//
// The repo test env is node (no DOM renderer), so — following the existing
// TopActionRow convention — component behavior is verified through the pure
// helpers each consumer exports, over hand-built PresentedInsights fixtures.
// Covers: tone mapping, confidence display gating, no-terminology guard,
// collapsed bubble summary (EN/ES/PT + plural), top-group cap and ordering,
// and the consumer chrome labels.
// ============================================================

import { describe, it, expect } from 'vitest';
import type { InsightCard, InsightGroup, PresentedInsights } from '@/services/intelligence/presentation';
import {
  shouldShowConfidence, cardVisibleText, sectionHasContent,
  bubbleCollapsedModel, bubbleTopGroups, bubbleHighestPriority,
} from './proactiveViewModel';
import { PUI, priorityTone, toneColorsFor } from './proactiveStrings';

function card(over: Partial<InsightCard> = {}): InsightCard {
  return {
    fingerprint: 'fp-1', detectorId: 'sales_momentum', category: 'sales',
    severity: 'critical', direction: 'negative', priority: 'critical',
    confidence: 0.9, confidencePct: 90, icon: '📉',
    headline: 'Sales dropped 22% vs the previous week.',
    summary: 'This is a sharp decline that can affect your income.',
    recommendation: 'Review recent sales activity first.',
    expandableDetails: ['This week: $7,800.00 (40 sales)'],
    actions: [{ kind: 'review_sales_activity', category: 'sales' }],
    ...over,
  };
}
function group(over: Partial<InsightGroup> = {}): InsightGroup {
  const c = card();
  return { groupKey: c.fingerprint, priority: c.priority, icon: c.icon, headline: c.headline, summary: c.summary, recommendation: c.recommendation, members: [c], ...over };
}
function presented(over: Partial<PresentedInsights> = {}): PresentedInsights {
  return {
    referenceYMD: '2026-07-15', lang: 'en',
    executive: { headline: 'Today I found 1 important thing.', lines: ['Sales dropped 22% vs the previous week.'], actionableCount: 1 },
    cards: [card()], groups: [group()], suppressed: [], actionableCount: 1, ...over,
  };
}

describe('tone mapping', () => {
  it('maps each priority to the correct manager tone bucket', () => {
    expect(priorityTone('critical')).toBe('critical');
    expect(priorityTone('important')).toBe('warning');
    expect(priorityTone('watch')).toBe('warning');
    expect(priorityTone('positive')).toBe('positive');
    expect(priorityTone('info')).toBe('neutral');
  });
  it('returns concrete colors for a priority', () => {
    const c = toneColorsFor('critical');
    expect(c).toEqual(expect.objectContaining({ fg: expect.any(String), bg: expect.any(String), border: expect.any(String) }));
  });
});

describe('section helpers', () => {
  it('shows confidence only when it flags partial evidence (< 80%)', () => {
    expect(shouldShowConfidence(card({ confidencePct: 90 }))).toBe(false);
    expect(shouldShowConfidence(card({ confidencePct: 70 }))).toBe(true);
  });
  it('cardVisibleText exposes owner strings and no internal terminology', () => {
    const text = cardVisibleText(card()).join(' ').toLowerCase();
    for (const token of ['sales_momentum', 'fingerprint', 'cents', 'detectorid', 'evidence', 'canonical']) {
      expect(text).not.toContain(token);
    }
  });
  it('sectionHasContent reflects presence of cards', () => {
    expect(sectionHasContent(presented())).toBe(true);
    expect(sectionHasContent(presented({ cards: [] }))).toBe(false);
    expect(sectionHasContent(null)).toBe(false);
  });
});

describe('bubble collapsed model', () => {
  it('reports the actionable count with plural-aware attention wording (EN/ES/PT)', () => {
    expect(bubbleCollapsedModel(presented({ actionableCount: 3 }), 'en').label).toBe('3 things need attention');
    expect(bubbleCollapsedModel(presented({ actionableCount: 1 }), 'en').label).toBe('1 thing needs attention');
    expect(bubbleCollapsedModel(presented({ actionableCount: 2 }), 'es').label).toBe('2 cosas necesitan atención');
    expect(bubbleCollapsedModel(presented({ actionableCount: 1 }), 'pt').label).toBe('1 coisa precisa de atenção');
  });
  it('falls back to a calm line when nothing is actionable', () => {
    const worth = bubbleCollapsedModel(presented({ actionableCount: 0, groups: [group({ priority: 'watch' })], cards: [card({ priority: 'watch' })] }), 'en');
    expect(worth.label).toBe('Worth a look');
    const none = bubbleCollapsedModel(presented({ actionableCount: 0, groups: [], cards: [] }), 'en');
    expect(none.label).toBe('No urgent items');
    expect(none.tone).toBe('neutral');
  });
  it('drives tone from the highest visible priority', () => {
    expect(bubbleCollapsedModel(presented(), 'en').tone).toBe('critical');
    expect(bubbleHighestPriority(presented())).toBe('critical');
  });
});

describe('bubble top groups', () => {
  it('caps at three and preserves presenter order', () => {
    const groups = ['critical', 'important', 'watch', 'positive', 'info'].map((p, i) =>
      group({ groupKey: `g${i}`, priority: p as InsightGroup['priority'] }));
    const top = bubbleTopGroups(presented({ groups }));
    expect(top).toHaveLength(3);
    expect(top.map((g) => g.groupKey)).toEqual(['g0', 'g1', 'g2']);
  });
});

describe('consumer chrome labels', () => {
  it('localizes section title and open-manager in all three languages', () => {
    expect(PUI.sectionTitle('en')).toBe("Today's Intelligence");
    expect(PUI.sectionTitle('es')).toBe('Inteligencia de hoy');
    expect(PUI.sectionTitle('pt')).toBe('Inteligência de hoje');
    expect(PUI.openManager('en')).toBe('Open Business Manager');
    expect(PUI.openManager('es')).toBe('Abrir Gerente del Negocio');
    expect(PUI.openManager('pt')).toBe('Abrir Gerente do Negócio');
  });
});
