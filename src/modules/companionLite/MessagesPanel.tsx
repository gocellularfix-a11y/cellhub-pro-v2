// Companion Lite — Messages panel (desktop).
// Single thread per store. Poll inbox + textarea + send button.

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CompanionLiteDesktopSession,
  CompanionLiteMessage,
} from '@/types/companionLite';
import {
  listMessages,
  sendMessage,
} from '@/services/companionLite/messagesService';

const POLL_MS = 3000;

interface Props {
  session: CompanionLiteDesktopSession;
}

export default function MessagesPanel({ session }: Props) {
  const [messages, setMessages] = useState<CompanionLiteMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const items = await listMessages(session);
      setMessages(items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load');
    }
  }, [session]);

  useEffect(() => {
    void refresh();
    const handle = setInterval(refresh, POLL_MS);
    return () => clearInterval(handle);
  }, [refresh]);

  useEffect(() => {
    // Scroll to bottom on new messages.
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length]);

  const handleSend = async () => {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      await sendMessage(session, body, 'Store');
      setDraft('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div
        ref={scrollRef}
        style={{
          maxHeight: 360,
          overflowY: 'auto',
          padding: '8px 4px',
          marginBottom: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {messages.length === 0
          ? <div style={emptyStyle}>No messages yet. Say hi to the manager.</div>
          : messages.map(m => <Bubble key={m.id} msg={m} />)
        }
      </div>

      {error && <div style={errorBoxStyle}>{error}</div>}

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); } }}
          placeholder="Write a message…"
          disabled={busy}
          style={inputStyle}
        />
        <button onClick={() => void handleSend()} disabled={!draft.trim() || busy} style={sendButtonStyle}>
          Send
        </button>
      </div>
    </div>
  );
}

function Bubble({ msg }: { msg: CompanionLiteMessage }) {
  const fromMe = msg.fromRole === 'pos';
  return (
    <div style={{
      alignSelf: fromMe ? 'flex-end' : 'flex-start',
      maxWidth: '78%',
    }}>
      <div style={{
        background: fromMe ? 'rgba(56,189,248,0.14)' : 'rgba(148,163,184,0.10)',
        border: `1px solid ${fromMe ? 'rgba(56,189,248,0.30)' : 'rgba(148,163,184,0.20)'}`,
        borderRadius: 10,
        padding: '8px 12px',
        color: '#e2e8f0',
        fontSize: 13,
        lineHeight: 1.4,
        wordBreak: 'break-word',
      }}>
        {msg.body}
      </div>
      <div style={{
        fontSize: 10,
        color: '#64748b',
        textAlign: fromMe ? 'right' : 'left',
        marginTop: 2,
      }}>
        {msg.fromName ?? (fromMe ? 'Store' : 'Manager')} · {new Date(msg.createdAt).toLocaleTimeString()}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  background: 'rgba(15,23,42,0.6)',
  border: '1px solid rgba(148,163,184,0.20)',
  borderRadius: 8,
  padding: '8px 12px',
  color: '#e2e8f0',
  fontSize: 13,
  outline: 'none',
};
const sendButtonStyle: React.CSSProperties = {
  background: '#38bdf8',
  border: 'none',
  borderRadius: 8,
  padding: '0 18px',
  color: '#000',
  fontWeight: 700,
  fontSize: 13,
  cursor: 'pointer',
};
const emptyStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#64748b',
  fontStyle: 'italic',
  padding: 30,
  textAlign: 'center',
  border: '1px dashed rgba(148,163,184,0.20)',
  borderRadius: 10,
};
const errorBoxStyle: React.CSSProperties = {
  background: 'rgba(239, 68, 68, 0.10)',
  border: '1px solid rgba(239, 68, 68, 0.30)',
  borderRadius: 6,
  padding: '6px 10px',
  fontSize: 12,
  color: '#fca5a5',
  marginBottom: 8,
};
