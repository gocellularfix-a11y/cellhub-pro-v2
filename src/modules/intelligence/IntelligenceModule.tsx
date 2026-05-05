// CellHub Intelligence — Operator Console
// R-INTELLIGENCE-UI-OPERATOR-REDESIGN + R-INTELLIGENCE-QUEUE-UI-FIX
//
// Action-first Windows desktop layout:
//   1. Top Operator Summary (compact, action-oriented)
//   2. Make Money tiles
//   3. Ask Your Shop chat (owns its own queue UI + handlers)
//   4. WhatsApp Actions
//   5. Promote Inventory
//   6. Customer Lookup (preserved)
//
// Queue rendering and execution are owned by IntelligenceChat — this
// module does not duplicate that logic, does not touch localStorage,
// and does not execute action payloads.

import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { useApp } from '@/store/AppProvider';
import {
  IntelligenceEngine,
  type EngineResult,
  type CustomerHistorySummary,
  summarizeCustomerHistory,
} from '@/services/intelligence';
import IntelligenceChat from './IntelligenceChat';
import { formatCurrency } from '@/utils/currency';
import { matchesSearch } from '@/utils/fuzzyMatch';
import { useTranslation } from '@/i18n';

const CARD_BG     = '#111827';
const CARD_BORDER = '#1F2937';
const PAGE_BG     = '#0B1220';

// Day name localization map for the top-insight sentence.
const DAY_LOCAL: Record<string, Record<string, string>> = {
  es: { Sunday: 'Domingo', Monday: 'Lunes', Tuesday: 'Martes', Wednesday: 'Miércoles', Thursday: 'Jueves', Friday: 'Viernes', Saturday: 'Sábado' },
  pt: { Sunday: 'Domingo', Monday: 'Segunda', Tuesday: 'Terça', Wednesday: 'Quarta', Thursday: 'Quinta', Friday: 'Sexta', Saturday: 'Sábado' },
};

