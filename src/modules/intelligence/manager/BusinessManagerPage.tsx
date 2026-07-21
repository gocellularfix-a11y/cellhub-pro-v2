// ============================================================
// Business Manager surface (I5) — read-only visible page.
//
// First visible consumer of the approved I4 Business Manager engine.
// ONE page-level evaluation per (data, referenceDate, range): the engine's
// getBusinessInsights output feeds the pure view-model, which every child
// renders — no child invokes the engine, no intelligence is recalculated in
// UI, nothing is persisted, no polling/timers/automation.
//
// Engine instance mirrors the proven IntelligenceModule pattern
// (ref-stable + config signature + updateData each render). Alerts and
// scoring stay disabled — the manager APIs don't use them.
// ============================================================

import { useMemo, useRef, useState } from 'react';
import { useApp } from '@/store/AppProvider';
import { useTranslation } from '@/i18n';
import { IntelligenceEngine } from '@/services/intelligence';
import {
  buildManagerSurfaceModel,
  SUPPORTED_MANAGER_RANGES,
  DEFAULT_MANAGER_RANGE,
  rangeLabel,
  type SupportedManagerRange,
} from './managerSurfaceModel';
import { ms, type ManagerLang } from './strings';
import { CARD, MUTED, TONE_COLORS } from './surfaceStyles';
import ManagerOverview from './ManagerOverview';
import TodayFocusCard from './TodayFocusCard';
import ManagerAlerts from './ManagerAlerts';
import ManagerOpportunities from './ManagerOpportunities';
import ProposedActions from './ProposedActions';
import BusinessHealthGrid from './BusinessHealthGrid';
import DataConfidenceNotice from './DataConfidenceNotice';
import ExecutiveSummary from './ExecutiveSummary';
import BusinessBriefSection from './BusinessBriefSection';
// CELLHUB-INTELLIGENCE-I6-C2: additive proactive "Today's Intelligence"
// section — coexists with the approved I4 sections below (nothing removed).
import ProactiveInsightsSection from '../proactive/ProactiveInsightsSection';
import type { PresentedInsights } from '@/services/intelligence/presentation';

