// Companion — Approvals panel (desktop).
// Creates test approvals, polls for current status, and per-card supports
// a message thread plus product/discount cost context.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/store/AppProvider';
import { useTranslation } from '@/i18n';
import type {
  ApprovalRequest,
  CompanionDesktopSession,
  CompanionMessage,
} from '@/types/companion';
import { CompanionApiError } from '@/services/companion/apiClient';
import {
  createApproval,
  listApprovals,
  listApprovalMessages,
  sendApprovalMessage,
} from '@/services/companion/approvalsService';
import { deriveProductContext } from '@/services/companion/productContext';
// Notification routing (toast + bubble + badge) for status transitions
// and inbound messages is owned by the global CompanionRuntime
// mounted in AppShell. This panel only renders + sends.
import RequestApprovalModal from './RequestApprovalModal';

const POLL_MS = 3000;
const THREAD_POLL_MS = 3000;

interface Props {
  session: CompanionDesktopSession;
}

export default function ApprovalsPanel({ session }: Props) {
  const { t } = useTranslation();
  const { state: { inventory } } = useApp();
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  // The id of an approval we just created — used to auto-open its thread
  // on the very next render so the operator sees the conversation
  // immediately. Cleared once consumed.
  const [autoOpenId, setAutoOpenId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const items = await listApprovals(session);
      setApprovals(items);
      setError(null);
    } catch (err) {
      if (err instanceof CompanionApiError && err.httpStatus === 401) {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        setError(t('companion.appr.sessionExpiredUnpair'));
      } else {
        setError(err instanceof Error ? err.message : t('companion.appr.failedToLoad'));
      }
    }
  }, [session, t]);

  useEffect(() => {
    void refresh();
    const handle = setInterval(refresh, POLL_MS);
    pollRef.current = handle;
    return () => { clearInterval(handle); pollRef.current = null; };
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
          ? t('companion.appr.sampleReason', sample.name)
          : t('companion.appr.sampleReasonGeneric'),
        employeeName: 'Maria Santos',
        affectedAmountCents: productContext?.requestedDiscountCents ?? 4500,
        affectedItem: sample?.name ?? t('companion.appr.sampleItem'),
        expiresInMs: 15 * 60 * 1000,
        productContext,
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('companion.appr.sendFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <button onClick={() => setRequestOpen(true)} style={primaryButtonStyle}>
          {t('companion.appr.request')}
        </button>
        <button onClick={handleSendTest} disabled={busy} style={secondaryButtonStyle}>
          {busy ? t('companion.appr.sending') : t('companion.appr.sendSample')}
        </button>
        <button onClick={() => void refresh()} style={ghostButtonStyle}>
          {t('companion.appr.refresh')}
        </button>
        <span style={{ fontSize: 11, color: '#64748b', marginLeft: 'auto' }}>
          {t('companion.appr.polling', POLL_MS / 1000)}
        </span>
      </div>

      {error && <div style={errorBoxStyle}>{error}</div>}

      {approvals.length === 0 ? (
        <div style={emptyStyle}>
          {t('companion.appr.empty')}
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
  session: CompanionDesktopSession;
  defaultOpen?: boolean;
  onConsumedDefaultOpen?: () => void;
}) {
  const { t } = useTranslation();
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

  // Localized status/type labels with safe fallback to the raw value.
  const typeKey = `companion.apprType.${approval.type}`;
  const typeLabel = (() => { const l = t(typeKey); return l === typeKey ? approval.type : l; })();
  const statusKey = `companion.apprStatus.${approval.status}`;
  const statusLabel = (() => { const l = t(statusKey); return l === statusKey ? approval.status : l; })();

  return (
    <div style={rowStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span style={typePillStyle}>{typeLabel}</span>
        <span style={{ ...statusPillStyle, color: statusColor, borderColor: statusColor + '60' }}>
          {statusLabel.toUpperCase()}
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
          {t('companion.appr.resolvedBy', approval.respondedBy)}
          {approval.respondedAt ? ` ${t('companion.appr.atTime', new Date(approval.respondedAt).toLocaleTimeString())}` : ''}
          {approval.managerNote ? ` — "${approval.managerNote}"` : ''}
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={threadToggleStyle}
      >
        {open ? t('companion.appr.hideMessages') : t('companion.appr.viewMessages')}
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
  session: CompanionDesktopSession;
}) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<CompanionMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const items = await listApprovalMessages(session, approval.id);
      setMessages(items);
      setError(null);
    } catch (err) {
      if (err instanceof CompanionApiError && err.httpStatus === 401) {
        if (threadPollRef.current) { clearInterval(threadPollRef.current); threadPollRef.current = null; }
        setError(t('companion.appr.sessionExpired'));
      } else {
        setError(err instanceof Error ? err.message : t('companion.msg.couldNotLoad'));
      }
    }
  }, [session, approval.id, t]);

  useEffect(() => {
    void refresh();
    const handle = setInterval(refresh, THREAD_POLL_MS);
    threadPollRef.current = handle;
    return () => { clearInterval(handle); threadPollRef.current = null; };
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
      setError(err instanceof Error ? err.message : t('companion.msg.couldNotSend'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={threadContainerStyle}>
      <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {messages.length === 0
          ? <div style={threadEmptyStyle}>{t('companion.appr.threadEmpty')}</div>
          : messages.map(m => <Bubble key={m.id} msg={m} />)}
      </div>
      {error && <div style={{ ...errorBoxStyle, marginTop: 6 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); } }}
          placeholder={t('companion.appr.threadPlaceholder')}
          disabled={busy}
          style={threadInputStyle}
        />
        <button onClick={() => void handleSend()} disabled={!draft.trim() || busy} style={threadSendStyle}>
          {t('companion.msg.send')}
        </button>
      </div>
    </div>
  );
}

function Bubble({ msg }: { msg: CompanionMessage }) {
  const { t } = useTranslation();
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
        {msg.fromName ?? (fromMe ? t('companion.role.store') : t('companion.role.manager'))} · {new Date(msg.createdAt).toLocaleTimeString()}
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
