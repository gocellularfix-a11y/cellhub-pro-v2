// CellHub Intelligence — Module Container
//
// Instantiates IntelligenceEngine from AppState data and renders the dashboard
// + R-INTEL-CUSTOMER-HISTORY customer lookup card.

import { useMemo, useState, useCallback } from 'react';
import { useApp } from '@/store/AppProvider';
import { IntelligenceEngine, type EngineResult, type CustomerHistorySummary } from '@/services/intelligence';
import IntelligenceDashboard from '@/components/ui/IntelligenceDashboard';
import { formatCurrency } from '@/utils/currency';
import { matchesSearch } from '@/utils/fuzzyMatch';

export default function IntelligenceModule() {
  const { state } = useApp();
  const {
    sales, customers, inventory, repairs,
    specialOrders, unlocks, layaways, customerReturns,
    lang, currentStoreId, consolidatedView,
  } = state;

  const es = lang === 'es';

  // Force-refresh trigger — bumped by onRefresh to recompute.
  const [refreshKey, setRefreshKey] = useState(0);

  // Customer lookup state.
  const [lookupQuery, setLookupQuery] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

  // Instantiate engine + run analysis. Memoized on data + refresh key.
  // The schema adapter runs inside the engine constructor, so we pass raw data.
  const engine = useMemo(() => {
    return new IntelligenceEngine(
      sales,
      customers,
      inventory,
      repairs,
      {
        lang: (lang === 'es' ? 'es' : 'en'),
        storeId: consolidatedView ? undefined : currentStoreId,
        enableAlerts: true,
        enableScoring: true,
        cacheTimeoutMinutes: 15,
      },
      {
        specialOrders,
        unlocks,
        layaways,
        customerReturns,
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sales, customers, inventory, repairs, specialOrders, unlocks, layaways, customerReturns, lang, currentStoreId, consolidatedView, refreshKey]);

  const result: EngineResult = useMemo(() => engine.analyze(), [engine]);

  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  // Fuzzy match across name, phone, customerNumber.
  const matches = useMemo(() => {
    const q = lookupQuery.trim();
    if (q.length < 2) return [];
    return customers
      .filter((c) => matchesSearch(q, c.name, c.phone, (c as { customerNumber?: string }).customerNumber))
      .slice(0, 8);
  }, [lookupQuery, customers]);

  const history: CustomerHistorySummary | null = useMemo(() => {
    if (!selectedCustomerId) return null;
    return engine.getCustomerHistory(selectedCustomerId);
  }, [engine, selectedCustomerId]);

  return (
    <div className="space-y-4">
      {/* ── Customer Lookup Card (R-INTEL-CUSTOMER-HISTORY) ─── */}
      <div className="bg-surface-800 rounded-lg p-4 border border-surface-700">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-200">
              🔍 {es ? 'Historial de Cliente' : 'Customer History'}
            </h3>
            <p className="text-xs text-slate-400">
              {es
                ? 'Busca un cliente para ver su historial completo'
                : 'Search a customer to view their full history'}
            </p>
          </div>
          {selectedCustomerId && (
            <button
              onClick={() => {
                setSelectedCustomerId(null);
                setLookupQuery('');
              }}
              className="px-2 py-1 text-xs rounded bg-surface-700 hover:bg-surface-600 text-slate-300"
            >
              {es ? 'Limpiar' : 'Clear'}
            </button>
          )}
        </div>

        {!selectedCustomerId && (
          <div>
            <input
              type="text"
              value={lookupQuery}
              onChange={(e) => setLookupQuery(e.target.value)}
              placeholder={es ? 'Nombre, teléfono o número de cliente…' : 'Name, phone or customer number…'}
              className="w-full bg-surface-700 text-slate-200 rounded px-3 py-2 text-sm border border-surface-600 focus:outline-none focus:border-blue-500"
              autoFocus
            />

            {matches.length > 0 && (
              <div className="mt-2 rounded border border-surface-700 divide-y divide-surface-700 max-h-64 overflow-y-auto">
                {matches.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedCustomerId(c.id)}
                    className="w-full text-left px-3 py-2 hover:bg-surface-700 transition"
                  >
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
              <div className="mt-2 text-xs text-slate-500 px-1">
                {es ? 'Sin resultados' : 'No matches'}
              </div>
            )}
          </div>
        )}

        {history && <CustomerHistoryCard history={history} es={es} />}
      </div>

      {/* ── Main Dashboard ──────────────────────────────────── */}
      <IntelligenceDashboard
        report={result.report}
        healthScore={result.healthScore}
        kpiDashboard={result.kpiDashboard}
        insights={result.insights}
        lang={lang === 'es' ? 'es' : 'en'}
        onRefresh={handleRefresh}
      />
    </div>
  );
}

// ── Customer History Card (rendered below the picker) ────────
interface CustomerHistoryCardProps {
  history: CustomerHistorySummary;
  es: boolean;
}

function CustomerHistoryCard({ history, es }: CustomerHistoryCardProps) {
  const fmtDate = (d: Date | null) =>
    d ? d.toLocaleDateString(es ? 'es-MX' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

  const lowCostCoverage = history.costCoverage < 0.5 && history.visitCount > 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="border-t border-surface-700 pt-3">
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
            <div>{es ? 'Primera visita' : 'First visit'}: {fmtDate(history.firstVisit)}</div>
            <div>{es ? 'Última visita' : 'Last visit'}: {fmtDate(history.lastVisit)}</div>
          </div>
        </div>
      </div>

      {/* Metrics grid — 4 top-line numbers */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <MetricTile
          label={es ? 'Transacciones' : 'Transactions'}
          value={String(history.visitCount)}
          sub={history.avgDaysBetweenVisits !== null
            ? (es ? `Cada ${history.avgDaysBetweenVisits} días` : `Every ${history.avgDaysBetweenVisits} days`)
            : undefined}
        />
        <MetricTile
          label={es ? 'Total Gastado' : 'Total Spent'}
          value={formatCurrency(history.netRevenue)}
          sub={history.totalRefunded > 0
            ? (es ? `Reembolsos: ${formatCurrency(history.totalRefunded)}` : `Refunded: ${formatCurrency(history.totalRefunded)}`)
            : undefined}
        />
        <MetricTile
          label={es ? 'Profit del Negocio' : 'Business Profit'}
          value={formatCurrency(history.profit)}
          sub={`${history.margin.toFixed(1)}% margin`}
          accent="emerald"
        />
        <MetricTile
          label={es ? 'Ticket Promedio' : 'Avg Ticket'}
          value={formatCurrency(history.avgTicket)}
          sub={history.preferredPaymentMethod
            ? (es ? `Prefiere: ${history.preferredPaymentMethod}` : `Prefers: ${history.preferredPaymentMethod}`)
            : undefined}
        />
      </div>

      {lowCostCoverage && (
        <div className="text-xs rounded px-3 py-2 bg-amber-500/10 border border-amber-500/30 text-amber-300">
          ⚠️ {es
            ? `Profit aproximado — solo ${Math.round(history.costCoverage * 100)}% de las ventas tienen cost registrado.`
            : `Approximate profit — only ${Math.round(history.costCoverage * 100)}% of sales have cost recorded.`}
        </div>
      )}

      {/* Linked entities + loyalty */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
        <InfoRow
          icon="🔧"
          label={es ? 'Reparaciones' : 'Repairs'}
          value={history.linkedEntities.repairCount > 0
            ? `${history.linkedEntities.repairCount} (${formatCurrency(history.linkedEntities.repairTotalValue)})`
            : '0'}
        />
        <InfoRow
          icon="📦"
          label={es ? 'Pedidos Especiales' : 'Special Orders'}
          value={String(history.linkedEntities.specialOrderCount)}
        />
        <InfoRow
          icon="🔓"
          label="Unlocks"
          value={String(history.linkedEntities.unlockCount)}
        />
        <InfoRow
          icon="🏷️"
          label={es ? 'Apartados' : 'Layaways'}
          value={String(history.linkedEntities.layawayCount)}
        />
        <InfoRow
          icon="🎁"
          label={es ? 'Puntos Lealtad' : 'Loyalty Points'}
          value={history.customer.loyaltyPoints.toLocaleString()}
        />
        <InfoRow
          icon="💳"
          label={es ? 'Crédito Tienda' : 'Store Credit'}
          value={formatCurrency(history.customer.storeCredit)}
        />
      </div>

      {history.linkedEntities.activeBalance > 0 && (
        <div className="text-xs rounded px-3 py-2 bg-red-500/10 border border-red-500/30 text-red-300">
          💰 {es ? 'Balance pendiente' : 'Outstanding balance'}: <strong>{formatCurrency(history.linkedEntities.activeBalance)}</strong>
        </div>
      )}

      {/* Top items */}
      {history.topItems.length > 0 && (
        <div>
          <h5 className="text-sm font-semibold text-slate-300 mb-2">
            {es ? 'Top 5 artículos comprados' : 'Top 5 items purchased'}
          </h5>
          <div className="rounded border border-surface-700 divide-y divide-surface-700">
            {history.topItems.map((item, idx) => (
              <div key={idx} className="px-3 py-2 flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 w-4">#{idx + 1}</span>
                  <span className="text-slate-200">{item.name}</span>
                </div>
                <div className="text-right">
                  <div className="text-slate-200">{formatCurrency(item.revenue)}</div>
                  <div className="text-xs text-slate-500">{item.quantity} {es ? 'uds' : 'qty'}</div>
                </div>
              </div>
            ))}
          </div>
          {history.topCategoryByProfit && (
            <div className="text-xs text-slate-400 mt-2">
              {es ? 'Categoría más rentable' : 'Most profitable category'}: <strong>{history.topCategoryByProfit}</strong> ({formatCurrency(history.topCategoryProfit)})
            </div>
          )}
        </div>
      )}

      {history.visitCount === 0 && (
        <div className="text-sm text-slate-500 italic text-center py-4">
          {es ? 'Sin ventas registradas para este cliente.' : 'No sales recorded for this customer.'}
        </div>
      )}
    </div>
  );
}

function MetricTile({
  label, value, sub, accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: 'emerald';
}) {
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
