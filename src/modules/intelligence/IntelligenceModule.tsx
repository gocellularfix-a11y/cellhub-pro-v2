// CellHub Intelligence — Decision-First Dashboard
// R-INTEL-2-DASHBOARD
//
// Layout: Chat → Today Summary → Smart Actions → Top Insight → Key Numbers → Alerts → Customer Lookup

import { useMemo, useState, useCallback } from 'react';
import { useApp } from '@/store/AppProvider';
import {
  IntelligenceEngine,
  type EngineResult,
  type CustomerHistorySummary,
  summarizeDashboard,
  summarizeCustomerHistory,
} from '@/services/intelligence';
import IntelligenceChat from './IntelligenceChat';
import { formatCurrency } from '@/utils/currency';
import { matchesSearch } from '@/utils/fuzzyMatch';
import { useTranslation } from '@/i18n';

const CARD_BG   = '#111827';
const CARD_BORDER = '#1F2937';
const PAGE_BG   = '#0B1220';

// Day name localization map for the top-insight sentence.
const DAY_LOCAL: Record<string, Record<string, string>> = {
  es: { Sunday: 'Domingo', Monday: 'Lunes', Tuesday: 'Martes', Wednesday: 'Miércoles', Thursday: 'Jueves', Friday: 'Viernes', Saturday: 'Sábado' },
  pt: { Sunday: 'Domingo', Monday: 'Segunda', Tuesday: 'Terça', Wednesday: 'Quarta', Thursday: 'Quinta', Friday: 'Sexta', Saturday: 'Sábado' },
};

