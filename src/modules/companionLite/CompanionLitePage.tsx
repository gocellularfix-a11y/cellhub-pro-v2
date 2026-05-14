// ============================================================
// Companion Lite — Desktop shell.
//
// Mounted by AppShell.tsx when activeTab === 'companionLite'.
//
// Hard rule: NO imports from src/services/companion or
// src/modules/companion. Companion Lite stands alone.
// ============================================================

import { useState } from 'react';
import type { CompanionLiteDesktopSession } from '@/types/companionLite';

type Tab = 'status' | 'approvals' | 'messages';

export default function CompanionLitePage() {
  const [session] = useState<CompanionLiteDesktopSession | null>(null);
  const [tab, setTab] = useState<Tab>('status');

  // Pairing UI is wired in Step 5. For now we render the shell + placeholders
  // so the menu entry has something honest to show.
  const isPaired = session !== null;

  return (
    <div style={shellStyle}>
      <Header isPaired={isPaired} />
      {!isPaired ? <NotPairedNotice /> : <PairedShell tab={tab} onTab={setTab} />}
    </div>
  );
}

function Header({ isPaired }: { isPaired: boolean }) {
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
    </div>
  );
}

function NotPairedNotice() {
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', marginBottom: 6 }}>
        Not paired yet
      </div>
      <div style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.5 }}>
        Pairing UI ships in Step 5. After that, this screen will show a 6-digit
        code + QR for the manager to scan from the Companion mobile app.
      </div>
    </div>
  );
}

function PairedShell({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
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
        <div style={{ fontSize: 13, color: '#94a3b8' }}>
          {tab === 'status' && 'Status panel — wired in Step 5/8.'}
          {tab === 'approvals' && 'Approvals panel — wired in Step 7.'}
          {tab === 'messages' && 'Messages panel — wired in Step 8.'}
        </div>
      </div>
    </>
  );
}

// ── Styles (inline; no shared stylesheet imports from legacy companion) ──

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

const pillStyle = (color: string): React.CSSProperties => ({
  fontSize: 12,
  fontWeight: 700,
  padding: '4px 10px',
  borderRadius: 999,
  background: 'rgba(148,163,184,0.10)',
  color,
  border: `1px solid ${color}40`,
});

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
