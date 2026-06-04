// ============================================================
// Companion — Desktop shell.
//
// Mounted by AppShell.tsx when activeTab === 'companion'.
//
// Hard rule: NO imports from src/services/companion or
// src/modules/companion. Companion stands alone.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { useApp } from '@/store/AppProvider';
import { useTranslation } from '@/i18n';
import type { CompanionDesktopSession } from '@/types/companion';
import {
  loadDesktopSession,
  clearDesktopSession,
} from '@/services/companion/identityStore';
import {
  startPairing,
  getPairStatus,
} from '@/services/companion/pairingService';
import { buildPairingQrPayload } from '@/services/companion/qrPayload';
import {
  consumeRouteHint,
  subscribe as subscribePending,
} from '@/services/companion/pendingNotifications';
import ApprovalsPanel from './ApprovalsPanel';
import MessagesPanel from './MessagesPanel';
import StatusPanel from './StatusPanel';
import IntelligenceStatusPanel from './IntelligenceStatusPanel';

type Tab = 'status' | 'approvals' | 'messages' | 'intelligence';
type PairingPhase = 'idle' | 'starting' | 'waiting' | 'claimed' | 'expired' | 'error';

const DEFAULT_BRIDGE_URL = 'https://cellhub-companion-production.up.railway.app';
const POLL_STATUS_MS = 3000;

export default function CompanionPage() {
  const { state: { settings, currentStoreId } } = useApp();
  const [session, setSession] = useState<CompanionDesktopSession | null>(null);
  const [tab, setTab] = useState<Tab>(() => {
    // First mount: if the bubble badge staged a sub-tab, open it directly.
    const hint = consumeRouteHint();
    return hint === 'messages' || hint === 'approvals' ? hint : 'status';
  });

  useEffect(() => {
    setSession(loadDesktopSession());
  }, []);

  // Already-mounted case: if the badge fires while the page is open,
  // switch to the requested sub-tab.
  useEffect(() => {
    const unsub = subscribePending(() => {
      const hint = consumeRouteHint();
      if (hint === 'messages' || hint === 'approvals') setTab(hint);
    });
    return unsub;
  }, []);

  const isPaired = session !== null;

  const handleSignOut = () => {
    clearDesktopSession();
    setSession(null);
  };

  return (
    <div style={shellStyle}>
      <Header isPaired={isPaired} session={session} onSignOut={handleSignOut} />
      {!isPaired
        ? (
          <PairingPanel
            bridgeUrl={DEFAULT_BRIDGE_URL}
            storeId={currentStoreId || settings.storeName || 'store'}
            storeName={settings.storeName || currentStoreId || 'Store'}
            onPaired={setSession}
          />
        )
        : <PairedShell session={session!} tab={tab} onTab={setTab} />
      }
    </div>
  );
}

// ── Header ───────────────────────────────────────────────────────────

function Header({
  isPaired, session, onSignOut,
}: {
  isPaired: boolean;
  session: CompanionDesktopSession | null;
  onSignOut: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
      <span style={{ fontSize: 30 }}>📲</span>
      <div style={{ flex: 1 }}>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: '#fff', margin: 0 }}>
          Companion
        </h1>
        <p style={{ fontSize: '0.85rem', color: '#94a3b8', margin: '2px 0 0' }}>
          {t('companion.subtitle')}
        </p>
      </div>
      <span style={pillStyle(isPaired ? '#22c55e' : '#94a3b8')}>
        {isPaired ? t('companion.status.paired') : t('companion.status.notPaired')}
      </span>
      {isPaired && session && (
        <button onClick={onSignOut} style={signOutButtonStyle}>
          {t('companion.unpair')}
        </button>
      )}
    </div>
  );
}

// ── Pairing flow ─────────────────────────────────────────────────────