export default function IntelligenceModule() {
  const { state } = useApp();
  const {
    sales, customers, inventory, repairs,
    specialOrders, unlocks, layaways, customerReturns,
    currentStoreId, consolidatedView,
  } = state;
  const { locale, t } = useTranslation();
  const engineLang: 'en' | 'es' | 'pt' = locale as 'en' | 'es' | 'pt';
  const apiLang: 'es' | 'en' = locale === 'pt' ? 'en' : locale as 'es' | 'en';

  const [refreshKey, setRefreshKey] = useState(0);
  const [lookupQuery, setLookupQuery] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [externalQuery, setExternalQuery] = useState<{ text: string; seq: number } | undefined>(undefined);

  const engine = useMemo(() => {
    return new IntelligenceEngine(
      sales, customers, inventory, repairs,
      { lang: engineLang, storeId: consolidatedView ? undefined : currentStoreId, enableAlerts: true, enableScoring: true, cacheTimeoutMinutes: 15 },
      { specialOrders, unlocks, layaways, customerReturns },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sales, customers, inventory, repairs, specialOrders, unlocks, layaways, customerReturns, locale, currentStoreId, consolidatedView, refreshKey]);

  const result: EngineResult = useMemo(() => engine.analyze(), [engine]);

  const nlgSummary = useMemo(() => summarizeDashboard(result, locale as 'en' | 'es' | 'pt'), [result, locale]);
  void nlgSummary; // available for future use

  // ── New engine data (decision layer) ──────────────────────
  const reorderRecs  = useMemo(() => engine.getReorderRecommendations(), [engine]);
  const contactPreds = useMemo(() => engine.getNextVisitPredictions(5), [engine]);
  const missedRev    = useMemo(() => engine.getMissedRevenue(), [engine]);
  const productOpps  = useMemo(() => engine.getProductOpportunities(3), [engine]);

  // Today's sales (current calendar day).
  const todaySales = useMemo(() => {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    return sales.filter(s => new Date((s as any).createdAt).getTime() >= todayStart.getTime() && (s as any).status !== 'voided');
  }, [sales]);
  const todayRevenue  = useMemo(() => todaySales.reduce((sum, s) => sum + ((s as any).total || 0), 0), [todaySales]);

  // Biggest single profit-leak signal.
  const biggestLeak = useMemo(() =>
    Math.max(missedRev.slowDayLossCents, missedRev.slowHourLossCents, missedRev.deadStockLockedCents),
  [missedRev]);

  // Top insight — single sentence.
  const topInsight = useMemo(() => {
    const localDay = DAY_LOCAL[locale]?.[missedRev.slowestDayName] ?? missedRev.slowestDayName;
    if (missedRev.slowDayLossCents > 0)
      return t('intelligence.dash.insightSlowDay', localDay, formatCurrency(missedRev.slowDayLossCents));
    const risky = reorderRecs.find(r => r.lostRevenueRiskCents > 0);
    if (risky)
      return t('intelligence.dash.insightReorder', risky.name, formatCurrency(risky.lostRevenueRiskCents));
    return t('intelligence.dash.insightAllGood');
  }, [missedRev, reorderRecs, locale, t]);

  // Alerts list.
  const alertItems = useMemo(() => {
    const a: Array<{ label: string; color: string }> = [];
    const low   = result.kpiDashboard.inventory.lowStockCount;
    const dead  = result.kpiDashboard.inventory.deadStockCount;
    const over  = result.kpiDashboard.repairs.overdue;
    if (low  > 0) a.push({ label: t('intelligence.dash.alertLowStock', low),   color: '#F59E0B' });
    if (dead > 0) a.push({ label: t('intelligence.dash.alertDeadStock', dead), color: '#EF4444' });
    if (over > 0) a.push({ label: t('intelligence.dash.alertRepairs', over),   color: '#F97316' });
    return a;
  }, [result, t]);

  // Customer lookup.
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

  // Quick-action chip fires a query into the chat.
  const fireChip = useCallback((queryKey: string) => {
    setExternalQuery({ text: t(queryKey), seq: Date.now() });
  }, [t]);

  const kpi = result.kpiDashboard;
  const totalAlerts = kpi.inventory.lowStockCount + kpi.repairs.overdue;

  return (
    <div className="space-y-3 p-3 pb-8" style={{ background: PAGE_BG, minHeight: '100%' }}>

      {/* ── 1. CHAT ─────────────────────────────────────────── */}
      <div>
        <IntelligenceChat engine={engine} customers={customers} lang={apiLang} externalQuery={externalQuery} />

        {/* Quick-action chips */}
        <div className="flex flex-wrap gap-2 mt-2 px-1">
          <QuickChip label={t('intelligence.dash.buyTitle')}     color="#10B981" onClick={() => fireChip('intelligence.dash.quickBuy')} />
          <QuickChip label={t('intelligence.dash.contactTitle')} color="#3B82F6" onClick={() => fireChip('intelligence.dash.quickContact')} />
          <QuickChip label={t('intelligence.dash.profitTitle')}  color="#EF4444" onClick={() => fireChip('intelligence.dash.quickProfit')} />
          <QuickChip label={t('intelligence.dash.sellTitle')}    color="#8B5CF6" onClick={() => fireChip('intelligence.dash.quickSell')} />
        </div>
      </div>

      {/* ── 2. TODAY SUMMARY ────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label={t('intelligence.dash.todaySales')}     value={formatCurrency(todayRevenue)}            accent="#10B981" />
        <SummaryCard label={t('intelligence.dash.todayOrders')}    value={String(todaySales.length)}               accent="#3B82F6" />
        <SummaryCard label={t('intelligence.dash.todayAlerts')}    value={String(totalAlerts)}                     accent="#F59E0B" />
        <SummaryCard label={t('intelligence.dash.todayCustomers')} value={String(kpi.customers.total)}             accent="#8B5CF6" />
      </div>

      {/* ── 3. SMART ACTIONS ────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {/* What to Buy */}
        <SmartCard
          title={t('intelligence.dash.buyTitle')}
          value={reorderRecs.length > 0 ? String(reorderRecs.length) : '—'}
          sub={reorderRecs.length > 0 ? t('intelligence.dash.buySub', reorderRecs.length) : t('intelligence.dash.noneYet')}
          detail={reorderRecs.length > 0 && reorderRecs.reduce((s, r) => s + r.lostRevenueRiskCents, 0) > 0
            ? `${formatCurrency(reorderRecs.reduce((s, r) => s + r.lostRevenueRiskCents, 0))} ${t('intelligence.dash.buyRisk')}`
            : undefined}
          accent="#10B981"
          btnLabel={t('intelligence.dash.viewBtn')}
          onBtn={() => fireChip('intelligence.dash.quickBuy')}
        />

        {/* Who to Contact */}
        <SmartCard
          title={t('intelligence.dash.contactTitle')}
          value={contactPreds.length > 0 ? String(contactPreds.length) : '—'}
          sub={contactPreds.length > 0 ? t('intelligence.dash.contactSub', contactPreds.length) : t('intelligence.dash.noneYet')}
          accent="#3B82F6"
          btnLabel={t('intelligence.dash.viewBtn')}
          onBtn={() => fireChip('intelligence.dash.quickContact')}
        />

        {/* Profit Leaks */}
        <SmartCard
          title={t('intelligence.dash.profitTitle')}
          value={biggestLeak > 0 ? formatCurrency(biggestLeak) : '—'}
          sub={biggestLeak > 0 ? t('intelligence.dash.profitSub') : t('intelligence.dash.noneYet')}
          accent="#EF4444"
          btnLabel={t('intelligence.dash.viewBtn')}
          onBtn={() => fireChip('intelligence.dash.quickProfit')}
        />

        {/* What to Sell */}
        <SmartCard
          title={t('intelligence.dash.sellTitle')}
          value={productOpps.length > 0 ? String(productOpps.length) : '—'}
          sub={productOpps.length > 0 ? t('intelligence.dash.sellSub', productOpps.length) : t('intelligence.dash.noneYet')}
          detail={productOpps.length > 0 && productOpps.reduce((s, o) => s + o.impactCents, 0) > 0
            ? formatCurrency(productOpps.reduce((s, o) => s + o.impactCents, 0))
            : undefined}
          accent="#8B5CF6"
          btnLabel={t('intelligence.dash.viewBtn')}
          onBtn={() => fireChip('intelligence.dash.quickSell')}
        />
      </div>

      {/* ── 4. TOP INSIGHT ──────────────────────────────────── */}
      <div className="rounded-lg px-4 py-3 border text-sm font-medium text-slate-200"
        style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
        {topInsight}
      </div>

      {/* ── 5. KEY NUMBERS ──────────────────────────────────── */}
      <div>
        <p className="text-xs text-slate-500 uppercase tracking-wider mb-2 px-1">
          {t('intelligence.dash.keyTitle')}
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MiniCard label={t('intelligence.dash.keyRevenue')}      value={formatCurrency(kpi.revenue.current)} />
          <MiniCard label={t('intelligence.dash.keyTransactions')} value={String(kpi.transactions.count)} />
          <MiniCard label={t('intelligence.dash.keyAvgTicket')}    value={formatCurrency(kpi.transactions.avgSize)} />
          <MiniCard label={t('intelligence.dash.keyDeadStock')}    value={String(kpi.inventory.deadStockCount)} accent={kpi.inventory.deadStockCount > 0 ? '#EF4444' : undefined} />
        </div>
      </div>

      {/* ── 6. ALERTS ───────────────────────────────────────── */}
      <div className="rounded-lg border p-4" style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
          {t('intelligence.dash.alertsTitle')}
        </p>
        {alertItems.length === 0
          ? <p className="text-sm text-slate-400">{t('intelligence.dash.noAlerts')}</p>
          : (
            <div className="space-y-2">
              {alertItems.map((a, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: a.color }} />
                  <span className="text-slate-200">{a.label}</span>
                </div>
              ))}
            </div>
          )}
      </div>

      {/* ── Customer Lookup ──────────────────────────────────── */}
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

function QuickChip({ label, color, onClick }: { label: string; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1 rounded-full text-xs font-medium transition hover:opacity-80 active:scale-95"
      style={{ background: `${color}22`, color, border: `1px solid ${color}44` }}
    >
      {label}
    </button>
  );
}

function SummaryCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-lg p-4 border flex flex-col gap-1" style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
      <span className="text-xs text-slate-400 uppercase tracking-wide">{label}</span>
      <span className="text-2xl font-bold" style={{ color: accent }}>{value}</span>
    </div>
  );
}

function SmartCard({
  title, value, sub, detail, accent, btnLabel, onBtn,
}: {
  title: string; value: string; sub: string; detail?: string;
  accent: string; btnLabel: string; onBtn: () => void;
}) {
  return (
    <div className="rounded-lg p-4 border flex flex-col gap-2"
      style={{ background: CARD_BG, borderColor: accent + '44' }}>
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{title}</p>
      <p className="text-3xl font-bold" style={{ color: accent }}>{value}</p>
      <p className="text-xs text-slate-400">{sub}</p>
      {detail && <p className="text-xs font-medium" style={{ color: accent }}>{detail}</p>}
      <button
        onClick={onBtn}
        className="mt-auto self-start text-xs px-3 py-1.5 rounded font-medium transition hover:opacity-80"
        style={{ background: `${accent}22`, color: accent, border: `1px solid ${accent}44` }}
      >
        {btnLabel}
      </button>
    </div>
  );
}

function MiniCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-lg p-3 border" style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
      <p className="text-[0.68rem] text-slate-400 uppercase tracking-wide">{label}</p>
      <p className="text-lg font-bold mt-0.5" style={{ color: accent ?? '#E2E8F0' }}>{value}</p>
    </div>
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
