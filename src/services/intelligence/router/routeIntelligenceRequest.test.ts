// ============================================================
// R-INTEL-ROUTER-V1 — unit tests for routeIntelligenceRequest().
// Verifies deterministic classification + safety defaults (shadow mode).
// ============================================================

import { describe, it, expect } from 'vitest';
import { routeIntelligenceRequest } from './routeIntelligenceRequest';

describe('routeIntelligenceRequest — V1 shadow router', () => {
  it('1. basic sales question → sales / normal / snapshot / low / answerOnly / read', () => {
    const r = routeIntelligenceRequest({ source: 'chat', query: 'how were my sales today' });
    expect(r.intent).toBe('sales');
    expect(r.urgency).toBe('normal');
    expect(r.dataNeed).toBe('snapshot');
    expect(r.computeBudget).toBe('low');
    expect(r.executionMode).toBe('answerOnly');
    expect(r.memoryPolicy).toBe('read');
    expect(r.safeToRunOnSecondary).toBe(true);
  });

  it('2. inventory restock question → inventory / normal / targeted / low|medium / suggestAction', () => {
    const r = routeIntelligenceRequest({ source: 'chat', query: 'what should I restock', intentId: 'restock_opportunity' });
    expect(r.intent).toBe('inventory');
    expect(r.urgency).toBe('normal');
    expect(r.dataNeed).toBe('targeted');
    expect(['low', 'medium']).toContain(r.computeBudget);
    expect(r.executionMode).toBe('suggestAction');
  });

  it('3. tax/report action → tax / normal / targeted / medium / requireApproval', () => {
    const r = routeIntelligenceRequest({ source: 'action', query: 'export the tax report', actionType: 'export_tax', intentId: 'tax_report' });
    expect(r.intent).toBe('tax');
    expect(r.dataNeed).toBe('targeted');
    expect(r.computeBudget).toBe('medium');
    expect(r.executionMode).toBe('requireApproval');
    expect(r.requiresApprovalReason).toBeDefined();
  });

  it('4. print request → requireApproval (reason print)', () => {
    const r = routeIntelligenceRequest({ source: 'action', actionType: 'print_label', query: 'print the shelf label' });
    expect(r.executionMode).toBe('requireApproval');
    expect(r.requiresApprovalReason).toBe('print');
    expect(r.safeToRunOnSecondary).toBe(false);
  });

  it('5. marketing generation → marketing / medium / requireApproval', () => {
    const r = routeIntelligenceRequest({ source: 'chat', query: 'create a marketing campaign', intentId: 'marketing_campaign' });
    expect(r.intent).toBe('marketing');
    expect(r.computeBudget).toBe('medium');
    expect(r.executionMode).toBe('requireApproval');
    expect(r.requiresApprovalReason).toBe('marketing_generation');
  });

  it('6. delete/write request → requireApproval (reason write_delete)', () => {
    const r = routeIntelligenceRequest({ source: 'action', actionType: 'delete_record', query: 'delete this record' });
    expect(r.executionMode).toBe('requireApproval');
    expect(r.requiresApprovalReason).toBe('write_delete');
  });

  it('7. secondary terminal + unsafe action → safeToRunOnSecondary=false and requireApproval', () => {
    const r = routeIntelligenceRequest({ source: 'action', actionType: 'print_receipt', isSecondary: true });
    expect(r.safeToRunOnSecondary).toBe(false);
    expect(r.executionMode).toBe('requireApproval');

    // Even a pre-approved unsafe action must not auto-execute on a secondary.
    const r2 = routeIntelligenceRequest({ source: 'action', actionType: 'delete_record', isSecondary: true, hasApproval: true });
    expect(r2.executionMode).toBe('requireApproval');
    expect(r2.requiresApprovalReason).toBe('secondary_unsafe');
    expect(r2.safeToRunOnSecondary).toBe(false);
  });

  it('8. slow/unknown hardware + fullScan request → downgraded to targeted', () => {
    const slow = routeIntelligenceRequest({ source: 'chat', query: 'do a full scan of everything', hardwareTier: 'slow' });
    expect(slow.dataNeed).toBe('targeted');
    expect(slow.downgradedFromFullScan).toBe(true);

    const unknown = routeIntelligenceRequest({ source: 'chat', query: 'full scan all data' });
    expect(unknown.dataNeed).toBe('targeted');
    expect(unknown.downgradedFromFullScan).toBe(true);

    // Fast hardware keeps fullScan (router never *defaults* to it, but honors explicit + capable hw).
    const fast = routeIntelligenceRequest({ source: 'chat', query: 'full scan everything', hardwareTier: 'fast' });
    expect(fast.dataNeed).toBe('fullScan');
    expect(fast.downgradedFromFullScan).toBeUndefined();
    expect(fast.computeBudget).toBe('high');
  });

  it('9. general question → general / normal / none|snapshot / low / answerOnly', () => {
    const r = routeIntelligenceRequest({ source: 'chat', query: 'hello what can you help me with' });
    expect(r.intent).toBe('general');
    expect(r.urgency).toBe('normal');
    expect(['none', 'snapshot']).toContain(r.dataNeed);
    expect(r.computeBudget).toBe('low');
    expect(r.executionMode).toBe('answerOnly');
  });

  it('10. dev/debug request → dev / targeted / low|medium / answerOnly, debugReason only in devMode', () => {
    const dev = routeIntelligenceRequest({ source: 'chat', query: 'debug the route', devMode: true });
    expect(dev.intent).toBe('dev');
    expect(dev.dataNeed).toBe('targeted');
    expect(['low', 'medium']).toContain(dev.computeBudget);
    expect(dev.executionMode).toBe('answerOnly');
    expect(dev.debugReason).toBeDefined();

    const noDev = routeIntelligenceRequest({ source: 'chat', query: 'debug the route', devMode: false });
    expect(noDev.intent).toBe('dev');
    expect(noDev.debugReason).toBeUndefined();
  });

  // ── Safety-default invariants ──────────────────────────────
  it('never defaults to fullScan and defaults computeBudget to low', () => {
    for (const q of ['', 'hi', 'how are you', 'what should I do today', 'tell me about my store']) {
      const r = routeIntelligenceRequest({ source: 'chat', query: q });
      expect(r.dataNeed).not.toBe('fullScan');
    }
    expect(routeIntelligenceRequest({ source: 'chat', query: 'hi' }).computeBudget).toBe('low');
  });

  it('is deterministic and side-effect free (same input → deep-equal output)', () => {
    const input = { source: 'chat' as const, query: 'what should I restock', intentId: 'restock_opportunity', devMode: true };
    expect(routeIntelligenceRequest(input)).toEqual(routeIntelligenceRequest(input));
  });

  it('messaging/financial actions require approval', () => {
    expect(routeIntelligenceRequest({ source: 'action', actionType: 'send_whatsapp' }).requiresApprovalReason).toBe('messaging');
    expect(routeIntelligenceRequest({ source: 'action', actionType: 'issue_refund' }).requiresApprovalReason).toBe('financial_action');
  });
});
