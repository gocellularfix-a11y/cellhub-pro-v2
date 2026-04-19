// ============================================================
// CellHub Pro — PWA Install Prompt
// Shows a banner offering to install as native app on Chromebook,
// Android, desktop Chrome, etc. Only renders in browser mode
// (not Electron) and only when the browser fires beforeinstallprompt.
// ============================================================

import { useEffect, useState } from 'react';
import { isElectron } from '@/utils/platform';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISSED_KEY = 'cellhub_pwa_install_dismissed';

export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  // Detect language from localStorage (matches rest of app)
  const lang = (typeof window !== 'undefined' && localStorage.getItem('cellhub_lang')) || 'en';
  const es = lang === 'es';

  useEffect(() => {
    // Skip entirely in Electron — already a "native" app
    if (isElectron()) return;

    // Skip if user previously dismissed (within 30 days)
    const dismissed = localStorage.getItem(DISMISSED_KEY);
    if (dismissed) {
      const dismissedAt = parseInt(dismissed, 10);
      const daysSince = (Date.now() - dismissedAt) / (1000 * 60 * 60 * 24);
      if (daysSince < 30) return;
    }

    // Skip if already running as installed PWA
    if (window.matchMedia('(display-mode: standalone)').matches) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setVisible(false);
      setDeferredPrompt(null);
    }
  };

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    setVisible(false);
  };

  if (!visible || !deferredPrompt) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-[300] glass-card p-4 max-w-sm shadow-2xl border border-brand-500/30"
      style={{ background: 'rgba(15, 23, 42, 0.95)', backdropFilter: 'blur(12px)' }}
    >
      <div className="flex items-start gap-3">
        <div className="text-3xl">📱</div>
        <div className="flex-1">
          <div className="font-bold text-white mb-1">
            {es ? 'Instalar CellHub Pro' : 'Install CellHub Pro'}
          </div>
          <div className="text-xs text-slate-400 mb-3">
            {es
              ? 'Instálalo como app para acceso rápido y modo sin conexión.'
              : 'Install as an app for quick access and offline mode.'}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleInstall}
              className="btn btn-primary text-xs px-3 py-1.5"
            >
              {es ? 'Instalar' : 'Install'}
            </button>
            <button
              onClick={handleDismiss}
              className="text-xs px-3 py-1.5 text-slate-400 hover:text-white"
            >
              {es ? 'Ahora no' : 'Not now'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
