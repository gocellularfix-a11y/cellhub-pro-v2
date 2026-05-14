// Companion Lite — Approvals panel (desktop).
// Creates test approvals and polls for current status. The "Send Test
// Approval" button is the MVP path; real wiring to approvalGuard
// happens later — this PR is core-flow only.

import { useCallback, useEffect, useState } from 'react';
import type {
  ApprovalRequest,
  CompanionLiteDesktopSession,
} from '@/types/companionLite';
import {
  createApproval,
  listApprovals,
} from '@/services/companionLite/approvalsService';

const POLL_MS = 3000;

interface Props {
  session: CompanionLiteDesktopSession;
}

export default function ApprovalsPanel({ session }: Props) {
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const items = await listApprovals(session);
      setApprovals(items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }, [session]);

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
      await createApproval(session, {
        type: 'discount',
        reason: 'Test approval — customer requesting 15% off accessories bundle.',
        employeeName: 'Maria Santos',
        affectedAmountCents: 4500,
        affectedItem: 'Accessories Bundle',
        expiresInMs: 15 * 60 * 1000,
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <button onClick={handleSendTest} disabled={busy} style={primaryButtonStyle}>
          {busy ? 'Sending…' : '+ Send Test Approval'}
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
        <div style={emptyStyle}>No approvals yet. Click "Send Test Approval" to create one.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {approvals.map(a => <ApprovalRow key={a.id} approval={a} />)}
        </div>
      )}
    </div>
  );
}

function ApprovalRow({ approval }: { approval: ApprovalRequest }) {
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
      <div style={{ fontSize: 11, color: '#64748b' }}>
        {approval.employeeName} · ${(approval.affectedAmountCents / 100).toFixed(2)}
        {approval.affectedItem ? ` · ${approval.affectedItem}` : ''}
      </div>
      {approval.respondedBy && (
        <div style={{ fontSize: 11, color: statusColor, marginTop: 6 }}>
          Resolved by {approval.respondedBy}
          {approval.respondedAt ? ` at ${new Date(approval.respondedAt).toLocaleTimeString()}` : ''}
          {approval.managerNote ? ` — "${approval.managerNote}"` : ''}
        </div>
      )}
    </div>
  );
}

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