function PairingPanel({
  bridgeUrl,
  storeId,
  storeName,
  onPaired,
}: {
  bridgeUrl: string;
  storeId: string;
  storeName: string;
  onPaired: (s: CompanionDesktopSession) => void;
}) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<PairingPhase>('idle');
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingSession, setPendingSession] = useState<CompanionDesktopSession | null>(null);

  const handleStart = async () => {
    setPhase('starting');
    setError(null);
    try {
      const result = await startPairing({ bridgeUrl, storeId, storeName });
      setCode(result.code);
      setExpiresAt(result.expiresAt);
      setPendingSession(result.session);
      setPhase('waiting');
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('companion.pair.unknownError');
      setError(msg);
      setPhase('error');
    }
  };

  // Poll /pair/status until claimed / expired.
  useEffect(() => {
    if (phase !== 'waiting' || !code || !pendingSession) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const status = await getPairStatus(bridgeUrl, code);
        if (cancelled) return;
        if (status.status === 'claimed') {
          setPhase('claimed');
          onPaired(pendingSession);
        } else if (status.status === 'expired') {
          setPhase('expired');
        }
      } catch {
        /* transient — keep polling */
      }
    };
    void tick();
    const handle = setInterval(tick, POLL_STATUS_MS);
    return () => { cancelled = true; clearInterval(handle); };
  }, [phase, code, pendingSession, bridgeUrl, onPaired]);

  if (phase === 'idle' || phase === 'error') {
    return (
      <div style={cardStyle}>
        <div style={titleStyle}>{t('companion.pair.title')}</div>
        <div style={bodyTextStyle}>
          {t('companion.pair.desc')}
        </div>
        <div style={{ display: 'flex', gap: 8, fontSize: 12, color: '#64748b', marginBottom: 12 }}>
          <span>{t('companion.pair.storeId')} <code style={codeInlineStyle}>{storeId}</code></span>
          <span>· {t('companion.pair.bridge')} <code style={codeInlineStyle}>{bridgeUrl.replace(/^https?:\/\//, '')}</code></span>
        </div>
        {error && (
          <div style={errorBoxStyle}>{error}</div>
        )}
        <button onClick={handleStart} style={primaryButtonStyle}>
          {t('companion.pair.start')}
        </button>
      </div>
    );
  }

  if (phase === 'starting') {
    return <div style={cardStyle}>{t('companion.pair.generating')}</div>;
  }

  if (phase === 'waiting') {
    return (
      <div style={cardStyle}>
        <div style={titleStyle}>{t('companion.pair.codeReady')}</div>
        <div style={{ display: 'flex', gap: 24, alignItems: 'center', justifyContent: 'center', margin: '20px 0', flexWrap: 'wrap' }}>
          {code && <QrPanel bridgeUrl={bridgeUrl} code={code} />}
          <div style={{ textAlign: 'center' }}>
            <div style={codeBigStyle}>{code}</div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {t('companion.pair.sixDigit')}
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          {expiresAt && (
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
              {t('companion.pair.expires', new Date(expiresAt).toLocaleTimeString())}
            </div>
          )}
        </div>
        <div style={bodyTextStyle}>
          {t('companion.pair.instrBefore')}<b>{t('companion.pair.scanQr')}</b>{t('companion.pair.instrAfter')}
        </div>
      </div>
    );
  }

  if (phase === 'expired') {
    return (
      <div style={cardStyle}>
        <div style={titleStyle}>{t('companion.pair.expiredTitle')}</div>
        <div style={bodyTextStyle}>
          {t('companion.pair.expiredDesc')}
        </div>
        <button onClick={handleStart} style={primaryButtonStyle}>{t('companion.pair.generateNew')}</button>
      </div>
    );
  }

  return <div style={cardStyle}>{t('companion.pair.pairedOk')}</div>;
}

// ── Paired shell ─────────────────────────────────────────────────────

function PairedShell({
  session, tab, onTab,
}: {
  session: CompanionDesktopSession;
  tab: Tab;
  onTab: (t: Tab) => void;
}) {
  const { t: tr } = useTranslation();
  return (
    <>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {(['status', 'approvals', 'messages', 'intelligence'] as Tab[]).map(tabId => (
          <button
            key={tabId}
            type="button"
            onClick={() => onTab(tabId)}
            style={tabButtonStyle(tabId === tab)}
          >
            {tabId === 'status'       ? tr('companion.tab.status')
            : tabId === 'approvals'  ? tr('companion.tab.approvals')
            : tabId === 'messages'   ? tr('companion.tab.messages')
            :                          tr('companion.tab.intelligence')}
          </button>
        ))}
      </div>
      <div style={cardStyle}>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
          {tr('companion.paired.toLabel')} <code style={codeInlineStyle}>{session.storeId}</code>
          {' · ' + tr('companion.paired.since') + ' '}
          {new Date(session.pairedAt).toLocaleTimeString()}
        </div>
        {tab === 'status'       && <StatusPanel session={session} />}
        {tab === 'approvals'    && <ApprovalsPanel session={session} />}
        {tab === 'messages'     && <MessagesPanel session={session} />}
        {tab === 'intelligence' && <IntelligenceStatusPanel />}
      </div>
    </>
  );
}

// ── QR panel ─────────────────────────────────────────────────────────

function QrPanel({ bridgeUrl, code }: { bridgeUrl: string; code: string }) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const payload = buildPairingQrPayload(bridgeUrl, code);
    QRCode.toCanvas(canvas, payload, {
      width: 168,
      margin: 1,
      color: { dark: '#0f1729', light: '#ffffff' },
    }).catch((err: unknown) => {
      setRenderError(err instanceof Error ? err.message : 'qr_failed');
    });
  }, [bridgeUrl, code]);

  if (renderError) {
    return (
      <div style={{ fontSize: 11, color: '#fca5a5' }}>{t('companion.qr.failed', renderError)}</div>
    );
  }

  return (
    <div style={{
      background: '#ffffff',
      padding: 8,
      borderRadius: 10,
      lineHeight: 0,
      boxShadow: '0 4px 20px rgba(56, 189, 248, 0.18)',
    }}>
      <canvas ref={canvasRef} />
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────

const shellStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.75rem',
  maxWidth: '900px',
  padding: '1rem 0',
};

