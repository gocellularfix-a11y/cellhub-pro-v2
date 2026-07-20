// ============================================================
// CHAT-R1.1 — structured gate terminality.
//
// A RECOGNIZED explicit business query owns the request through
// presentation: an internal failure AFTER recognition produces the honest
// localized terminal response — never null (which would hand the query to a
// legacy handler answering with a different period/meaning). Failures
// BEFORE recognition (context/parse) still return null so legacy routing
// legitimately keeps ownership.
//
// The executor is mocked to throw — the only deterministic way to hit the
// post-recognition failure branch without corrupting real state.
// ============================================================

import { describe, it, expect, vi } from 'vitest';

vi.mock('./executeBusinessQuery', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./executeBusinessQuery')>();
  return {
    ...mod,
    executeBusinessQuery: () => { throw new Error('boom: forced post-recognition failure'); },
  };
});

import { tryHandleStructuredBusinessQuery } from './tryHandleStructuredBusinessQuery';
import { IntelligenceEngine } from '../IntelligenceEngine';
import type { Customer, Sale } from '@/store/types';

const REF = new Date(2026, 6, 15, 12, 0, 0);

function buildEngine(): IntelligenceEngine {
  return new IntelligenceEngine(
    [] as Sale[], [] as Customer[], [], [],
    { lang: 'en', enableAlerts: false, enableScoring: false, cacheTimeoutMinutes: 15 },
    { customerReturns: [], settings: { defaultCommissionRate: 0.07 } } as never,
  );
}

const TERMINAL = {
  en: "I couldn't complete that business query right now. Please try again.",
  es: 'No pude completar esa consulta del negocio en este momento. Inténtalo de nuevo.',
  pt: 'Não consegui concluir essa consulta do negócio no momento. Tente novamente.',
};

describe('CHAT-R1.1 — recognized query + internal failure = terminal (EN/ES/PT)', () => {
  it('recognized metric+period query never returns null on executor failure', () => {
    const r = tryHandleStructuredBusinessQuery(buildEngine(), 'sales yesterday', 'en', REF);
    expect(r).not.toBeNull();
    expect(r!.text).toBe(TERMINAL.en);
  });
  it('ES and PT terminal responses are localized', () => {
    expect(tryHandleStructuredBusinessQuery(buildEngine(), 'ventas de ayer', 'es', REF)!.text).toBe(TERMINAL.es);
    expect(tryHandleStructuredBusinessQuery(buildEngine(), 'vendas de ontem', 'pt', REF)!.text).toBe(TERMINAL.pt);
  });
  it('terminal text exposes no internal terminology', () => {
    const r = tryHandleStructuredBusinessQuery(buildEngine(), 'profit last week', 'en', REF)!;
    expect(r.text).not.toMatch(/boom|Error|stack|refusal|canonical|undefined|NaN/);
  });
  it('UNRECOGNIZED text still returns null — legacy keeps ownership', () => {
    expect(tryHandleStructuredBusinessQuery(buildEngine(), 'tell me a joke', 'en', REF)).toBeNull();
    expect(tryHandleStructuredBusinessQuery(buildEngine(), '', 'en', REF)).toBeNull();
  });
  it('PRE-recognition failure (broken context) still returns null — legacy keeps ownership', () => {
    const broken = { getStructuredQueryContext: () => { throw new Error('ctx down'); } } as unknown as IntelligenceEngine;
    expect(tryHandleStructuredBusinessQuery(broken, 'sales yesterday', 'en', REF)).toBeNull();
  });
  it('deterministic repeated terminality', () => {
    const a = tryHandleStructuredBusinessQuery(buildEngine(), 'sales yesterday', 'en', REF);
    const b = tryHandleStructuredBusinessQuery(buildEngine(), 'sales yesterday', 'en', REF);
    expect(b).toEqual(a);
  });
});