export default function IntelligenceModule() {
  const { state } = useApp();
  const {
    sales, customers, inventory, repairs,
    specialOrders, unlocks, layaways, customerReturns, expenses, employees, appointments,
    currentStoreId, consolidatedView,
  } = state;
  const { locale, t } = useTranslation();
  const engineLang: 'en' | 'es' | 'pt' = locale as 'en' | 'es' | 'pt';
  const apiLang: 'es' | 'en' = locale === 'pt' ? 'en' : locale as 'es' | 'en';

  const [refreshKey, setRefreshKey] = useState(0);
  const [lookupQuery, setLookupQuery] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [externalQuery, setExternalQuery] = useState<{ text: string; seq: number } | undefined>(undefined);

  // Promote Inventory state
  const [productSearch, setProductSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<{ id: string; name: string } | null>(null);

  // R-PERF-INTELLIGENCE-CACHE: useRef-stable engine — preserved verbatim.
  const engineRef = useRef<IntelligenceEngine | null>(null);
  const engineConfigSigRef = useRef<string>('');
  const engineConfigSig = `${engineLang}|${currentStoreId ?? ''}|${consolidatedView ? '1' : '0'}|${refreshKey}`;

  if (!engineRef.current || engineConfigSigRef.current !== engineConfigSig) {
    engineRef.current = new IntelligenceEngine(
      sales, customers, inventory, repairs,
      { lang: engineLang, storeId: consolidatedView ? undefined : currentStoreId, enableAlerts: true, enableScoring: true, cacheTimeoutMinutes: 15 },
      { specialOrders, unlocks, layaways, customerReturns, expenses, employees, appointments },
    );
    engineConfigSigRef.current = engineConfigSig;
  }
  const engine = engineRef.current;

  engine.updateData(sales, customers, inventory, repairs, {
    specialOrders, unlocks, layaways, customerReturns, expenses, employees, appointments,
  });

  const result: EngineResult = useMemo(
    () => engine.analyze(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, sales, customers, inventory, repairs, specialOrders, unlocks, layaways, customerReturns],
  );

  // ── Engine-derived data ──────────────────────────────────
  const reorderRecs  = useMemo(() => engine.getReorderRecommendations(), [engine]);
  const productOpps  = useMemo(() => engine.getProductOpportunities(3), [engine]);
  const missedRev    = useMemo(() => engine.getMissedRevenue(), [engine]);

  const todaySales = useMemo(() => {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    return sales.filter(s => new Date((s as any).createdAt).getTime() >= todayStart.getTime() && (s as any).status !== 'voided');
  }, [sales]);
  const todayRevenue = useMemo(() => todaySales.reduce((sum, s) => sum + ((s as any).total || 0), 0), [todaySales]);

  const biggestLeak = useMemo(() =>
    Math.max(missedRev.slowDayLossCents, missedRev.slowHourLossCents, missedRev.deadStockLockedCents),
  [missedRev]);

  const topInsight = useMemo(() => {
    const localDay = DAY_LOCAL[locale]?.[missedRev.slowestDayName] ?? missedRev.slowestDayName;
    if (missedRev.slowDayLossCents > 0)
      return t('intelligence.dash.insightSlowDay', localDay, formatCurrency(missedRev.slowDayLossCents));
    const risky = reorderRecs.find(r => r.lostRevenueRiskCents > 0);
    if (risky)
      return t('intelligence.dash.insightReorder', risky.name, formatCurrency(risky.lostRevenueRiskCents));
    return t('intelligence.dash.insightAllGood');
  }, [missedRev, reorderRecs, locale, t]);

  // Customer lookup
  const handleRefresh = useCallback(() => setRefreshKey(k => k + 1), []);
  const matches = useMemo(() => {
    const q = lookupQuery.trim();
    if (q.length < 2) return [];
    return customers
      .filter(c => matchesSearch(q, c.name, c.phone, (c as { customerNumber?: string }).customerNumber))
      .slice(0, 8);
  }, [lookupQuery, customers]);

  const history: CustomerHistorySummary | null = useMemo(() => {
    if (!selectedCustomerId) return null;
    return engine.getCustomerHistory(selectedCustomerId);
  }, [engine, selectedCustomerId]);

  // Product matches for Promote Inventory
  const productMatches = useMemo(() => {
    const q = productSearch.trim();
    if (q.length < 2) return [];
    return inventory
      .filter(i =>
        matchesSearch(q, i.name, i.sku, (i as { brand?: string }).brand)
        && (i as { qty?: number }).qty !== 0,
      )
      .slice(0, 8);
  }, [productSearch, inventory]);

  // Fire a chat query (uses externalQuery seq pattern already wired in chat).
  const fireChat = useCallback((text: string) => {
    setExternalQuery({ text, seq: Date.now() });
  }, []);

  const fireChipKey = useCallback((queryKey: string) => {
    fireChat(t(queryKey));
  }, [t, fireChat]);

  // R-DAILY-BRIEF-AUTO-V1: fire the daily brief once per store per day.
  // Read-only — handler does not enqueue. Storage key scoped by storeId so
  // multi-store operators see the brief once per shop. Failures (incognito,
  // quota) silently skip; brief stays manually accessible via the chat.
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const sid = currentStoreId || 'default';
    const key = `dailyBriefLastSeen:${sid}:${today}`;
    try {
      if (localStorage.getItem(key)) return;
      fireChat('daily brief');
      localStorage.setItem(key, '1');
    } catch {
      // localStorage unavailable — skip silently.
    }
  }, [currentStoreId, fireChat]);

  // Refs to scroll-target panels
  const promoteRef = useRef<HTMLDivElement>(null);
  const focusPromote = useCallback(() => {
    promoteRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const handleGenerateCampaign = useCallback(() => {
    if (!selectedProduct) return;
    fireChat(`${t('intelligence.console.queryPromoteThis')} ${selectedProduct.name}`);
  }, [selectedProduct, fireChat, t]);

  const kpi = result.kpiDashboard;
  const totalAlerts = kpi.inventory.lowStockCount + kpi.repairs.overdue;

  return (
    <div className="space-y-3 p-3 pb-8" style={{ background: PAGE_BG, minHeight: '100%' }}>

      {/* ── 1. TOP OPERATOR SUMMARY ─────────────────────────── */}
      <div
        className="rounded-lg border px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2 justify-between"
        style={{ background: CARD_BG, borderColor: CARD_BORDER }}
      >
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="text-[10px] font-semibold text-slate-500 tracking-widest">
            {t('intelligence.console.todayLabel')}
          </span>
          <span className="text-base font-bold text-emerald-400">
            {formatCurrency(todayRevenue)} <span className="text-xs font-normal text-slate-500">{t('intelligence.console.salesAbbr')}</span>
          </span>
          <span className="text-sm text-slate-300">
            {todaySales.length} <span className="text-xs text-slate-500">{t('intelligence.console.ordersAbbr')}</span>
          </span>
          <span className={`text-sm ${totalAlerts > 0 ? 'text-amber-400' : 'text-slate-400'}`}>
            {totalAlerts} <span className="text-xs text-slate-500">{t('intelligence.console.alertsAbbr')}</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">{t('intelligence.console.biggestOpportunity')}</span>
          <span className="text-xs font-medium text-purple-300">
            {productOpps.length > 0
              ? t(
                  'intelligence.console.opportunitiesFound',
                  productOpps.length,
                  formatCurrency(productOpps.reduce((s, o) => s + o.impactCents, 0)),
                )
              : (biggestLeak > 0 ? topInsight : t('intelligence.dash.noneYet'))
            }
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ConsoleBtn label={t('intelligence.console.collectPayments')} accent="#10B981"
            onClick={() => fireChipKey('intelligence.console.queryContactToday')} />
          <ConsoleBtn label={t('intelligence.console.promoteProduct')} accent="#8B5CF6"
            onClick={focusPromote} />
          <ConsoleBtn label={t('intelligence.console.contactCustomers')} accent="#3B82F6"
            onClick={() => fireChipKey('intelligence.console.queryContactToday')} />
        </div>
      </div>

      {/* ── 2. MAKE MONEY TILES ─────────────────────────────── */}
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 px-1">
          {t('intelligence.console.makeMoneyTitle')}
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <MoneyTile
            title={t('intelligence.console.collectMoneyTitle')}
            sub={t('intelligence.console.collectMoneySub')}
            accent="#10B981"
            onClick={() => fireChipKey('intelligence.console.queryContactToday')}
          />
          <MoneyTile
            title={t('intelligence.console.promoteProduct')}
            sub={t('intelligence.console.promoteSub')}
            accent="#8B5CF6"
            onClick={focusPromote}
          />
          <MoneyTile
            title={t('intelligence.console.contactCustomers')}
            sub={t('intelligence.console.contactSub')}
            accent="#3B82F6"
            onClick={() => fireChipKey('intelligence.console.queryContactToday')}
          />
          <MoneyTile
            title={t('intelligence.console.fixProfitTitle')}
            sub={t('intelligence.console.fixProfitSub')}
            accent="#EF4444"
            onClick={() => fireChipKey('intelligence.dash.quickProfit')}
          />
        </div>
      </div>

      {/* ── 3. ASK YOUR SHOP — chat owns its own queue UI/handlers ── */}
      <div className="space-y-2">
        <div className="rounded-lg border p-3" style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
          <p className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
            {t('intelligence.console.askTitle')}
          </p>
          <p className="text-[10px] text-slate-500 mb-2">{t('intelligence.console.quickQuestions')}</p>
          <div className="flex flex-wrap gap-1.5">
            <Chip label={t('intelligence.console.chipToday')}        color="#10B981" onClick={() => fireChipKey('intelligence.console.queryToday')} />
            <Chip label={t('intelligence.console.chipWhoContact')}   color="#3B82F6" onClick={() => fireChipKey('intelligence.console.queryContactToday')} />
            <Chip label={t('intelligence.console.chipWhatSell')}     color="#8B5CF6" onClick={() => fireChipKey('intelligence.dash.quickSell')} />
            <Chip label={t('intelligence.console.chipProfit')}       color="#EF4444" onClick={() => fireChipKey('intelligence.dash.quickProfit')} />
            <Chip label={t('intelligence.console.chipPromote')}      color="#A855F7" onClick={() => fireChipKey('intelligence.console.queryPromoteGeneric')} />
            <Chip label={t('intelligence.console.chipReady')}        color="#F59E0B" onClick={() => fireChipKey('intelligence.console.queryReadyRepairs')} />
          </div>
        </div>
        <IntelligenceChat engine={engine} customers={customers} lang={apiLang} externalQuery={externalQuery} />
      </div>

      {/* ── 4. WHATSAPP ACTIONS + 5. PROMOTE INVENTORY ──────── */}
      <div className="grid grid-cols-12 gap-3">

        {/* WhatsApp Actions */}
        <div className="col-span-12 lg:col-span-5 rounded-lg border p-3"
          style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
          <p className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
            {t('intelligence.console.whatsappTitle')}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <WaBtn label={t('intelligence.console.waCollect')}      accent="#10B981" onClick={() => fireChipKey('intelligence.console.queryPendingPayments')} />
            <WaBtn label={t('intelligence.console.waNotifyRepair')} accent="#3B82F6" onClick={() => fireChipKey('intelligence.console.queryReadyRepairs')} />
            <WaBtn label={t('intelligence.console.waSendPromo')}    accent="#8B5CF6" onClick={() => fireChipKey('intelligence.console.queryPromoteGeneric')} />
            <WaBtn label={t('intelligence.console.waLayaway')}      accent="#F59E0B" onClick={() => fireChipKey('intelligence.console.queryPendingLayaways')} />
          </div>
        </div>

        {/* Promote Inventory */}
        <div ref={promoteRef} className="col-span-12 lg:col-span-7 rounded-lg border p-3"
          style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
          <p className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
            {t('intelligence.console.promoteInvTitle')}
          </p>
          {!selectedProduct ? (
            <div>
              <input
                type="text"
                value={productSearch}
                onChange={e => setProductSearch(e.target.value)}
                placeholder={t('intelligence.console.searchProduct')}
                className="w-full bg-surface-700 text-slate-200 rounded px-3 py-2 text-sm border border-surface-600 focus:outline-none focus:border-purple-500"
              />
              {productMatches.length > 0 ? (
                <div className="mt-2 rounded border border-surface-700 divide-y divide-surface-700 max-h-44 overflow-y-auto">
                  {productMatches.map(p => (
                    <button
                      key={p.id}
                      onClick={() => { setSelectedProduct({ id: p.id, name: p.name }); setProductSearch(''); }}
                      className="w-full text-left px-3 py-2 hover:bg-surface-700 transition"
                    >
                      <div className="text-sm text-slate-200 font-medium truncate">{p.name}</div>
                      <div className="text-[11px] text-slate-500 flex gap-3">
                        <span>SKU {p.sku}</span>
                        {(p as { qty?: number }).qty !== undefined && <span>Qty {(p as { qty?: number }).qty}</span>}
                        {(p as { price?: number }).price !== undefined && <span>{formatCurrency((p as { price?: number }).price ?? 0)}</span>}
                      </div>
                    </button>
                  ))}
                </div>
              ) : productSearch.trim().length < 2 ? (
                <p className="text-[11px] text-slate-500 italic mt-2">{t('intelligence.console.promoteInvEmpty')}</p>
              ) : null}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 px-3 py-2 rounded border border-purple-500/30 bg-purple-500/5">
                <div className="min-w-0">
                  <div className="text-sm text-slate-100 font-medium truncate">{selectedProduct.name}</div>
                </div>
                <button
                  onClick={() => setSelectedProduct(null)}
                  className="text-[10px] px-2 py-0.5 rounded border border-slate-600 text-slate-400 hover:bg-surface-600 shrink-0"
                >
                  {t('intelligence.console.changeProduct')}
                </button>
              </div>
              <button
                onClick={handleGenerateCampaign}
                className="w-full px-3 py-2 rounded text-sm font-medium bg-purple-600 hover:bg-purple-500 text-white transition"
              >
                🚀 {t('intelligence.console.generateCampaign')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── 6. CUSTOMER LOOKUP (preserved) ──────────────────── */}
      <div className="rounded-lg p-4 border" style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-200">🔍 {t('intelligence.customerHistory')}</h3>
            <p className="text-xs text-slate-400">{t('intelligence.searchPlaceholder')}</p>
          </div>
          {selectedCustomerId && (
            <button
              onClick={() => { setSelectedCustomerId(null); setLookupQuery(''); }}
              className="px-2 py-1 text-xs rounded bg-surface-700 hover:bg-surface-600 text-slate-300"
            >
              {t('intelligence.clear')}
            </button>
          )}
        </div>

        {!selectedCustomerId && (
          <div>
            <input
              type="text"
              value={lookupQuery}
              onChange={e => setLookupQuery(e.target.value)}
              placeholder={t('intelligence.searchPlaceholder')}
              className="w-full bg-surface-700 text-slate-200 rounded px-3 py-2 text-sm border border-surface-600 focus:outline-none focus:border-blue-500"
            />
            {matches.length > 0 && (
              <div className="mt-2 rounded border border-surface-700 divide-y divide-surface-700 max-h-64 overflow-y-auto">
                {matches.map(c => (
                  <button key={c.id} onClick={() => setSelectedCustomerId(c.id)}
                    className="w-full text-left px-3 py-2 hover:bg-surface-700 transition">
                    <div className="text-sm text-slate-200 font-medium">{c.name}</div>
                    <div className="text-xs text-slate-400 flex gap-3">
                      {c.phone && <span>📱 {c.phone}</span>}
                      {(c as { customerNumber?: string }).customerNumber && (
                        <span>#{(c as { customerNumber?: string }).customerNumber}</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
            {lookupQuery.trim().length >= 2 && matches.length === 0 && (
              <div className="mt-2 text-xs text-slate-500 px-1">{t('intelligence.noMatches')}</div>
            )}
          </div>
        )}

        {history && <CustomerHistoryCard history={history} />}
      </div>

      {/* Refresh button (bottom) */}
      <div className="flex justify-end">
        <button
          onClick={handleRefresh}
          className="text-xs px-3 py-1.5 rounded border border-surface-700 hover:border-surface-500 text-slate-400 hover:text-slate-300 transition"
        >
          🔄 {t('intelligence.refresh')}
        </button>
      </div>
    </div>
  );
}

// ── Presentational sub-components ─────────────────────────────

function ConsoleBtn({ label, accent, onClick }: { label: string; accent: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 rounded text-xs font-semibold transition hover:opacity-90 active:scale-95"
      style={{ background: accent, color: '#0B1220' }}
    >
      {label}
    </button>
  );
}

function MoneyTile({ title, sub, accent, onClick }: { title: string; sub: string; accent: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-left rounded-lg border p-3 hover:opacity-90 active:scale-[0.98] transition"
      style={{ background: CARD_BG, borderColor: accent + '55' }}
    >
      <p className="text-sm font-semibold" style={{ color: accent }}>{title}</p>
      <p className="text-[11px] text-slate-400 mt-1 leading-snug">{sub}</p>
    </button>
  );
}

function Chip({ label, color, onClick }: { label: string; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-2.5 py-0.5 rounded-full text-[11px] font-medium transition hover:opacity-80 active:scale-95"
      style={{ background: `${color}22`, color, border: `1px solid ${color}44` }}
    >
      {label}
    </button>
  );
}

function WaBtn({ label, accent, onClick }: { label: string; accent: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-2 rounded text-xs font-medium transition hover:opacity-90 active:scale-95 text-left"
      style={{ background: `${accent}1F`, color: accent, border: `1px solid ${accent}55` }}
    >
      {label}
    </button>
  );
}

// ── Customer History Card (unchanged from original) ────────────
interface CustomerHistoryCardProps { history: CustomerHistorySummary; }

function CustomerHistoryCard({ history }: CustomerHistoryCardProps) {
  const { locale, t } = useTranslation();
  const dateLoc = ({ en: 'en-US', es: 'es-MX', pt: 'pt-BR' } as Record<string, string>)[locale] ?? 'en-US';
  const fmtDate = (d: Date | null) =>
    d ? d.toLocaleDateString(dateLoc, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
  const lowCostCoverage = history.costCoverage < 0.5 && history.visitCount > 0;
  const summarySentence = summarizeCustomerHistory(history, locale as 'en' | 'es' | 'pt');

  return (
    <div className="space-y-4">
      <div className="border-t border-surface-700 pt-3 pb-1">
        <p className="text-sm text-slate-200 leading-relaxed bg-blue-500/5 border border-blue-500/20 rounded p-3">
          💬 {summarySentence}
        </p>
      </div>
      <div>
        <div className="flex items-start justify-between">
          <div>
            <h4 className="text-xl font-bold text-slate-100">{history.customer.name}</h4>
            <div className="text-xs text-slate-400 mt-1 flex gap-3 flex-wrap">
              {history.customer.phone && <span>📱 {history.customer.phone}</span>}
              {history.customer.customerNumber && <span>#{history.customer.customerNumber}</span>}
              {history.customer.carrier && <span>📡 {history.customer.carrier}</span>}
            </div>
          </div>
          <div className="text-right text-xs text-slate-400">
            <div>{t('intelligence.firstVisit')}: {fmtDate(history.firstVisit)}</div>
            <div>{t('intelligence.lastVisit')}: {fmtDate(history.lastVisit)}</div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <MetricTile label={t('intelligence.transactions')} value={String(history.visitCount)}
          sub={history.avgDaysBetweenVisits !== null ? t('intelligence.everyXDays', history.avgDaysBetweenVisits) : undefined} />
        <MetricTile label={t('intelligence.totalSpent')} value={formatCurrency(history.netRevenue)}
          sub={history.totalRefunded > 0 ? t('intelligence.refundedX', formatCurrency(history.totalRefunded)) : undefined} />
        <MetricTile label={t('intelligence.businessProfit')} value={formatCurrency(history.profit)}
          sub={t('intelligence.marginLabel', history.margin.toFixed(1))} accent="emerald" />
        <MetricTile label={t('intelligence.avgTicket')} value={formatCurrency(history.avgTicket)}
          sub={history.preferredPaymentMethod ? t('intelligence.prefersX', history.preferredPaymentMethod) : undefined} />
      </div>
      {lowCostCoverage && (
        <div className="text-xs rounded px-3 py-2 bg-amber-500/10 border border-amber-500/30 text-amber-300">
          ⚠️ {t('intelligence.approxProfit', Math.round(history.costCoverage * 100))}
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
        <InfoRow icon="🔧" label={t('intelligence.repairs')}
          value={history.linkedEntities.repairCount > 0 ? `${history.linkedEntities.repairCount} (${formatCurrency(history.linkedEntities.repairTotalValue)})` : '0'} />
        <InfoRow icon="📦" label={t('intelligence.specialOrders')} value={String(history.linkedEntities.specialOrderCount)} />
        <InfoRow icon="🔓" label={t('intelligence.unlocks')} value={String(history.linkedEntities.unlockCount)} />
        <InfoRow icon="🏷️" label={t('intelligence.layaways')} value={String(history.linkedEntities.layawayCount)} />
        <InfoRow icon="🎁" label={t('intelligence.loyaltyPoints')} value={history.customer.loyaltyPoints.toLocaleString()} />
        <InfoRow icon="💳" label={t('intelligence.storeCredit')} value={formatCurrency(history.customer.storeCredit)} />
      </div>
      {history.linkedEntities.activeBalance > 0 && (
        <div className="text-xs rounded px-3 py-2 bg-red-500/10 border border-red-500/30 text-red-300">
          💰 {t('intelligence.outstandingBalance')}: <strong>{formatCurrency(history.linkedEntities.activeBalance)}</strong>
        </div>
      )}
      {history.topItems.length > 0 && (
        <div>
          <h5 className="text-sm font-semibold text-slate-300 mb-2">{t('intelligence.top5Items')}</h5>
          <div className="rounded border border-surface-700 divide-y divide-surface-700">
            {history.topItems.map((item, idx) => (
              <div key={idx} className="px-3 py-2 flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 w-4">#{idx + 1}</span>
                  <span className="text-slate-200">{item.name}</span>
                </div>
                <div className="text-right">
                  <div className="text-slate-200">{formatCurrency(item.revenue)}</div>
                  <div className="text-xs text-slate-500">{item.quantity} {t('intelligence.qty')}</div>
                </div>
              </div>
            ))}
          </div>
          {history.topCategoryByProfit && (
            <div className="text-xs text-slate-400 mt-2">
              {t('intelligence.mostProfitableCategory')}: <strong>{history.topCategoryByProfit}</strong> ({formatCurrency(history.topCategoryProfit)})
            </div>
          )}
        </div>
      )}
      {history.visitCount === 0 && (
        <div className="text-sm text-slate-500 italic text-center py-4">{t('intelligence.noSalesForCustomer')}</div>
      )}
    </div>
  );
}

function MetricTile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: 'emerald' }) {
  const valueClass = accent === 'emerald' ? 'text-emerald-400' : 'text-slate-100';
  return (
    <div className="bg-surface-900/50 rounded p-3 border border-surface-700">
      <div className="text-[0.68rem] text-slate-400 uppercase tracking-wide">{label}</div>
      <div className={`text-lg font-bold mt-0.5 ${valueClass}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between bg-surface-900/40 rounded px-2 py-1.5 border border-surface-700">
      <span className="text-slate-400">{icon} {label}</span>
      <span className="text-slate-200 font-medium">{value}</span>
    </div>
  );
}
