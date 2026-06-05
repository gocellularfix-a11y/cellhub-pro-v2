// ============================================================
// R-INTELLIGENCE-USE-APP-LANGUAGE-V1 — response language follows app locale.
// Proves the deterministic half: once the app locale (incl. pt) reaches a
// handler, the RESPONSE copy is in that language — while intent detection
// still understands ES/EN/PT input. (The lang chain is widened to 'pt' and
// tsc-verified; the UI labels are covered by the manual checklist.)
// ============================================================

import { describe, it, expect } from 'vitest';
import { classifyIntent } from './intentRouter';
import { handleRepairsReady } from './repairsReady';
import type { IntelligenceEngine } from '../IntelligenceEngine';
import type { Customer } from '@/store/types';

const NOW = new Date('2026-06-04T12:00:00').getTime();
const engineWith = (repairs: any[]) => ({ getRepairs: () => repairs }) as unknown as IntelligenceEngine;
const repair = (over: Record<string, unknown> = {}) => ({
  id: 'r1', customerName: 'Maria', customerPhone: '8050001111',
  device: 'iPhone 13', issue: 'Screen', status: 'ready', balance: 8999, createdAt: '2026-06-01', ...over,
});

describe('R-LANGUAGE: repairs-ready response follows app language', () => {
  it('PT app language → Portuguese empty state, not English', () => {
    const res = handleRepairsReady(engineWith([]), 'pt', NOW);
    expect(res.text).toContain('Nenhum reparo pronto para retirada');
    expect(res.text).not.toContain('No repairs ready for pickup');
  });

  it('PT app language → Portuguese detail copy (header, balance, action)', () => {
    const res = handleRepairsReady(engineWith([repair()]), 'pt', NOW);
    expect(res.text).toContain('pronto'); // pt header "… pronto(s) para retirada"
    expect(res.text).toContain('Saldo:'); // pt balanceDue
    expect(res.text).toContain('Abra um reparo para confirmar'); // pt actionV2
    // No English leak
    expect(res.text).not.toContain('Repairs Ready');
    expect(res.text).not.toContain('Open a repair to confirm');
  });

  it('ES app language → Spanish copy', () => {
    const res = handleRepairsReady(engineWith([repair()]), 'es', NOW);
    expect(res.text).toContain('Saldo:');
    expect(res.text).toContain('Abre una reparación para confirmar');
  });
});

describe('R-LANGUAGE: intent detection is language-independent', () => {
  const C: Customer[] = [];
  it('a typed Spanish query routes the same regardless of app language', () => {
    const esInput = 'reparaciones listas para recoger';
    // Intent classification does not depend on the app language flag.
    expect(classifyIntent(esInput, C, 'pt').id).toBe(classifyIntent(esInput, C, 'en').id);
  });

  it('Spanish query under PT app language still yields a Portuguese response', () => {
    // Mirrors the runtime path: ES input is understood, but the response copy
    // uses the app language (pt) because the handler is called with lang='pt'.
    const intent = classifyIntent('reparaciones listas para recoger', C, 'pt').id;
    expect(intent).toBe('repairs_ready');
    const res = handleRepairsReady(engineWith([repair()]), 'pt', NOW);
    expect(res.text).toContain('pronto');
    expect(res.text).not.toContain('Open a repair to confirm');
  });
});