const cardStyle: React.CSSProperties = {
  background: 'linear-gradient(160deg, #0e1320 0%, #070b14 100%)',
  border: '1px solid rgba(148,163,184,0.15)',
  borderRadius: '0.75rem',
  padding: '1rem 1.1rem',
};

const titleStyle: React.CSSProperties = {
  fontSize: 14, fontWeight: 700, color: '#e2e8f0', marginBottom: 8,
};

const bodyTextStyle: React.CSSProperties = {
  fontSize: 13, color: '#94a3b8', lineHeight: 1.5, marginBottom: 12,
};

const codeBigStyle: React.CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 48,
  fontWeight: 800,
  letterSpacing: 12,
  color: '#38bdf8',
};

const codeInlineStyle: React.CSSProperties = {
  fontFamily: 'monospace',
  background: 'rgba(148,163,184,0.10)',
  padding: '1px 6px',
  borderRadius: 4,
  fontSize: 11,
};

const pillStyle = (color: string): React.CSSProperties => ({
  fontSize: 12,
  fontWeight: 700,
  padding: '4px 10px',
  borderRadius: 999,
  background: 'rgba(148,163,184,0.10)',
  color,
  border: `1px solid ${color}40`,
});

const primaryButtonStyle: React.CSSProperties = {
  background: '#38bdf8',
  border: 'none',
  borderRadius: 8,
  padding: '10px 18px',
  color: '#000',
  fontWeight: 700,
  fontSize: 13,
  cursor: 'pointer',
};

const signOutButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid rgba(148,163,184,0.25)',
  borderRadius: 6,
  padding: '5px 10px',
  color: '#94a3b8',
  fontSize: 11,
  cursor: 'pointer',
};

const errorBoxStyle: React.CSSProperties = {
  background: 'rgba(239, 68, 68, 0.10)',
  border: '1px solid rgba(239, 68, 68, 0.30)',
  borderRadius: 8,
  padding: '8px 10px',
  fontSize: 12,
  color: '#fca5a5',
  marginBottom: 12,
};

const tabButtonStyle = (active: boolean): React.CSSProperties => ({
  flex: 1,
  padding: '8px 12px',
  background: active ? 'rgba(56,189,248,0.12)' : 'rgba(15,23,42,0.6)',
  border: `1px solid ${active ? 'rgba(56,189,248,0.35)' : 'rgba(148,163,184,0.18)'}`,
  borderRadius: 8,
  color: active ? '#38bdf8' : '#94a3b8',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
});
