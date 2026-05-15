// Companion Lite — Approvals panel (desktop).
// Creates test approvals, polls for current status, and per-card supports
// a message thread plus product/discount cost context.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/store/AppProvider';
import type {
  ApprovalRequest,
  CompanionLiteDesktopSession,
  CompanionLiteMessage,
} from '@/types/companionLite';
import {
  createApproval,
  listApprovals,
  listApprovalMessages,
  sendApprovalMessage,
} from '@/services/companionLite/approvalsService';
import { deriveProductContext } from '@/services/companionLite/productContext';
import { useToast } from '@/components/ui/Toast';
import RequestApprovalModal from './RequestApprovalModal';

const POLL_MS = 3000;
const THREAD_POLL_MS = 3000;

interface Props {
  session: CompanionLiteDesktopSession;
}

export default function ApprovalsPanel({ session }: Props) {
  const { state: { inventory } } = useApp();
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  // The id of an approval we just created — used to auto-open its thread
  // on the very next render so the operator sees the conversation
  // immediately. Cleared once consumed.
  const [autoOpenId, setAutoOpenId] = useState<string | null>(null);
  const { toast } = useToast();
  const lastStatusRef = useRef<Map<string, ApprovalRequest['status']>>(new Map());

  const refresh = useCallback(async () => {
    try {
      const items = await listApprovals(session);
      const prev = lastStatusRef.current;
      for (const a of items) {
        const previousStatus = prev.get(a.id);
        if (previousStatus !== undefined
          && previousStatus === 'pending'
          && (a.status === 'approved' || a.status === 'denied')
        ) {
          const verb = a.status === 'approved' ? '✅ Approved' : '❌ Denied';
          const who = a.respondedBy ?? 'manager';
          const note = a.managerNote ? ` — "${a.managerNote}"` : '';
          toast(`${verb} by ${who}${note}`, a.status === 'approved' ? 'success' : 'warning');
        }
        prev.set(a.id, a.status);
      }
      setApprovals(items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }, [session, toast]);

  useEffect(() => {
    void refresh();
    const handle = setInterval(refresh, POLL_MS);
    return () => clearInterval(handle);
  }, [refresh]);

  const handleSendTest = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // Pick a real inventory item if any exists so the manager sees real
      // cost/retail data. Falls back to a no-context approval otherwise.
      const sample = inventory.find(i => typeof i.cost === 'number' && i.cost > 0)
        ?? inventory[0];
      const productContext = sample
        ? deriveProductContext({
            query: sample.id,
            inventory,
            requestedDiscountPercent: 15,
            requestedDiscountCents: Math.round(sample.price * 0.15),
          })
        : undefined;
      await createApproval(session, {
        type: 'discount',
        reason: sample
          ? `Test approval — customer requesting 15% off ${sample.name}.`
          : 'Test approval — customer requesting 15% off accessories bundle.',
        employeeName: 'Maria Santos',
        affectedAmountCents: productContext?.requestedDiscountCents ?? 4500,
        affectedItem: sample?.name ?? 'Accessories Bundle',
        expiresInMs: 15 * 60 * 1000,
        productContext,
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <button onClick={() => setRequestOpen(true)} style={primaryButtonStyle}>
          + Request Approval
        </button>
        <button onClick={handleSendTest} disabled={busy} style={secondaryButtonStyle}>
          {busy ? 'Sending…' : 'Send sample approval'}
        </button>
        <button onClick={() => void refresh()} style={ghostButtonStyle}>
          Refresh
        </button>
        <span style={{ fontSize: 11, color: '#64748b', marginLeft: 'auto' }}>
          Polling every {POLL_MS / 1000}s
        </span>
      </div>

      {error && <div style={errorBoxStyle}>{error}</div>}

      {approvals.length === 0 ? (
        <div style={emptyStyle}>
          No approvals yet. Click "Request Approval" to create one, or "Send sample approval" for a quick test.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {approvals.map(a => (
            <ApprovalRow
              key={a.id}
              approval={a}
              session={session}
              defaultOpen={a.id === autoOpenId}
              onConsumedDefaultOpen={() => setAutoOpenId(null)}
            />
          ))}
        </div>
      )}

      <RequestApprovalModal
        open={requestOpen}
        session={session}
        onClose={() => setRequestOpen(false)}
        onCreated={async (id) => {
          // Pull the freshly created row in immediately so the thread can
          // auto-mount, then mark its id so ApprovalRow renders open.
          setAutoOpenId(id);
          await refresh();
        }}
      />
    </div>
  );
}

// ── Row ─────────────────────────────────────────────────────────────

function ApprovalRow({
  approval, session, defaultOpen, onConsumedDefaultOpen,
}: {
  approval: ApprovalRequest;
  session: CompanionLiteDesktopSession;
  defaultOpen?: boolean;
  onConsumedDefaultOpen?: () => void;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  // Consume the parent's auto-open hint exactly once so a refresh that
  // brings the same id back doesn't re-open after the operator closes.
  useEffect(() => {
    if (defaultOpen) onConsumedDefaultOpen?.();
  }, [defaultOpen, onConsumedDefaultOpen]);
  const statusColor =
    approval.status === 'approved' ? '#22c55e' :
    approval.status === 'denied'   ? '#ef4444' :
    approval.status === 'expired'  ? '#64748b' :
    '#fbbf24';

  return (
    <div style={rowStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span style={typePillStyle}>{approval.type}</span>
        <span style={{ ...statusPillStyle, color: statusColor, borderColor: statusColor + '60' }}>
          {approval.status.toUpperCase()}
        </span>
        <span style={{ fontSize: 11, color: '#64748b', marginLeft: 'auto' }}>
          {new Date(approval.createdAt).toLocaleTimeString()}
        </span>
      </div>
      <div style={{ fontSize: 13, color: '#e2e8f0', marginBottom: 4 }}>
        {approval.reason}
      </div>
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>
        {approval.employeeName} · ${(approval.affectedAmountCents / 100).toFixed(2)}
        {approval.affectedItem ? ` · ${approval.affectedItem}` : ''}
      </div>
      {approval.respondedBy && (
        <div style={{ fontSize: 11, color: statusColor, marginTop: 4, marginBottom: 6 }}>
          Resolved by {approval.respondedBy}
          {approval.respondedAt ? ` at ${new Date(approval.respondedAt).toLocaleTimeString()}` : ''}
          {approval.managerNote ? ` — "${approval.managerNote}"` : ''}
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={threadToggleStyle}
      >
        {open ? '▾ Hide messages' : '▸ View / Send Message'}
      </button>
      {open && <ApprovalThread approval={approval} session={session} />}
    </div>
  );
}

// ── Thread ──────────────────────────────────────────────────────────

function ApprovalThread({
  approval, session,
}: {
  approval: ApprovalRequest;
  session: CompanionLiteDesktopSession;
}) {
  const [messages, setMessages] = useState<CompanionLiteMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  // Track ids we've toasted so a re-poll doesn't fire duplicates.
  const seenManagerIdsRef = useRef<Set<string> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const items = await listApprovalMessages(session, approval.id);
      if (seenManagerIdsRef.current === null) {
        const seed = new Set<string>();
        for (const m of items) if (m.fromRole === 'manager') seed.add(m.id);
        seenManagerIdsRef.current = seed;
      } else {
        const seen = seenManagerIdsRef.current;
        for (const m of items) {
          if (m.fromRole !== 'manager' || seen.has(m.id)) continue;
          seen.add(m.id);
          const who = m.fromName ?? 'Manager';
          const preview = m.body.length > 70 ? `${m.body.slice(0, 67)}…` : m.body;
          toast(`💬 Approval: ${who}: ${preview}`, 'info');
        }
      }
      setMessages(items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load');
    }
  }, [session, approval.id, toast]);

  useEffect(() => {
    void refresh();
    const handle = setInterval(refresh, THREAD_POLL_MS);
    return () => clearInterval(handle);
  }, [refresh]);

  const handleSend = async () => {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      await sendApprovalMessage(session, approval.id, body, 'Store');
      setDraft('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={threadContainerStyle}>
      <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {messages.length === 0
          ? <div style={threadEmptyStyle}>No messages yet for this approval.</div>
          : messages.map(m => <Bubble key={m.id} msg={m} />)}
      </div>
      {error && <div style={{ ...errorBoxStyle, marginTop: 6 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); } }}
          placeholder="Ask the manager about this approval…"
          disabled={busy}
          style={threadInputStyle}
        />
        <button onClick={() => void handleSend()} disabled={!draft.trim() || busy} style={threadSendStyle}>
          Send
        </button>
      </div>
    </div>
  );
}

function Bubble({ msg }: { msg: CompanionLiteMessage }) {
  const fromMe = msg.fromRole === 'pos';
  return (
    <div style={{ alignSelf: fromMe ? 'flex-end' : 'flex-start', maxWidth: '82%' }}>
      <div style={{
        background: fromMe ? 'rgba(56,189,248,0.14)' : 'rgba(148,163,184,0.10)',
        border: `1px solid ${fromMe ? 'rgba(56,189,248,0.30)' : 'rgba(148,163,184,0.20)'}`,
        borderRadius: 10,
        padding: '6px 10px',
        color: '#e2e8f0',
        fontSize: 12,
        lineHeight: 1.4,
        wordBreak: 'break-word',
      }}>
        {msg.body}
      </div>
      <div style={{ fontSize: 10, color: '#64748b', textAlign: fromMe ? 'right' : 'left', marginTop: 2 }}>
        {msg.fromName ?? (fromMe ? 'Store' : 'Manager')} · {new Date(msg.createdAt).toLocaleTimeString()}
      </div>
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────────

const primaryButtonStyle: React.CSSProperties = {
  background: '#38bdf8',
  border: 'none',
  borderRadius: 8,
  padding: '8px 14px',
  color: '#000',
  fontWeight: 700,
  fontSize: 12,
  cursor: 'pointer',
};
const secondaryButtonStyle: React.CSSProperties = {
  background: 'rgba(56,189,248,0.10)',
  border: '1px solid rgba(56,189,248,0.30)',
  borderRadius: 8,
  padding: '8px 12px',
  color: '#38bdf8',
  fontWeight: 600,
  fontSize: 12,
  cursor: 'pointer',
};
const ghostButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid rgba(148,163,184,0.25)',
  borderRadius: 6,
  padding: '6px 10px',
  color: '#94a3b8',
  fontSize: 12,
  cursor: 'pointer',
};
const rowStyle: React.CSSProperties = {
  background: 'rgba(15,23,42,0.6)',
  border: '1px solid rgba(148,163,184,0.15)',
  borderRadius: 10,
  padding: '10px 12px',
};
const typePillStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  padding: '2px 8px',
  background: 'rgba(148,163,184,0.10)',
  color: '#94a3b8',
  borderRadius: 4,
};
const statusPillStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.06em',
  padding: '2px 8px',
  border: '1px solid',
  borderRadius: 4,
  background: 'transparent',
};
const threadToggleStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px dashed rgba(148,163,184,0.25)',
  borderRadius: 6,
  padding: '4px 8px',
  color: '#94a3b8',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  marginTop: 4,
};
const threadContainerStyle: React.CSSProperties = {
  marginTop: 8,
  padding: 8,
  background: 'rgba(2,6,15,0.50)',
  border: '1px solid rgba(148,163,184,0.10)',
  borderRadius: 8,
};
const threadEmptyStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#64748b',
  fontStyle: 'italic',
  padding: 8,
  textAlign: 'center',
};
const threadInputStyle: React.CSSProperties = {
  flex: 1,
  background: 'rgba(15,23,42,0.6)',
  border: '1px solid rgba(148,163,184,0.20)',
  borderRadius: 6,
  padding: '6px 10px',
  color: '#e2e8f0',
  fontSize: 12,
  outline: 'none',
};
const threadSendStyle: React.CSSProperties = {
  background: '#38bdf8',
  border: 'none',
  borderRadius: 6,
  padding: '0 12px',
  color: '#000',
  fontWeight: 700,
  fontSize: 12,
  cursor: 'pointer',
};
const emptyStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#64748b',
  fontStyle: 'italic',
  padding: 20,
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
  marginBottom: 10,
};
