// ============================================================
// CellHub Pro — Print Media Guard Host (R-PRINT-MEDIA-GUARD-V1)
//
// The React surface for the printer media guard service:
//   • keeps the guard's printer→media map synced from settings
//     (settings.printerMediaTypes, configured in Settings → Hardware)
//   • renders the mismatch dialog (Cancel focused / Print Anyway)
//   • toasts label auto-route notices
//   • renders the jam-recovery guide when a print job fails
//
// Mounted ONCE in App.tsx. Renders nothing until the guard service asks
// for UI. IMPORTANT: PrintPreviewModal is a custom overlay at zIndex 9999
// (the shared <Modal> is z-50), and these dialogs must be able to appear
// ON TOP of it (the preview modal itself awaits the same confirmation
// promise) — so this host renders its own overlays at zIndex 10000.
// ============================================================

import { useEffect, useState, type ReactNode } from 'react';
import { useApp } from '@/store/AppProvider';
import { useToast } from '@/components/ui/Toast';
import { useTranslation } from '@/i18n';
import {
  registerPrintMediaGuardHost,
  syncPrinterMediaMap,
  type MediaGuardHostRequest,
  type MediaGuardMismatchRequest,
  type PrinterMediaMap,
} from '@/services/print/printMediaGuard';

function GuardOverlay({ children }: { children: ReactNode }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: '420px', maxWidth: '92vw',
        background: '#0f172a', border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: '0.75rem', boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        padding: '1.25rem',
      }}>
        {children}
      </div>
    </div>
  );
}

export default function PrintMediaGuardHost() {
  const { state } = useApp();
  const { settings } = state;
  const { toast } = useToast();
  const { t } = useTranslation();

  const [mismatch, setMismatch] = useState<MediaGuardMismatchRequest | null>(null);
  const [recoveryOpen, setRecoveryOpen] = useState(false);

  // Keep the service's map fresh — read via double-cast (StoreSettings is
  // extended per the canonical pattern, no src/store type change).
  const mediaMapRaw = (settings as unknown as { printerMediaTypes?: PrinterMediaMap }).printerMediaTypes;
  useEffect(() => {
    syncPrinterMediaMap(mediaMapRaw || {});
  }, [mediaMapRaw]);

  useEffect(() => {
    const handle = (req: MediaGuardHostRequest) => {
      if (req.kind === 'mismatch') {
        setMismatch(req);
      } else if (req.kind === 'reroute') {
        toast(t('print.mediaGuard.rerouted', req.to), 'info');
      } else if (req.kind === 'recovery') {
        setRecoveryOpen(true);
      }
    };
    registerPrintMediaGuardHost(handle);
    return () => registerPrintMediaGuardHost(null);
  }, [toast, t]);

  const answer = (proceed: boolean) => {
    if (mismatch) mismatch.resolve(proceed);
    setMismatch(null);
  };

  // Escape cancels the mismatch dialog (never prints).
  useEffect(() => {
    if (!mismatch) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') answer(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mismatch]);

  const mediaLabel = (m: string) => t(`print.media.${m}`);

  return (
    <>
      {mismatch && (
        <GuardOverlay>
          <div style={{ color: '#fbbf24', fontWeight: 700, fontSize: '1rem', marginBottom: '0.6rem' }}>
            🖨️ {t('print.mediaGuard.title')}
          </div>
          <p style={{ color: '#cbd5e1', fontSize: '0.88rem', lineHeight: 1.5, marginBottom: '1rem' }}>
            {t('print.mediaGuard.message', mediaLabel(mismatch.docMedia), mismatch.printerName, mediaLabel(mismatch.printerMedia))}
          </p>
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            {/* Cancel is the DEFAULT-FOCUSED action — Enter aborts, never prints. */}
            <button className="btn btn-secondary" autoFocus onClick={() => answer(false)}>
              {t('print.mediaGuard.cancel')}
            </button>
            <button className="btn btn-warning" onClick={() => answer(true)}>
              {t('print.mediaGuard.printAnyway')}
            </button>
          </div>
        </GuardOverlay>
      )}

      {recoveryOpen && (
        <GuardOverlay>
          <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: '1rem', marginBottom: '0.6rem' }}>
            🛠️ {t('print.mediaGuard.recoveryTitle')}
          </div>
          <p style={{ color: '#cbd5e1', fontSize: '0.88rem', marginBottom: '0.5rem' }}>
            {t('print.mediaGuard.recoveryBody')}
          </p>
          <ol style={{ color: '#cbd5e1', fontSize: '0.88rem', lineHeight: 1.6, paddingLeft: '1.2rem', marginBottom: '1rem', listStyle: 'decimal' }}>
            <li>{t('print.mediaGuard.recoveryStep1')}</li>
            <li>{t('print.mediaGuard.recoveryStep2')}</li>
            <li>{t('print.mediaGuard.recoveryStep3')}</li>
          </ol>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" autoFocus onClick={() => setRecoveryOpen(false)}>
              {t('print.mediaGuard.recoveryOk')}
            </button>
          </div>
        </GuardOverlay>
      )}
    </>
  );
}
