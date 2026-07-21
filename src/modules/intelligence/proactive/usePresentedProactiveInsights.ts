// ============================================================
// I6-C2 — UI consumer entry for presented proactive intelligence.
//
// The single hook every visible surface (Recommendation Bubble; the Business
// Manager reuses its own engine) uses to obtain canonical PresentedInsights.
// Mirrors the proven BusinessManagerPage engine pattern: a ref-stable engine
// keyed by a (lang, store, consolidated) signature, updateData each render,
// and ONE memoized evaluation per (engine, language, store, data, refresh).
//
// Refresh lifecycle (conservative, no polling / no timers / no network):
//   • first mount with valid data  → memo runs once;
//   • active store changes         → signature change rebuilds the engine;
//   • language changes             → signature change re-localizes;
//   • relevant in-memory data      → memo deps (sales/customers/…) re-run it;
//   • explicit refresh             → refreshSeq bump.
// Alerts/scoring stay disabled (proactive detectors don't use them). Fails
// safe: any throw returns { ok:false } — the caller renders a neutral state
// or hides itself; a fabricated insight is NEVER produced as a fallback.
// ============================================================

import { useMemo, useRef } from 'react';
import { useApp } from '@/store/AppProvider';
import { useTranslation } from '@/i18n';
import { IntelligenceEngine } from '@/services/intelligence';
import type { PresentedInsights, PresenterLang } from '@/services/intelligence/presentation';

export interface PresentedInsightsState {
  ok: boolean;
  presented: PresentedInsights | null;
}

export function usePresentedProactiveInsights(refreshSeq = 0): PresentedInsightsState {
  const { state } = useApp();
  const {
    sales, customers, inventory, repairs,
    specialOrders, unlocks, layaways, customerReturns, expenses, employees,
    appointments, storeCreditLedger, settings, vendorReturns,
    currentStoreId, consolidatedView,
  } = state;
  const { locale } = useTranslation();
  const lang = locale as PresenterLang;

  const engineRef = useRef<IntelligenceEngine | null>(null);
  const sigRef = useRef<string>('');
  const sig = `${lang}|${currentStoreId ?? ''}|${consolidatedView ? '1' : '0'}`;
  if (!engineRef.current || sigRef.current !== sig) {
    engineRef.current = new IntelligenceEngine(
      sales, customers, inventory, repairs,
      { lang, storeId: consolidatedView ? undefined : currentStoreId, enableAlerts: false, enableScoring: false, cacheTimeoutMinutes: 15 },
      { specialOrders, unlocks, layaways, customerReturns, expenses, employees, appointments, storeCreditLedger, settings, vendorReturns },
    );
    sigRef.current = sig;
  }
  const engine = engineRef.current;
  engine.updateData(sales, customers, inventory, repairs, {
    specialOrders, unlocks, layaways, customerReturns, expenses, employees, appointments, storeCreditLedger, settings, vendorReturns,
  });

  return useMemo<PresentedInsightsState>(() => {
    try {
      return { ok: true, presented: engine.getPresentedInsights() };
    } catch (err) {
      // Honest terminal failure — never a legacy fallback, never a crash.
      // eslint-disable-next-line no-console
      console.warn('[intelligence] proactive presentation failed:', err);
      return { ok: false, presented: null };
    }
    // refreshSeq forces a deterministic re-evaluation; data slices are the
    // real change signal (proactive reads sales + the scoped snapshot).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, lang, sig, refreshSeq,
    sales, customers, inventory, repairs, specialOrders, unlocks, layaways,
    customerReturns, expenses, employees, appointments, storeCreditLedger, settings, vendorReturns]);
}