export default function BusinessManagerPage() {
  const { state } = useApp();
  const {
    sales, customers, inventory, repairs,
    specialOrders, unlocks, layaways, customerReturns, expenses, employees,
    appointments, storeCreditLedger, settings, vendorReturns,
    currentStoreId, consolidatedView,
  } = state;
  const { locale } = useTranslation();
  const lang = locale as ManagerLang;

  const [range, setRange] = useState<SupportedManagerRange>(DEFAULT_MANAGER_RANGE);
  // One stable reference date per evaluation cycle — every section renders
  // from the same evaluation. Manual refresh advances it deterministically.
  const [refDate, setRefDate] = useState<Date>(() => new Date());
  const [refreshSeq, setRefreshSeq] = useState(0);

  const engineRef = useRef<IntelligenceEngine | null>(null);
  const engineConfigSigRef = useRef<string>('');
  const engineConfigSig = `${lang}|${currentStoreId ?? ''}|${consolidatedView ? '1' : '0'}`;
  if (!engineRef.current || engineConfigSigRef.current !== engineConfigSig) {
    engineRef.current = new IntelligenceEngine(
      sales, customers, inventory, repairs,
      { lang, storeId: consolidatedView ? undefined : currentStoreId, enableAlerts: false, enableScoring: false, cacheTimeoutMinutes: 15 },
      { specialOrders, unlocks, layaways, customerReturns, expenses, employees, appointments, storeCreditLedger, settings, vendorReturns },
    );
    engineConfigSigRef.current = engineConfigSig;
  }
  const engine = engineRef.current;
  engine.updateData(sales, customers, inventory, repairs, {
    specialOrders, unlocks, layaways, customerReturns, expenses, employees, appointments, storeCreditLedger, settings, vendorReturns,
  });

  const result = useMemo(() => {
    try {
      const insights = engine.getBusinessInsights(refDate, range);
      return { ok: true as const, model: buildManagerSurfaceModel(insights, lang, range) };
    } catch (err) {
      // Honest terminal error — never a legacy fallback, never a crash.
      // eslint-disable-next-line no-console
      console.warn('[intelligence] business manager surface failed:', err);
      return { ok: false as const };
    }
    // refreshSeq forces a deterministic re-evaluation on manual refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, refDate, range, lang, refreshSeq,
    sales, customers, inventory, repairs, specialOrders, unlocks, layaways,
    customerReturns, expenses, employees, appointments, storeCreditLedger, settings, vendorReturns]);

  // CELLHUB-INTELLIGENCE-I6-C2: proactive presented intelligence from the
  // SAME engine instance (no second engine, no duplicated presentation) —
  // read-only, error-safe, independent of the I4 evaluation above.
  const proactive = useMemo<PresentedInsights | null>(() => {
    try {
      return engine.getPresentedInsights(refDate);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[intelligence] proactive presentation failed:', err);
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, refDate, lang, refreshSeq,
    sales, customers, inventory, repairs, specialOrders, unlocks, layaways,
    customerReturns, expenses, employees, appointments, storeCreditLedger, settings, vendorReturns]);

  const handleRefresh = () => {
    engine.invalidateCache();
    setRefDate(new Date());
    setRefreshSeq((s) => s + 1);
  };

  const headerRight = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <select
        value={range}
        onChange={(e) => setRange(e.target.value as SupportedManagerRange)}
        style={{ background: '#111827', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 8, padding: '6px 10px', fontSize: '0.8rem' }}
      >
        {SUPPORTED_MANAGER_RANGES.map((k) => (
          <option key={k} value={k}>{rangeLabel(k, lang)}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={handleRefresh}
        style={{ background: '#1e293b', color: '#93c5fd', border: '1px solid #334155', borderRadius: 8, padding: '6px 12px', fontSize: '0.8rem', cursor: 'pointer' }}
      >
        ⟳ {ms('refresh', lang)}
      </button>
    </div>
  );

  return (
    <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 10 }}>
            💼 {ms('title', lang)}
            <span style={{ fontSize: '0.65rem', fontWeight: 700, color: TONE_COLORS.neutral.fg, border: `1px solid ${TONE_COLORS.neutral.border}`, borderRadius: 999, padding: '2px 8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {ms('readOnly', lang)}
            </span>
          </h2>
          {result.ok && (
            <div style={{ ...MUTED, marginTop: 4 }}>
              {ms('analyzedPeriod', lang)}: {result.model.rangeLabel} ({result.model.periodLabel})
              {' · '}{ms('generatedAt', lang)}: {refDate.toLocaleString(lang === 'en' ? 'en-US' : lang === 'pt' ? 'pt-BR' : 'es-MX')}
            </div>
          )}
        </div>
        {headerRight}
      </div>

      {/* CELLHUB-INTELLIGENCE-I6-C2: proactive "Today's Intelligence" — shown
          above the approved I4 sections. Independent pipeline; renders its own
          honest empty state and never blocks the I4 content below. */}
      <ProactiveInsightsSection presented={proactive} lang={lang} />

      {!result.ok ? (
        <div style={CARD}>
          <div style={{ color: '#fbbf24', fontSize: '0.9rem' }}>{ms('managerError', lang)}</div>
        </div>
      ) : result.model.noDataText ? (
        <div style={CARD}>
          <div style={{ ...MUTED, fontSize: '0.9rem' }}>{result.model.noDataText}</div>
        </div>
      ) : (
        <>
          {/* Part 7 visual priority: focus → critical alerts → score/confidence
              → risks → opportunities → actions → health → brief. */}
          <TodayFocusCard model={result.model} lang={lang} />
          <ManagerAlerts model={result.model} lang={lang} />
          <ManagerOverview model={result.model} />
          <ManagerOpportunities model={result.model} lang={lang} />
          <ProposedActions model={result.model} lang={lang} />
          <BusinessHealthGrid model={result.model} lang={lang} />
          <DataConfidenceNotice model={result.model} />
          <ExecutiveSummary model={result.model} lang={lang} />
          <BusinessBriefSection model={result.model} lang={lang} />
        </>
      )}
    </div>
  );
}
