import { useEffect } from 'react';
import { useApp } from '@/store/AppProvider';
import { useMultiStore } from '@/store/MultiStoreProvider';
import { useLicense } from '@/contexts/LicenseContext';
import { NAV_TABS, canAccessTab } from '@/config/constants';
import { useTheme, THEMES } from '@/theme';
import { useTranslation } from '@/i18n';
// R-OFFLINE-MODE-GUARD-V1: live online/offline status for the sidebar badge.
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

// R-PRODUCTION-B6.1: injected by Vite `define` from package.json at build time.
declare const __APP_VERSION__: string;

// R-SIDEBAR-QUICKACTIONS-STYLE: per-module gradient palette. Keyed by
// the NAV_TABS id. Unmapped ids fall back to the slate tone below so
// the grid never breaks if a new module is added to constants.ts.
const MODULE_PALETTE: Record<string, { bg: string; border: string; label: string }> = {
  inventory:      { bg: 'linear-gradient(145deg, #2a1e06, #1a1204)', border: '#5a3a0a', label: '#fbbf24' },
  repairs:        { bg: 'linear-gradient(145deg, #0a2e2a, #061e1a)', border: '#0f4840', label: '#2dd4bf' },
  unlocks:        { bg: 'linear-gradient(145deg, #200d50, #140830)', border: '#3a1880', label: '#c084fc' },
  specialOrders:  { bg: 'linear-gradient(145deg, #082030, #041318)', border: '#0a3850', label: '#22d3ee' },
  layaways:       { bg: 'linear-gradient(145deg, #0a2010, #061408)', border: '#0f4020', label: '#4ade80' },
  returns:        { bg: 'linear-gradient(145deg, #300a28, #1e0618)', border: '#501040', label: '#f0abfc' },
  customers:      { bg: 'linear-gradient(145deg, #181460, #0f0c38)', border: '#2d2580', label: '#818cf8' },
  appointments:   { bg: 'linear-gradient(145deg, #142008, #0c1604)', border: '#203a10', label: '#a3e635' },
  intelligence:   { bg: 'linear-gradient(145deg, #081830, #04101e)', border: '#0a2a50', label: '#38bdf8' },
  manager:        { bg: 'linear-gradient(145deg, #101830, #0a1020)', border: '#26335a', label: '#a5b4fc' },
  reports:        { bg: 'linear-gradient(145deg, #301408, #1e0c04)', border: '#603010', label: '#fb923c' },
  // P1-SC-CENTER / P1-COLIBRI-LAUNCHER: balanced pair added together.
  storeCredit:    { bg: 'linear-gradient(145deg, #0a2a20, #051a12)', border: '#0f4a38', label: '#34d399' },
  purchaseOrders: { bg: 'linear-gradient(145deg, #0e2050, #081530)', border: '#1a3880', label: '#60a5fa' },
  companion:      { bg: 'linear-gradient(145deg, #082030, #04101c)', border: '#0a3050', label: '#38bdf8' },
  employees:      { bg: 'linear-gradient(145deg, #2a0a18, #180610)', border: '#501030', label: '#fb7185' },
  settings:       { bg: 'linear-gradient(145deg, #2a0a0a, #180606)', border: '#501010', label: '#f87171' },
};
const MODULE_PALETTE_FALLBACK = { bg: 'linear-gradient(145deg, #141c28, #0c1218)', border: '#202c3e', label: '#94a3b8' };

// R-SIDEBAR-QUICKACTIONS-STYLE: hover styles live in a single injected
// stylesheet (same idempotent pattern as FloatingOperatorBubble).
// Inline style stays the source of truth for the
// per-module gradient + active outline; CSS only owns hover.
const SIDEBAR_STYLE_ID = 'cellhub-sidebar-module-styles';
function ensureSidebarModuleStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(SIDEBAR_STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = SIDEBAR_STYLE_ID;
  el.textContent = `
button[data-cellhub-sidebar-module="true"]:hover {
  transform: scale(1.02);
  filter: brightness(1.15);
}
button[data-cellhub-sidebar-pos="true"]:hover {
  filter: brightness(1.12);
}
`;
  document.head.appendChild(el);
}

