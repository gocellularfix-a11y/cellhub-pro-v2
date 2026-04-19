import { useApp } from '@/store/AppProvider';
import { useMultiStore } from '@/store/MultiStoreProvider';
import { getLabels } from '@/config/i18n';
import { NAV_TABS, canAccessTab } from '@/config/constants';

export default function Sidebar() {
  const {
    state: { activeTab, currentEmployee, lang, isAdminMode, settings },
    setActiveTab,
    setCurrentEmployee,
    setLang,
    setAdminMode,
    dispatch,
  } = useApp();

  const { state: multiStore, setConsolidatedView } = useMultiStore();
  const L = getLabels(lang);

  const handleClockOut = () => {
    setCurrentEmployee(null);
    setAdminMode(false);
    setActiveTab('dashboard');
  };

  const toggleLang = () => {
    setLang(lang === 'en' ? 'es' : 'en');
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
        {multiStore.enabled && (
          <button
            onClick={() => setConsolidatedView(!multiStore.consolidatedView)}
            className={`mt-1 text-[10px] px-2 py-0.5 rounded-full transition-all ${
              multiStore.consolidatedView
                ? 'bg-brand-500/20 text-brand-400'
                : 'bg-white/5 text-slate-500 hover:bg-white/10'
            }`}
          >
            {multiStore.consolidatedView ? '🌐 All Stores' : '📍 This Store'}
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
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '8px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            color: '#64748b', fontSize: '0.82rem',
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'rgba(102,126,234,0.15)';
            (e.currentTarget as HTMLElement).style.color = '#a5b4fc';
            (e.currentTarget as HTMLElement).style.borderColor = 'rgba(102,126,234,0.4)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)';
            (e.currentTarget as HTMLElement).style.color = '#64748b';
            (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.1)';
          }}
        >
          <span>🔍</span>
          <span style={{ flex: 1, textAlign: 'left' }}>
            {lang === 'es' ? 'Buscar todo...' : 'Search everything...'}
          </span>
          <kbd style={{
            fontSize: '0.6rem', padding: '0.1rem 0.35rem',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '3px', letterSpacing: '0.02em',
          }}>⌘K</kbd>
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-2">
        {NAV_TABS.map((tab) => {
          // Hide admin-only tabs when not in admin mode
          if (tab.adminOnly && !isAdminMode) return null;
          // Hide tabs the current employee's role cannot access
          if (!canAccessTab(tab.id, currentEmployee?.role, (currentEmployee as any)?.allowedModules)) return null;

          return (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                // If already on POS, reset to Quick Action Grid
                if (tab.id === 'pos' && activeTab === 'pos') {
                  window.dispatchEvent(new CustomEvent('cellhub_pos_reset'));
                }
              }}
              className={`nav-item w-full text-left ${
                activeTab === tab.id ? 'active' : ''
              }`}
            >
              <span className="text-xl">{tab.icon}</span>
              <span>{L[tab.labelKey] || tab.labelKey}</span>
            </button>
          );
        })}
      </nav>

      {/* Bottom section — matches original */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', padding: '1rem 1.5rem', paddingBottom: '2rem' }}>
        {/* AI Assistant */}
        <button
          onClick={() => dispatch({ type: 'SET_SHOW_AI_ASSISTANT', payload: true })}
          style={{
            width: '100%', padding: '0.6rem 0.75rem', background: 'transparent', border: 'none',
            color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '0.75rem',
            cursor: 'pointer', fontSize: '0.9rem', fontWeight: 500, textAlign: 'left',
            borderRadius: '8px', transition: 'all 0.2s', marginBottom: '0.5rem',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
        >
          <span style={{ fontSize: '1.1rem' }}>🤖</span>
          <span>AI Assistant</span>
        </button>

        {/* Language toggle — EN / ES buttons like original */}
        <div style={{ marginBottom: '0.75rem' }}>
          <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
            {L.language || 'LANGUAGE'}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={() => setLang('en')}
              style={{
                flex: 1, padding: '0.5rem', borderRadius: '8px', border: 'none', cursor: 'pointer',
                fontWeight: 700, fontSize: '0.8rem', transition: 'all 0.2s',
                background: lang === 'en' ? '#ef4444' : 'rgba(255,255,255,0.1)',
                color: lang === 'en' ? 'white' : '#94a3b8',
              }}
            >
              🇺🇸 EN
            </button>
            <button
              onClick={() => setLang('es')}
              style={{
                flex: 1, padding: '0.5rem', borderRadius: '8px', border: 'none', cursor: 'pointer',
                fontWeight: 700, fontSize: '0.8rem', transition: 'all 0.2s',
                background: lang === 'es' ? '#3b82f6' : 'rgba(255,255,255,0.1)',
                color: lang === 'es' ? 'white' : '#94a3b8',
              }}
            >
              🇲🇽 ES
            </button>
          </div>
        </div>

        {/* Version info */}
        <div style={{ fontSize: '0.65rem', color: '#475569', marginBottom: '0.75rem' }}>
          CellHub Pro — Build 2026.04.01
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
            🚪 {L.clockOut || 'Clock Out'}
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
            {L.clockIn || 'Clock In'}
          </button>
        )}

        {/* Admin Mode indicator */}
        {isAdminMode && (
          <div style={{
            marginTop: '0.5rem', fontSize: '0.7rem', color: '#fbbf24',
            display: 'flex', alignItems: 'center', gap: '0.4rem',
          }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
            🔒 Admin Mode — click to exit
          </div>
        )}
      </div>
    </aside>
  );
}
