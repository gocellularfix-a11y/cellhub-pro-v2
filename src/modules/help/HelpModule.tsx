// ============================================================
// R-HELP-MANUAL-V1 — In-app Help / Manual.
//
// Data-driven: all documentation lives in helpContent.ts (localized map).
// This component only renders it — left module list + search, right content
// panel. Chrome strings come from i18n (help.* keys). No hardcoded prose here.
// ============================================================

import { useMemo, useState, useEffect, type ReactNode } from 'react';
import { useTranslation } from '@/i18n';
import { HELP_MODULES, getHelpModule, type HelpLocale, type HelpModuleEntry } from './helpContent';
import { getSafeDiagnosticsInfo } from '@/config/appInfo';

// R-PRODUCTION-B6.1: injected by Vite `define` from package.json at build time.
declare const __APP_VERSION__: string;

const OVERVIEW = 'overview';

export default function HelpModule() {
  const { t, locale } = useTranslation();
  // Coerce the app locale to a supported help locale (EN fallback).
  const L: HelpLocale = locale === 'es' || locale === 'pt' ? locale : 'en';

  const [selectedId, setSelectedId] = useState<string>(OVERVIEW);
  const [search, setSearch] = useState('');

  // Build a lowercase haystack per module so search covers title + every
  // section's text in the active locale.
  const haystacks = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of HELP_MODULES) {
      const parts = [
        m.title[L], m.summary[L], m.whatItDoes[L],
        ...m.commonActions[L], ...m.steps[L], ...m.warnings[L], ...m.troubleshooting[L],
      ];
      map.set(m.id, parts.join(' \n ').toLowerCase());
    }
    return map;
  }, [L]);

  const query = search.trim().toLowerCase();
  const filtered: HelpModuleEntry[] = useMemo(() => {
    if (!query) return HELP_MODULES;
    return HELP_MODULES.filter((m) => (haystacks.get(m.id) ?? '').includes(query));
  }, [query, haystacks]);

  // Keep the selection valid: when a search hides the current selection,
  // jump to the first match; clearing the search returns to the overview.
  useEffect(() => {
    if (!query) return;
    if (!filtered.some((m) => m.id === selectedId)) {
      setSelectedId(filtered[0]?.id ?? OVERVIEW);
    }
  }, [query, filtered, selectedId]);

  const selected = getHelpModule(selectedId);
  const showOverview = !query && selectedId === OVERVIEW;

  // R-PRODUCTION-B6.1: non-sensitive identification for remote support.
  const diag = getSafeDiagnosticsInfo(
    typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'unknown',
    typeof navigator !== 'undefined' ? navigator.platform || '' : '',
  );

  // R-PRODUCTION-B3.2: open the local logs folder (desktop only). Reads/sends
  // nothing — main opens a FIXED diagnostics path. Inline status (no toast here).
  const [logsStatus, setLogsStatus] = useState('');
  const openLogsFolder = async () => {
    const api = window.electronAPI;
    if (!api?.openDiagnosticsLogsFolder) {
      setLogsStatus(L === 'es' ? 'Solo disponible en la app de escritorio.' : L === 'pt' ? 'Disponível apenas no app desktop.' : 'Only available in the desktop app.');
      return;
    }
    try {
      const res = await api.openDiagnosticsLogsFolder();
      if (res?.ok) {
        setLogsStatus(L === 'es' ? '✓ Carpeta de logs abierta.' : L === 'pt' ? '✓ Pasta de logs aberta.' : '✓ Logs folder opened.');
      } else {
        const prefix = L === 'es' ? 'No se pudo abrir: ' : L === 'pt' ? 'Não foi possível abrir: ' : 'Could not open: ';
        setLogsStatus(prefix + (res?.error || 'unknown'));
      }
    } catch {
      setLogsStatus(L === 'es' ? 'No se pudo abrir la carpeta de logs.' : L === 'pt' ? 'Não foi possível abrir a pasta de logs.' : 'Could not open logs folder.');
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-white">📖 {t('help.title')}</h1>
        <p className="text-sm text-slate-400 mt-1">{t('help.subtitle')}</p>
      </div>

      {/* R-PRODUCTION-B6.1: About / Diagnostics — version/platform/logs only.
          No secrets, no license key, no hardware fingerprint, no customer data. */}
      <div className="glass-card p-4 space-y-1.5 text-sm">
        <h2 className="text-base font-semibold text-white">
          {L === 'es' ? '🛟 Acerca de / Diagnóstico' : L === 'pt' ? '🛟 Sobre / Diagnóstico' : '🛟 About / Diagnostics'}
        </h2>
        <div className="text-slate-300">
          <span className="text-slate-500">{L === 'es' ? 'Versión' : L === 'pt' ? 'Versão' : 'Version'}:</span>{' '}
          CellHub Pro {diag.version}
        </div>
        <div className="text-slate-300">
          <span className="text-slate-500">{L === 'es' ? 'Plataforma' : 'Platform'}:</span> {diag.platform}
        </div>
        <div className="text-slate-300">
          <span className="text-slate-500">{L === 'es' ? 'Ubicación de logs' : L === 'pt' ? 'Local dos logs' : 'Logs location'}:</span>{' '}
          <code className="text-xs break-all">{diag.logsHint}</code>
        </div>
        <p className="text-xs text-slate-500 pt-1">
          {L === 'es'
            ? 'Si el soporte pide logs, abre esa carpeta manualmente y envía el archivo de log más reciente.'
            : L === 'pt'
              ? 'Se o suporte pedir logs, abra essa pasta manualmente e envie o arquivo de log mais recente.'
              : 'If support asks for logs, open this folder manually and send the latest cellhub log file.'}
        </p>
        <button
          type="button"
          onClick={openLogsFolder}
          className="mt-1 px-3 py-1.5 rounded-lg bg-white/10 border border-white/15 text-xs font-semibold text-white hover:bg-white/15"
        >
          {L === 'es' ? '📂 Abrir carpeta de logs' : L === 'pt' ? '📂 Abrir pasta de logs' : '📂 Open Logs Folder'}
        </button>
        {logsStatus && <div className="text-xs text-slate-400 mt-1">{logsStatus}</div>}
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        {/* ── Left: search + module list ── */}
        <div className="w-full md:w-56 md:shrink-0 space-y-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('help.searchPlaceholder')}
            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-brand-500/50"
          />

          <div className="space-y-1">
            {!query && (
              <button
                onClick={() => setSelectedId(OVERVIEW)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all ${
                  selectedId === OVERVIEW ? 'bg-brand-500/20 text-brand-400' : 'text-slate-400 hover:bg-white/5'
                }`}
              >
                🏠 {t('help.overview')}
              </button>
            )}

            {filtered.map((m) => (
              <button
                key={m.id}
                onClick={() => setSelectedId(m.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all ${
                  selectedId === m.id ? 'bg-brand-500/20 text-brand-400' : 'text-slate-400 hover:bg-white/5'
                }`}
              >
                {m.icon} {m.title[L]}
              </button>
            ))}

            {query && filtered.length === 0 && (
              <p className="px-3 py-2 text-sm text-slate-500">{t('help.noResults')}</p>
            )}
          </div>
        </div>

        {/* ── Right: content panel ── */}
        <div className="flex-1 glass-card p-6 min-w-0">
          {showOverview ? (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-white">{t('help.overviewTitle')}</h2>
              <p className="text-sm text-slate-300 leading-relaxed">{t('help.overviewBody')}</p>
              <h3 className="text-sm font-semibold text-white pt-2">{t('help.browseModules')}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {HELP_MODULES.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setSelectedId(m.id)}
                    className="text-left px-3 py-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-all"
                  >
                    <div className="text-sm font-medium text-white">{m.icon} {m.title[L]}</div>
                    <div className="text-xs text-slate-400 mt-0.5">{m.summary[L]}</div>
                  </button>
                ))}
              </div>
            </div>
          ) : selected ? (
            <article className="space-y-5">
              <header>
                <h2 className="text-lg font-semibold text-white">{selected.icon} {selected.title[L]}</h2>
                <p className="text-sm text-slate-400 mt-1">{selected.summary[L]}</p>
              </header>

              <Section title={t('help.section.whatItDoes')}>
                <p className="text-sm text-slate-300 leading-relaxed">{selected.whatItDoes[L]}</p>
              </Section>

              <ListSection title={t('help.section.commonActions')} items={selected.commonActions[L]} />

              <Section title={t('help.section.steps')}>
                <ol className="list-decimal pl-5 space-y-1 text-sm text-slate-300">
                  {selected.steps[L].map((s, i) => <li key={i}>{s}</li>)}
                </ol>
              </Section>

              {selected.warnings[L].length > 0 && (
                <Section title={`⚠️ ${t('help.section.warnings')}`}>
                  <ul className="space-y-1">
                    {selected.warnings[L].map((w, i) => (
                      <li key={i} className="text-sm text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">{w}</li>
                    ))}
                  </ul>
                </Section>
              )}

              <ListSection title={t('help.section.troubleshooting')} items={selected.troubleshooting[L]} />

              {selected.related.length > 0 && (
                <Section title={t('help.section.related')}>
                  <div className="flex flex-wrap gap-2">
                    {selected.related.map((rid) => {
                      const r = getHelpModule(rid);
                      if (!r) return null;
                      return (
                        <button
                          key={rid}
                          onClick={() => { setSearch(''); setSelectedId(rid); }}
                          className="text-xs px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-slate-300 hover:bg-brand-500/20 hover:text-brand-400 transition-all"
                        >
                          {r.icon} {r.title[L]}
                        </button>
                      );
                    })}
                  </div>
                </Section>
              )}
            </article>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-white uppercase tracking-wide">{title}</h3>
      {children}
    </section>
  );
}

function ListSection({ title, items }: { title: string; items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <Section title={title}>
      <ul className="list-disc pl-5 space-y-1 text-sm text-slate-300">
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ul>
    </Section>
  );
}
