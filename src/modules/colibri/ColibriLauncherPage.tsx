// ============================================================
// CellHub Pro — Colibrí launcher page (P1-COLIBRI-LAUNCHER)
//
// A CellHub-native launcher surface for the INDEPENDENT Colibrí
// Commercial Studio. Architectural boundary (mandated):
//   - No Colibrí source, engines, database, or API inside CellHub.
//   - No fabricated "Connected" status — only what is locally verifiable
//     (configuration + channel availability + last recorded launch).
//   - Launch = existing external-URL hardening for URLs, or the ONE
//     narrow validated Electron channel for a local .exe. Nothing else.
//   - CellHub never blocks or degrades when Colibrí is unavailable.
// Future actions render as explicitly disabled (Coming Soon) — no fake
// data transfer is implemented or simulated.
// ============================================================

import { useMemo, useState } from 'react';
import { useApp } from '@/store/AppProvider';
import { useTranslation } from '@/i18n';
import { useToast } from '@/components/ui/Toast';
import { openExternalIfOnline } from '@/hooks/useOnlineStatus';
import { persistSettings } from '@/services/persist';
import {
  readColibriConfig, resolveColibriLaunch, isValidColibriTarget,
} from '@/services/colibri/launcher';

export default function ColibriLauncherPage() {
  const { state: { settings }, setSettings } = useApp();
  const { t, locale } = useTranslation();
  const { toast } = useToast();

  const config = useMemo(() => readColibriConfig(settings), [settings]);
  const canLaunchPath = typeof window !== 'undefined' && !!window.electronAPI?.colibriLaunch;
  const launch = useMemo(() => resolveColibriLaunch(config, canLaunchPath), [config, canLaunchPath]);

  const [targetDraft, setTargetDraft] = useState(config.target);
  const [enabledDraft, setEnabledDraft] = useState(config.enabled);
  const [launching, setLaunching] = useState(false);

  const fmtDate = (iso?: string) =>
    iso ? new Date(iso).toLocaleString(locale === 'en' ? 'en-US' : locale === 'pt' ? 'pt-BR' : 'es-MX') : t('colibri.status.never');

  const recordLaunch = () => {
    const now = new Date().toISOString();
    // Delta-only settings update (r26 C4 pattern).
    setSettings({ colibriLastLaunchAt: now } as Record<string, unknown>);
    persistSettings({ colibriLastLaunchAt: now } as Record<string, unknown>);
  };

  const handleOpen = async () => {
    if (launching || launch.state !== 'ready') return;
    setLaunching(true);
    try {
      if (launch.kind === 'url') {
        const opened = openExternalIfOnline(launch.target, '_blank', 'noopener,noreferrer');
        if (opened) { recordLaunch(); toast(t('colibri.launched'), 'success'); }
        // offline case already toasts via guardOnline — no false success recorded
      } else {
        const res = await window.electronAPI!.colibriLaunch!(launch.target);
        if (res?.ok) { recordLaunch(); toast(t('colibri.launched'), 'success'); }
        else {
          console.warn('[colibri] launch failed:', res?.error);
          toast(t('colibri.launchFailed'), 'error');
        }
      }
    } catch (err) {
      console.warn('[colibri] launch exception:', err);
      toast(t('colibri.launchFailed'), 'error');
    } finally {
      setLaunching(false);
    }
  };

  const saveConfig = () => {
    const trimmed = targetDraft.trim();
    if (trimmed && !isValidColibriTarget(trimmed)) {
      toast(t('colibri.config.invalidTarget'), 'error');
      return;
    }
    // Delta-only settings update; persisted via the canonical settings merge.
    const delta = { colibriTarget: trimmed, colibriEnabled: enabledDraft } as Record<string, unknown>;
    setSettings(delta);
    persistSettings(delta);
    toast(t('colibri.config.saved'), 'success');
  };

  const statusChip = (ok: boolean, okLabel: string, badLabel: string) => (
    <span style={{
      padding: '0.15rem 0.6rem', borderRadius: 999, fontSize: '0.7rem', fontWeight: 700,
      textTransform: 'uppercase',
      background: ok ? 'rgba(16,185,129,0.15)' : 'rgba(148,163,184,0.15)',
      color: ok ? '#10b981' : '#94a3b8',
    }}>
      {ok ? okLabel : badLabel}
    </span>
  );

  const futureActions = [
    { key: 'create', label: t('colibri.future.create'), icon: '🎬' },
    { key: 'sendContext', label: t('colibri.future.sendContext'), icon: '📦' },
    { key: 'viewContent', label: t('colibri.future.viewContent'), icon: '🖼️' },
    { key: 'settings', label: t('colibri.future.settings'), icon: '🔌' },
  ];

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <div className="text-center py-6">
        <div style={{ fontSize: '3rem', lineHeight: 1 }}>🐦</div>
        <h1 className="text-3xl font-bold mt-2" style={{
          background: 'linear-gradient(135deg, #e879f9, #a78bfa)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>
          {t('colibri.title')}
        </h1>
        <p className="text-sm font-semibold text-fuchsia-300/80 uppercase tracking-widest mt-1">{t('colibri.subtitle')}</p>
        <p className="text-sm text-slate-400 mt-3 max-w-md mx-auto">{t('colibri.purpose')}</p>
      </div>

      {/* Status card */}
      <div className="rounded-xl bg-white/5 border border-white/10 p-4">
        <p className="text-xs text-slate-400 uppercase tracking-wide mb-3">{t('colibri.status.title')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-slate-500">{t('colibri.status.integration')}</span>
            {statusChip(config.enabled, t('colibri.status.enabled'), t('colibri.status.disabled'))}
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-slate-500">{t('colibri.status.availability')}</span>
            {statusChip(launch.state === 'ready', t('colibri.status.configured'), t('colibri.status.notConfigured'))}
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-slate-500">{t('colibri.status.lastLaunch')}</span>
            <span className="text-slate-300 text-xs">{fmtDate(config.lastLaunchAt)}</span>
          </div>
        </div>
        {launch.state === 'path_needs_desktop' && (
          <p className="text-xs text-amber-400 mt-3">{t('colibri.pathNeedsDesktop')}</p>
        )}
        {(launch.state === 'not_configured' || launch.state === 'disabled' || launch.state === 'invalid_target') && (
          <p className="text-xs text-slate-500 mt-3">{t('colibri.notConfiguredHint')}</p>
        )}
      </div>

      {/* Primary action */}
      <button
        onClick={handleOpen}
        disabled={launch.state !== 'ready' || launching}
        className="w-full py-4 rounded-xl text-lg font-bold transition-all"
        style={launch.state === 'ready'
          ? { background: 'linear-gradient(135deg, #a21caf, #7c3aed)', color: 'white', cursor: 'pointer', opacity: launching ? 0.7 : 1 }
          : { background: 'rgba(255,255,255,0.05)', color: '#64748b', cursor: 'not-allowed' }}
      >
        🚀 {t('colibri.open')}
      </button>

      {/* Secondary (future) actions — explicitly unavailable, never fake */}
      <div className="grid grid-cols-2 gap-2">
        {futureActions.map((a) => (
          <div key={a.key} className="rounded-xl bg-white/5 border border-white/10 p-3 flex items-center gap-3 opacity-60">
            <span style={{ fontSize: '1.3rem' }}>{a.icon}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-slate-300 truncate">{a.label}</p>
              <p className="text-[0.65rem] text-amber-400/80 uppercase font-bold">{t('colibri.comingSoon')}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Configuration */}
      <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-3">
        <p className="text-xs text-slate-400 uppercase tracking-wide">{t('colibri.config.title')}</p>
        <div>
          <label className="text-xs text-slate-500 block mb-1">{t('colibri.config.target')}</label>
          <input
            type="text" className="input w-full font-mono text-xs"
            placeholder="https://…  ·  C:\Program Files\Colibri\Colibri.exe"
            value={targetDraft} onChange={(e) => setTargetDraft(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
          <input type="checkbox" checked={enabledDraft} onChange={(e) => setEnabledDraft(e.target.checked)} />
          {t('colibri.config.enable')}
        </label>
        <div className="flex justify-end">
          <button className="btn btn-primary" onClick={saveConfig}>💾 {t('colibri.config.save')}</button>
        </div>
      </div>

      <p className="text-xs text-slate-600 text-center">{t('colibri.independentNote')}</p>
    </div>
  );
}