export default function Sidebar() {
  const {
    state: { activeTab, currentEmployee, isAdminMode, settings },
    setActiveTab,
    setCurrentEmployee,
    setLang,
    setAdminMode,
    dispatch,
  } = useApp();

  const { state: multiStore, setConsolidatedView } = useMultiStore();
  const { features } = useLicense();
  const { theme, setTheme } = useTheme();
  const { t, locale } = useTranslation();
  const { isOffline } = useOnlineStatus();

  // R-SIDEBAR-QUICKACTIONS-STYLE: inject hover keyframes once on mount.
  // Idempotent — re-mounts skip the create call.
  useEffect(() => { ensureSidebarModuleStyles(); }, []);

  const handleClockOut = () => {
    setCurrentEmployee(null);
    setAdminMode(false);
    setActiveTab('dashboard');
  };

  const toggleLang = () => {
    setLang(locale === 'en' ? 'es' : locale === 'es' ? 'pt' : 'en');
  };

  return (
    <aside className="w-[285px] min-w-[285px] bg-surface-900/80 border-r border-white/10 flex flex-col h-screen overflow-y-auto overflow-x-hidden">
      {/* Header */}
      <div className="px-6 pt-6 pb-4">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-brand-500 to-accent-500 bg-clip-text text-transparent">
          CellHub Pro
        </h1>
        {multiStore.currentStore ? (
          <p className="text-xs text-slate-500 mt-1 truncate">📍 {multiStore.currentStore.name}</p>
        ) : settings.storeName ? (
          <p className="text-xs text-slate-500 mt-1 truncate">{settings.storeName}</p>
        ) : null}
        {features.multiStore && multiStore.enabled && (
          <button
            onClick={() => setConsolidatedView(!multiStore.consolidatedView)}
            className={`mt-1 text-[10px] px-2 py-0.5 rounded-full transition-all ${
              multiStore.consolidatedView
                ? 'bg-brand-500/20 text-brand-400'
                : 'bg-white/5 text-slate-500 hover:bg-white/10'
            }`}
          >
            {multiStore.consolidatedView ? `🌐 ${t('sidebar.allStores')}` : `📍 ${t('sidebar.thisStore')}`}
          </button>
        )}
      </div>

      {/* Current Employee */}
      {currentEmployee && (
        <div className="mx-4 mb-4 px-3 py-2 rounded-lg bg-white/5 border border-white/10">
          <p className="text-sm text-white font-medium truncate">
            👤 {currentEmployee.name}
          </p>
          <p className="text-xs text-slate-500 capitalize">{currentEmployee.role}</p>
        </div>
      )}

      {/* Global Search trigger */}
      <div className="px-4 pb-3">
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('cellhub_global_search'))}
          style={{
            width: '100%', padding: '0.5rem 0.75rem',
            background: 'var(--bg-input)',
            border: '1px solid var(--border-default)',
            borderRadius: '8px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            color: 'var(--text-muted)', fontSize: '0.82rem',
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'rgba(102,126,234,0.15)';
            (e.currentTarget as HTMLElement).style.color = '#a5b4fc';
            (e.currentTarget as HTMLElement).style.borderColor = 'rgba(102,126,234,0.4)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'var(--bg-input)';
            (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)';
            (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-default)';
          }}
        >
          <span>🔍</span>
          <span style={{ flex: 1, textAlign: 'left' }}>
            {t('sidebar.searchPlaceholder')}
          </span>
          <kbd style={{
            fontSize: '0.6rem', padding: '0.1rem 0.35rem',
            background: 'var(--bg-input)',
            border: '1px solid var(--border-default)',
            borderRadius: '3px', letterSpacing: '0.02em',
          }}>⌘K</kbd>
        </button>
      </div>

      {/* Navigation — R-SIDEBAR-QUICKACTIONS-STYLE.
          POS lives as a hero card above the grid; everything else
          renders as a 2-col Quick-Actions-style tile grid with per-
          module gradients. Filtering rules (adminOnly + role +
          allowed-modules) and click handlers stay identical to the
          previous nav-item rendering. */}
      <nav className="flex-1 py-2">
        {(() => {
          const isVisible = (tab: typeof NAV_TABS[number]) => {
            if (tab.adminOnly && !isAdminMode) return false;
            if (!canAccessTab(tab.id, currentEmployee?.role, (currentEmployee as any)?.allowedModules)) return false;
            return true;
          };
          const posTab = NAV_TABS.find((tt) => tt.id === 'pos');
          const showPos = !!posTab && isVisible(posTab);
          const gridTabs = NAV_TABS.filter((tt) => tt.id !== 'pos' && isVisible(tt));
          return (
            <>
              {showPos && posTab && (
                <div style={{ margin: '8px 10px 4px' }}>
                  <button
                    type="button"
                    data-cellhub-sidebar-pos="true"
                    onClick={() => {
                      setActiveTab(posTab.id);
                      if (activeTab === 'pos') {
                        window.dispatchEvent(new CustomEvent('cellhub_pos_reset'));
                      }
                    }}
                    style={{
                      width: '100%',
                      padding: '12px 14px',
                      background: 'linear-gradient(135deg, #3730a3 0%, #6d28d9 100%)',
                      border: activeTab === 'pos'
                        ? '1px solid #a78bfa'
                        : '1px solid #4f46e5',
                      borderRadius: 12,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      cursor: 'pointer',
                      textAlign: 'left',
                      color: 'white',
                      transition: 'all 150ms ease',
                      boxShadow: activeTab === 'pos' ? '0 0 0 2px rgba(167,139,250,0.35)' : 'none',
                    }}
                  >
                    <span aria-hidden="true" style={{ fontSize: 24, lineHeight: 1, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.4))' }}>
                      {posTab.icon}
                    </span>
                    <span style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 15,
                      fontWeight: 800,
                      color: 'white',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {t('nav.' + posTab.labelKey)}
                    </span>
                    <span aria-hidden="true" style={{ fontSize: 18, color: 'rgba(255,255,255,0.7)', flexShrink: 0 }}>→</span>
                  </button>
                </div>
              )}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 7,
                padding: '0 8px',
                marginTop: 8,
              }}>
                {gridTabs.map((tab) => {
                  const palette = MODULE_PALETTE[tab.id] ?? MODULE_PALETTE_FALLBACK;
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      data-cellhub-sidebar-module="true"
                      data-active={isActive ? 'true' : 'false'}
                      onClick={() => setActiveTab(tab.id)}
                      style={{
                        position: 'relative',
                        borderRadius: 10,
                        padding: '14px 8px',
                        minHeight: 64,
                        background: palette.bg,
                        border: `1px solid ${palette.border}`,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 4,
                        cursor: 'pointer',
                        transition: 'all 150ms ease',
                        textAlign: 'center',
                        outline: isActive ? `2px solid ${palette.label}` : 'none',
                        outlineOffset: isActive ? '-2px' : 0,
                        boxShadow: isActive ? `0 0 14px ${palette.label}33` : 'none',
                      }}
                    >
                      <span aria-hidden="true" style={{ fontSize: 22, lineHeight: 1, flexShrink: 0 }}>
                        {tab.icon}
                      </span>
                      <span style={{
                        minWidth: 0,
                        maxWidth: '100%',
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: '0.3px',
                        color: palette.label,
                        textTransform: 'uppercase',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}>
                        {t('nav.' + tab.labelKey)}
                      </span>
                    </button>
                  );
                })}
                {/* R-SIDEBAR-AI-ASSISTANT-CARD: AI Assistant rendered as
                    the trailing tile so the grid stays visually
                    balanced. Spans both columns when the preceding
                    module count is even (so the total is odd) — keeps
                    the bottom row from leaving a half-empty slot. */}
                {features.aiAssistant && (
                  <button
                    type="button"
                    data-cellhub-sidebar-module="true"
                    onClick={() => dispatch({ type: 'SET_SHOW_AI_ASSISTANT', payload: true })}
                    style={{
                      position: 'relative',
                      borderRadius: 10,
                      padding: '14px 8px',
                      minHeight: 64,
                      background: 'linear-gradient(145deg, #1a0a30, #100620)',
                      border: '1px solid #3a1060',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4,
                      cursor: 'pointer',
                      transition: 'all 150ms ease',
                      textAlign: 'center',
                      width: '100%',
                      gridColumn: gridTabs.length % 2 === 0 ? 'span 2' : 'auto',
                    }}
                  >
                    <span aria-hidden="true" style={{ fontSize: 22, lineHeight: 1, flexShrink: 0 }}>
                      🤖
                    </span>
                    <span style={{
                      minWidth: 0,
                      maxWidth: '100%',
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: '0.3px',
                      color: '#c084fc',
                      textTransform: 'uppercase',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {t('sidebar.aiAssistant')}
                    </span>
                  </button>
                )}
              </div>
            </>
          );
        })()}
      </nav>

      {/* Bottom section — matches original */}
      <div style={{ borderTop: '1px solid var(--border-default)', padding: '1rem 1.5rem', paddingBottom: '2rem' }}>
        {/* R-SIDEBAR-AI-ASSISTANT-CARD: AI Assistant moved into the
            module grid above so the bottom section now owns only
            language/theme/version/clock controls. */}

        {/* Language toggle — EN / ES buttons like original */}
        <div style={{ marginBottom: '0.75rem' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
            {t('language')}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={() => setLang('en')}
              style={{
                flex: 1, padding: '0.5rem', borderRadius: '8px', border: 'none', cursor: 'pointer',
                fontWeight: 700, fontSize: '0.8rem', transition: 'all 0.2s',
                background: locale ==='en' ? '#ef4444' : 'var(--bg-hover)',
                color: locale ==='en' ? 'white' : 'var(--text-secondary)',
              }}
            >
              🇺🇸 EN
            </button>
            <button
              onClick={() => setLang('es')}
              style={{
                flex: 1, padding: '0.5rem', borderRadius: '8px', border: 'none', cursor: 'pointer',
                fontWeight: 700, fontSize: '0.8rem', transition: 'all 0.2s',
                background: locale ==='es' ? '#3b82f6' : 'var(--bg-hover)',
                color: locale ==='es' ? 'white' : 'var(--text-secondary)',
              }}
            >
              🇲🇽 ES
            </button>
            <button
              onClick={() => setLang('pt')}
              style={{
                flex: 1, padding: '0.5rem', borderRadius: '8px', border: 'none', cursor: 'pointer',
                fontWeight: 700, fontSize: '0.8rem', transition: 'all 0.2s',
                background: locale ==='pt' ? '#22c55e' : 'var(--bg-hover)',
                color: locale ==='pt' ? 'white' : 'var(--text-secondary)',
              }}
            >
              🇧🇷 PT
            </button>
          </div>
        </div>

        {/* Theme picker — color swatches */}
        <div style={{ marginBottom: '0.75rem' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#a78bfa', display: 'inline-block' }} />
            {t('sidebar.theme')}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'space-between' }}>
            {THEMES.map((t) => {
              const localizedLabel = locale ==='es' ? t.labelEs : locale ==='pt' ? t.labelPt : t.label;
              const isActive = theme === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTheme(t.id)}
                  title={localizedLabel}
                  aria-label={localizedLabel}
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    border: isActive ? '2px solid #ffffff' : '2px solid rgba(255,255,255,0.1)',
                    background: t.preview,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    boxShadow: isActive ? '0 0 0 2px rgba(167,139,250,0.4)' : 'none',
                    padding: 0,
                  }}
                />
              );
            })}
          </div>
        </div>

        {/* R-OFFLINE-MODE-GUARD-V1: non-blocking online/offline status badge. */}
        <div style={{ marginBottom: '0.6rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.72rem', fontWeight: 600 }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: isOffline ? '#f59e0b' : '#22c55e', display: 'inline-block' }} />
            <span style={{ color: isOffline ? '#fbbf24' : '#86efac' }}>
              {isOffline ? t('offline.offline') : t('offline.online')}
            </span>
          </div>
          {isOffline && (
            <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              {t('offline.localWorks')}
            </div>
          )}
        </div>

        {/* Version info */}
        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
          CellHub Pro — v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'}
        </div>

        {/* Clock In / Clock Out */}
        {currentEmployee ? (
          <button
            onClick={handleClockOut}
            style={{
              width: '100%', padding: '0.65rem', borderRadius: '10px', border: 'none',
              background: 'rgba(239, 68, 68, 0.15)', color: '#fca5a5', cursor: 'pointer',
              fontWeight: 600, fontSize: '0.85rem', transition: 'all 0.2s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
            }}
          >
            🚪 {t('sidebar.clockOut')}
          </button>
        ) : (
          <button
            onClick={() => {/* handled by EmployeeLogin gate */}}
            style={{
              width: '100%', padding: '0.65rem', borderRadius: '10px', border: 'none',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: 'white',
              cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem', transition: 'all 0.2s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
            }}
          >
            {t('sidebar.clockIn')}
          </button>
        )}

        {/* Admin Mode indicator */}
        {isAdminMode && (
          <div style={{
            marginTop: '0.5rem', fontSize: '0.7rem', color: '#fbbf24',
            display: 'flex', alignItems: 'center', gap: '0.4rem',
          }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
            🔒 {t('sidebar.adminMode')}
          </div>
        )}
      </div>
    </aside>
  );
}
