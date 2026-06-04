// ============================================================
// Companion — Intelligence Status Panel
// R-INTELLIGENCE-COMPANION-SYNC-V1
//
// Compact glanceable intelligence surface for desktop Companion.
// Role-aware, deterministic, no charts, no giant dashboards.
// Recomputes via useMemo when POS state changes — no polling.
// ============================================================

import { useMemo } from 'react';
import { useApp } from '@/store/AppProvider';
import { useTranslation } from '@/i18n';
import {
  buildCompanionIntelligencePayload,
  type CompanionItemSeverity,
} from '@/services/companion/intelligence/companionIntelligenceBridge';

// ── Health status colors (match CompanionPage dark theme) ──
const HEALTH_COLOR: Record<string, string> = {
  strong:   '#22c55e',
  stable:   '#38bdf8',
  weak:     '#f59e0b',
  critical: '#ef4444',
};

const STATE_COLOR: Record<string, string> = {
  normal:          '#64748b',
  rush_mode:       '#ef4444',
  slow_day:        '#f59e0b',
  repair_overload: '#f97316',
  collection_mode: '#8b5cf6',
};

const SEV_COLOR: Record<CompanionItemSeverity, string> = {
  critical: '#ef4444',
  high:     '#f59e0b',
  medium:   '#64748b',
};

const SEV_DOT: Record<CompanionItemSeverity, string> = {
  critical: '●',
  high:     '●',
  medium:   '·',
};

export default function IntelligenceStatusPanel() {
  const { t } = useTranslation();
  const { state: { sales, repairs, layaways, currentEmployee } } = useApp();

  const payload = useMemo(
    () => buildCompanionIntelligencePayload({ sales, repairs, layaways, currentEmployee }),
    [sales, repairs, layaways, currentEmployee],
  );

  // Localized enum labels with safe fallback to the raw value.
  const tFallback = (key: string, raw: string) => { const l = t(key); return l === key ? raw : l; };
  const stateColor  = STATE_COLOR[payload.storeState.state]  ?? '#64748b';
  const stateLabel  = tFallback(`companion.intel.state.${payload.storeState.state}`, payload.storeState.state);
  const healthColor = HEALTH_COLOR[payload.operationalHealth.overallStatus] ?? '#64748b';
  const healthLabel = tFallback(`companion.intel.health.${payload.operationalHealth.overallStatus}`, payload.operationalHealth.overallStatus);
  const hasCritical = payload.criticalItems.some((i) => i.severity === 'critical' || i.severity === 'high');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* Row 1: Store State + Health chips */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {/* Store State */}
        <div style={{
          flex: 1,
          minWidth: 140,
          background: 'rgba(15,23,42,0.6)',
          border: `1px solid ${stateColor}30`,
          borderRadius: 10,
          padding: '10px 12px',
        }}>
          <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
            {t('companion.intel.storeState')}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: stateColor,
              boxShadow: payload.storeState.state !== 'normal' ? `0 0 5px ${stateColor}80` : 'none',
              flexShrink: 0,
            }} />
            <span style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>
              {stateLabel}
            </span>{/* localized via companion.intel.state.* */}
          </div>
          {payload.storeState.reason && (
            <div style={{ fontSize: 10, color: '#64748b', marginTop: 3, lineHeight: 1.3 }}>
              {payload.storeState.reason}
            </div>
          )}
        </div>

        {/* Operational Health */}
        <div style={{
          flex: 1,
          minWidth: 140,
          background: 'rgba(15,23,42,0.6)',
          border: `1px solid ${healthColor}30`,
          borderRadius: 10,
          padding: '10px 12px',
        }}>
          <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
            {t('companion.intel.operationalHealth')}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 20, fontWeight: 800, color: healthColor }}>
              {payload.operationalHealth.overallScore}
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, color: healthColor, opacity: 0.85 }}>
              {healthLabel}
            </span>
          </div>
          {payload.operationalHealth.weakestArea && (
            <div style={{ fontSize: 10, color: '#64748b', marginTop: 3 }}>
              {t('companion.intel.pressure', payload.operationalHealth.weakestArea.replace(/_/g, ' '))}
            </div>
          )}
        </div>

        {/* Queue Pressure chip */}
        {payload.queuePressure > 0 && (
          <div style={{
            background: 'rgba(15,23,42,0.6)',
            border: payload.queuePressure >= 5
              ? '1px solid rgba(239,68,68,0.25)'
              : '1px solid rgba(148,163,184,0.15)',
            borderRadius: 10,
            padding: '10px 12px',
            minWidth: 80,
          }}>
            <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
              {t('companion.intel.queue')}
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: payload.queuePressure >= 5 ? '#ef4444' : '#fff' }}>
              {payload.queuePressure}
            </div>
          </div>
        )}
      </div>

      {/* Row 2: Critical items */}
      {payload.criticalItems.length > 0 && (
        <div style={{
          background: 'rgba(15,23,42,0.6)',
          border: hasCritical
            ? '1px solid rgba(239,68,68,0.20)'
            : '1px solid rgba(148,163,184,0.15)',
          borderRadius: 10,
          padding: '10px 12px',
        }}>
          <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            {t('companion.intel.needsAttention')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {payload.criticalItems.map((item) => (
              <div key={item.type} style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
                <span style={{
                  fontSize: item.severity === 'medium' ? 14 : 10,
                  color: SEV_COLOR[item.severity],
                  flexShrink: 0,
                  lineHeight: item.severity === 'medium' ? '16px' : '18px',
                  fontWeight: 700,
                }}>
                  {SEV_DOT[item.severity]}
                </span>
                <span style={{
                  fontSize: 12,
                  color: item.severity === 'critical' ? '#fca5a5' : item.severity === 'high' ? '#fde68a' : '#94a3b8',
                  lineHeight: 1.35,
                }}>
                  {item.title}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Row 3: Recommended focus */}
      <div style={{
        background: 'rgba(15,23,42,0.6)',
        border: '1px solid rgba(148,163,184,0.15)',
        borderRadius: 10,
        padding: '10px 12px',
      }}>
        <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
          {t('companion.intel.recommendedFocus')}
        </div>
        <div style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 500, lineHeight: 1.4 }}>
          {payload.recommendedFocus}
        </div>
      </div>

      {/* Footer: role + generated at */}
      <div style={{ fontSize: 10, color: '#334155', display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ textTransform: 'capitalize' }}>{t('companion.intel.roleView', payload.role)}</span>
        <span>{t('companion.intel.updated', new Date(payload.generatedAt).toLocaleTimeString())}</span>
      </div>
    </div>
  );
}
