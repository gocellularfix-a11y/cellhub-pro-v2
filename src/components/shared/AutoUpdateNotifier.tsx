// ============================================================
// CellHub Pro — Auto-Update Notifier (r-pkg-a2)
//
// Mounted once in AppShell. On mount, checks for updates via Electron's
// auto-updater. If an update is available, shows a non-intrusive banner
// at the top of the screen with Download / Install actions.
//
// Flow:
//   1. Mount → checkForUpdates()
//   2. update-available event → show "Update available" banner + Download btn
//   3. User clicks Download → downloadUpdate() → show progress state
//   4. update-downloaded event → show "Ready to install" banner + Install btn
//   5. User clicks Install → installUpdate() → app quits and reinstalls
//
// The component is a no-op when running in the browser (non-Electron).
// ============================================================

import { useState, useEffect } from 'react';
import { isElectron, getElectronAPI } from '@/utils/platform';

interface UpdateInfo {
  version?: string;
  releaseDate?: string;
}

type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'ready';

export default function AutoUpdateNotifier() {
  const [state, setState] = useState<UpdateState>('idle');
  const [info, setInfo] = useState<UpdateInfo>({});

  useEffect(() => {
    if (!isElectron()) return;
    const api = getElectronAPI();
    if (!api) return;

    // Listen for update events
    const offAvailable = api.onUpdateAvailable((data: unknown) => {
      const d = data as UpdateInfo;
      setInfo(d);
      setState('available');
    });

    const offDownloaded = api.onUpdateDownloaded((data: unknown) => {
      const d = data as UpdateInfo;
      setInfo(d);
      setState('ready');
    });

    // Check on mount
    setState('checking');
    api.checkForUpdates().catch(() => setState('idle'));

    return () => {
      offAvailable();
      offDownloaded();
    };
  }, []);

  const handleDownload = () => {
    const api = getElectronAPI();
    if (!api) return;
    setState('downloading');
    api.downloadUpdate();
  };

  const handleInstall = () => {
    const api = getElectronAPI();
    if (!api) return;
    api.installUpdate();
  };

  // Don't render anything if no update or running in browser
  if (state === 'idle' || state === 'checking') return null;

  const version = info.version ? `v${info.version}` : '';

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        padding: '0.5rem 1rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.75rem',
        fontSize: '0.82rem',
        fontWeight: 600,
        background: state === 'ready'
          ? 'linear-gradient(90deg, rgba(34,197,94,0.95), rgba(22,163,74,0.95))'
          : 'linear-gradient(90deg, rgba(99,102,241,0.95), rgba(79,70,229,0.95))',
        color: '#fff',
        boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
      }}
    >
      {state === 'available' && (
        <>
          <span>🚀 Update available {version}</span>
          <button
            onClick={handleDownload}
            style={{
              padding: '0.25rem 0.75rem',
              borderRadius: '0.35rem',
              border: '1px solid rgba(255,255,255,0.4)',
              background: 'rgba(255,255,255,0.15)',
              color: '#fff',
              fontWeight: 700,
              fontSize: '0.75rem',
              cursor: 'pointer',
            }}
          >
            Download
          </button>
        </>
      )}

      {state === 'downloading' && (
        <span>⏳ Downloading update {version}...</span>
      )}

      {state === 'ready' && (
        <>
          <span>✅ Update {version} ready to install</span>
          <button
            onClick={handleInstall}
            style={{
              padding: '0.25rem 0.75rem',
              borderRadius: '0.35rem',
              border: '1px solid rgba(255,255,255,0.4)',
              background: 'rgba(255,255,255,0.2)',
              color: '#fff',
              fontWeight: 700,
              fontSize: '0.75rem',
              cursor: 'pointer',
            }}
          >
            Install & Restart
          </button>
        </>
      )}
    </div>
  );
}
