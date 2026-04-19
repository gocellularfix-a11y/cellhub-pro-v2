// CellHub Intelligence — Dashboard UI
import { useMemo } from 'react';
import type { Insight, IntelligenceReport, StoreHealthScore, KPIDashboard } from '@/services/intelligence';
import { formatCurrency } from '@/utils/currency';

interface IntelligenceDashboardProps {
  report: IntelligenceReport | null;
  healthScore: StoreHealthScore | null;
  kpiDashboard: KPIDashboard | null;
  insights: Insight[];
  lang?: 'en' | 'es';
  onRefresh?: () => void;
}

export default function IntelligenceDashboard({
  report,
  healthScore,
  kpiDashboard,
  insights,
  lang = 'en',
  onRefresh,
}: IntelligenceDashboardProps) {
  const getSeverityColor = (severity: Insight['severity']) => {
    switch (severity) {
      case 'critical': return 'bg-red-500/20 border-red-500 text-red-400';
      case 'warning': return 'bg-amber-500/20 border-amber-500 text-amber-400';
      case 'info': return 'bg-blue-500/20 border-blue-500 text-blue-400';
      case 'opportunity': return 'bg-emerald-500/20 border-emerald-500 text-emerald-400';
      default: return 'bg-slate-500/20 border-slate-500 text-slate-400';
    }
  };

  const getGradeColor = (grade: StoreHealthScore['grade']) => {
    switch (grade) {
      case 'A': return 'text-emerald-400';
      case 'B': return 'text-blue-400';
      case 'C': return 'text-amber-400';
      case 'D': return 'text-orange-400';
      case 'F': return 'text-red-400';
      default: return 'text-slate-400';
    }
  };

  const formatTrend = (trend: 'up' | 'down' | 'flat', percent: number) => {
    const arrow = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→';
    const color = trend === 'up' ? 'text-emerald-400' : trend === 'down' ? 'text-red-400' : 'text-slate-400';
    return <span className={color}>{arrow} {Math.abs(percent).toFixed(1)}%</span>;
  };

  return (
    <div className="space-y-4">
      {healthScore && (
        <div className="bg-surface-800 rounded-lg p-4 border border-surface-700">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-200">{healthScore.title}</h3>
              <p className="text-sm text-slate-400">
                {lang === 'es' ? 'Puntuación general de la tienda' : 'Overall store health score'}
              </p>
            </div>
            <div className="text-right">
              <div className={`text-4xl font-bold ${getGradeColor(healthScore.grade)}`}>
                {healthScore.score}
              </div>
              <div className={`text-2xl font-bold ${getGradeColor(healthScore.grade)}`}>
                {healthScore.grade}
              </div>
            </div>
          </div>
          {healthScore.factors.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {healthScore.factors.map((factor, idx) => (
                <span key={idx} className="px-2 py-1 text-xs rounded bg-surface-700 text-slate-300">
                  {factor}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {kpiDashboard && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-surface-800 rounded-lg p-4 border border-surface-700">
            <p className="text-xs text-slate-400 uppercase">
              {lang === 'es' ? 'Ingresos' : 'Revenue'}
            </p>
            <p className="text-xl font-bold text-slate-200">
              {formatCurrency(kpiDashboard.revenue.current)}
            </p>
            {formatTrend(kpiDashboard.revenue.trend, kpiDashboard.revenue.trendPercent)}
          </div>
          <div className="bg-surface-800 rounded-lg p-4 border border-surface-700">
            <p className="text-xs text-slate-400 uppercase">
              {lang === 'es' ? 'Transacciones' : 'Transactions'}
            </p>
            <p className="text-xl font-bold text-slate-200">
              {kpiDashboard.transactions.count}
            </p>
            <p className="text-sm text-slate-400">
              {lang === 'es' ? 'Promedio:' : 'Avg:'} {formatCurrency(kpiDashboard.transactions.avgSize)}
            </p>
          </div>
          <div className="bg-surface-800 rounded-lg p-4 border border-surface-700">
            <p className="text-xs text-slate-400 uppercase">
              {lang === 'es' ? 'Inventario' : 'Inventory'}
            </p>
            <p className="text-xl font-bold text-slate-200">
              {kpiDashboard.inventory.totalItems}
            </p>
            <p className="text-sm text-slate-400">
              {lang === 'es' ? 'Stock bajo:' : 'Low stock:'} {kpiDashboard.inventory.lowStockCount}
            </p>
          </div>
          <div className="bg-surface-800 rounded-lg p-4 border border-surface-700">
            <p className="text-xs text-slate-400 uppercase">
              {lang === 'es' ? 'Clientes' : 'Customers'}
            </p>
            <p className="text-xl font-bold text-slate-200">
              {kpiDashboard.customers.total}
            </p>
            <p className="text-sm text-slate-400">
              +{kpiDashboard.customers.new} {lang === 'es' ? 'nuevos' : 'new'}
            </p>
          </div>
        </div>
      )}

      {insights.length > 0 && (
        <div className="bg-surface-800 rounded-lg border border-surface-700 overflow-hidden">
          <div className="p-3 border-b border-surface-700 flex items-center justify-between">
            <h3 className="font-semibold text-slate-200">
              {lang === 'es' ? 'Insights' : 'Insights'}
            </h3>
            <span className="text-xs text-slate-400">
              {insights.length} {lang === 'es' ? 'insights encontrados' : 'found'}
            </span>
          </div>
          <div className="divide-y divide-surface-700 max-h-96 overflow-y-auto">
            {insights.slice(0, 20).map((insight) => (
              <div
                key={insight.id}
                className={`p-3 border-l-2 ${getSeverityColor(insight.severity)}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h4 className="font-medium text-slate-200">
                      {lang === 'es' ? insight.titleEs : insight.title}
                    </h4>
                    <p className="text-sm text-slate-400 mt-1">
                      {lang === 'es' ? insight.descriptionEs : insight.description}
                    </p>
                    {insight.metric !== undefined && insight.metricLabel && (
                      <p className="text-xs text-slate-500 mt-1">
                        {insight.metricLabel}: {
                          insight.category === 'financial'
                            ? formatCurrency(insight.metric)
                            : insight.metric.toLocaleString()
                        }
                      </p>
                    )}
                  </div>
                  {insight.actionLabel && (
                    <button className="ml-2 px-2 py-1 text-xs rounded bg-surface-700 hover:bg-surface-600 text-slate-300">
                      {lang === 'es' ? insight.actionLabelEs || insight.actionLabel : insight.actionLabel}
                    </button>
                  )}
                </div>
                <div className="mt-2 flex items-center gap-3 text-xs text-slate-500">
                  <span>{insight.category}</span>
                  <span>•</span>
                  <span>{Math.round(insight.confidence * 100)}% {lang === 'es' ? 'confianza' : 'confidence'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {kpiDashboard?.topItems && kpiDashboard.topItems.length > 0 && (
        <div className="bg-surface-800 rounded-lg border border-surface-700">
          <div className="p-3 border-b border-surface-700">
            <h3 className="font-semibold text-slate-200">
              {lang === 'es' ? 'Artículos Más Vendidos' : 'Top Selling Items'}
            </h3>
          </div>
          <div className="divide-y divide-surface-700">
            {kpiDashboard.topItems.map((item, idx) => (
              <div key={idx} className="p-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-lg font-bold text-slate-500">#{idx + 1}</span>
                  <span className="text-slate-200">{item.name}</span>
                </div>
                <div className="text-right">
                  <p className="text-slate-200">{formatCurrency(item.revenue)}</p>
                  <p className="text-xs text-slate-400">{item.quantity} {lang === 'es' ? 'unidades' : 'units'}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {onRefresh && (
        <div className="flex justify-end">
          <button
            onClick={onRefresh}
            className="px-4 py-2 bg-surface-700 hover:bg-surface-600 rounded-lg text-slate-200 text-sm"
          >
            {lang === 'es' ? 'Actualizar' : 'Refresh'}
          </button>
        </div>
      )}
    </div>
  );
}