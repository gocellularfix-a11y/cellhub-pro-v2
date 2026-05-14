// ============================================================
// Companion Lite — Desktop shell.
//
// Mounted by AppShell.tsx when activeTab === 'companionLite'.
//
// Hard rule: NO imports from src/services/companion or
// src/modules/companion. Companion Lite stands alone.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { useApp } from '@/store/AppProvider';
import type { CompanionLiteDesktopSession } from '@/types/companionLite';
import {
  loadDesktopSession,
  clearDesktopSession,
} from '@/services/companionLite/identityStore';
import {
  startPairing,
  getPairStatus,
} from '@/services/companionLite/pairingService';
import { buildPairingQrPayload } from '@/services/companionLite/qrPayload';
import ApprovalsPanel from './ApprovalsPanel';
import MessagesPanel from './MessagesPanel';
import StatusPanel from './StatusPanel';

type Tab = 'status' | 'approvals' | 'messages';
type PairingPhase = 'idle' | 'starting' | 'waiting' | 'claimed' | 'expired' | 'error';

const DEFAULT_BRIDGE_URL = 'https://cellhub-companion-production.up.railway.app';
const POLL_STATUS_MS = 3000;

export default function CompanionLitePage() {
  const { state: { settings, currentStoreId } } = useApp();
  const [session, setSession] = useState<CompanionLiteDesktopSession | null>(null);
  const [tab, setTab] = useState<Tab>('status');

  useEffect(() => {
    setSession(loadDesktopSession());
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
  session: CompanionLiteDesktopSession | null;
  onSignOut: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
      <span style={{ fontSize: 30 }}>📲</span>
      <div style={{ flex: 1 }}>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: '#fff', margin: 0 }}>
          Companion Lite
        </h1>
        <p style={{ fontSize: '0.85rem', color: '#94a3b8', margin: '2px 0 0' }}>
          Simple polling-based bridge between desktop and the manager phone.
        </p>
      </div>
      <span style={pillStyle(isPaired ? '#22c55e' : '#94a3b8')}>
        {isPaired ? '● Paired' : '○ Not paired'}
      </span>
      {isPaired && session && (
        <button onClick={onSignOut} style={signOutButtonStyle}>
          Unpair
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
  onPaired: (s: CompanionLiteDesktopSession) => void;
}) {
  const [phase, setPhase] = useState<PairingPhase>('idle');
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingSession, setPendingSession] = useState<CompanionLiteDesktopSession | null>(null);

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
      const msg = err instanceof Error ? err.message : 'Unknown error';
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
        <div style={titleStyle}>Pair this terminal</div>
        <div style={bodyTextStyle}>
          Generates a 6-digit code that the manager enters on the Companion mobile app.
        </div>
        <div style={{ display: 'flex', gap: 8, fontSize: 12, color: '#64748b', marginBottom: 12 }}>
          <span>Store ID: <code style={codeInlineStyle}>{storeId}</code></span>
          <span>· Bridge: <code style={codeInlineStyle}>{bridgeUrl.replace(/^https?:\/\//, '')}</code></span>
        </div>
        {error && (
          <div style={errorBoxStyle}>{error}</div>
        )}
        <button onClick={handleStart} style={primaryButtonStyle}>
          Start Pairing
        </button>
      </div>
    );
  }

  if (phase === 'starting') {
    return <div style={cardStyle}>Generating code…</div>;
  }

  if (phase === 'waiting') {
    return (
      <div style={cardStyle}>
        <div style={titleStyle}>Code ready — scan or enter on your phone</div>
        <div style={{ display: 'flex', gap: 24, alignItems: 'center', justifyContent: 'center', margin: '20px 0', flexWrap: 'wrap' }}>
          {code && <QrPanel bridgeUrl={bridgeUrl} code={code} />}
          <div style={{ textAlign: 'center' }}>
            <div style={codeBigStyle}>{code}</div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              6-digit code
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          {expiresAt && (
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
              Expires {new Date(expiresAt).toLocaleTimeString()}
            </div>
          )}
        </div>
        <div style={bodyTextStyle}>
          Open Companion Lite on your phone → tap <b>Scan QR Code</b> and point at the QR,
          or enter the bridge URL + this 6-digit code manually. The desktop will detect
          the claim automatically.
        </div>
      </div>
    );
  }

  if (phase === 'expired') {
    return (
      <div style={cardStyle}>
        <div style={titleStyle}>Code expired</div>
        <div style={bodyTextStyle}>
          The pairing code timed out without being claimed. Click below to generate a fresh one.
        </div>
        <button onClick={handleStart} style={primaryButtonStyle}>Generate New Code</button>
      </div>
    );
  }

  return <div style={cardStyle}>Paired ✓</div>;
}

// ── Paired shell ─────────────────────────────────────────────────────

function PairedShell({
  session, tab, onTab,
}: {
  session: CompanionLiteDesktopSession;
  tab: Tab;
  onTab: (t: Tab) => void;
}) {
  return (
    <>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {(['status', 'approvals', 'messages'] as Tab[]).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => onTab(t)}
            style={tabButtonStyle(t === tab)}
          >
            {t === 'status' ? '🏪 Status' : t === 'approvals' ? '✅ Approvals' : '💬 Messages'}
          </button>
        ))}
      </div>
      <div style={cardStyle}>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
          Paired to <code style={codeInlineStyle}>{session.storeId}</code>
          {' · since '}
          {new Date(session.pairedAt).toLocaleTimeString()}
        </div>
        {tab === 'status' && <StatusPanel session={session} />}
        {tab === 'approvals' && <ApprovalsPanel session={session} />}
        {tab === 'messages' && <MessagesPanel session={session} />}
      </div>
    </>
  );
}

// ── QR panel ─────────────────────────────────────────────────────────

function QrPanel({ bridgeUrl, code }: { bridgeUrl: string; code: string }) {
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
      <div style={{ fontSize: 11, color: '#fca5a5' }}>QR failed: {renderError}</div>
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
