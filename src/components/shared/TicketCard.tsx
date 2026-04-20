// ============================================================
// CellHub Pro — Ticket Card (list row)
// ============================================================

import { formatCurrency } from '@/utils/currency';
import { formatDate } from '@/utils/dates';
import { forwardRef } from 'react';

interface TicketCardProps {
  ticketNumber: string;
  customerName: string;
  customerPhone?: string;
  device?: string;
  issue?: string;
  status: string;
  statusBadgeClass: string;
  total: number;          // cents
  deposit: number;        // cents
  balance: number;        // cents
  createdAt: string;
  priority?: string;
  pendingCents?: number;  // cents — items in cart with this entity's id, not yet checked out
  onClick: () => void;
  onCollectBalance?: () => void;
  onWhatsApp?: () => void;
  highlighted?: boolean;  // flash from GlobalSearch navigate
  lang: string;
  L: Record<string, any>;

  // NEW — optional action callbacks. If provided, renders a button.
  onDeposit?: () => void;
  onComplete?: () => void;
  onPrint?: () => void;
  onSMS?: () => void;
  onDelete?: () => void;

  // NEW — complete button state hints (Repairs sets these; others don't)
  completeLabel?: string;
  completeDisabled?: boolean;
  completeVariant?: 'amber' | 'green' | 'neutral';

  // NEW — SMS button enabled state
  smsAvailable?: boolean;
}

const TicketCard = forwardRef<HTMLDivElement, TicketCardProps>(function TicketCard({
  ticketNumber,
  customerName,
  customerPhone,
  device,
  issue,
  status,
  statusBadgeClass,
  total,
  deposit,
  balance,
  createdAt,
  priority,
  pendingCents = 0,
  onClick,
  onCollectBalance,
  onWhatsApp,
  highlighted,
  lang,
  L,
  onDeposit,
  onComplete,
  onPrint,
  onSMS,
  onDelete,
  completeLabel,
  completeDisabled,
  completeVariant = 'amber',
  smsAvailable = false,
}, ref) {
  return (
    <div
      ref={ref}
      onClick={onClick}
      className="glass-card p-4 cursor-pointer hover:bg-white/10 transition-all"
      style={highlighted ? {
        outline: '2px solid #667eea',
        boxShadow: '0 0 0 4px rgba(102,126,234,0.15)',
        animation: 'cellhub-highlight-pulse 1s ease-in-out 3',
      } : undefined}
    >
      <div className="flex items-start justify-between gap-4">
        {/* Left: info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-bold text-brand-400">{ticketNumber}</span>
            <span className={`badge ${statusBadgeClass}`}>{status}</span>
            {priority && priority !== 'Normal' && priority !== 'normal' && (
              <span className={`badge ${
                priority === 'urgent' || priority === 'Urgent' ? 'badge-danger' :
                priority === 'high' || priority === 'High' ? 'badge-warning' : 'badge-neutral'
              }`}>
                {priority}
              </span>
            )}
          </div>
          <p className="text-sm text-white font-medium">{customerName}</p>
          {customerPhone && (
            <p className="text-xs text-slate-500">{customerPhone}</p>
          )}
          {device && (
            <p className="text-xs text-slate-400 mt-1">{device}</p>
          )}
          {issue && (
            <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{issue}</p>
          )}
        </div>

        {/* Right: financials */}
        <div className="text-right shrink-0">
          <p className="text-sm font-bold text-white">{formatCurrency(total)}</p>
          {deposit > 0 && (
            <p className="text-xs text-emerald-400">
              {L.deposit || 'Deposit'}: {formatCurrency(deposit)}
            </p>
          )}
          {balance > 0 && (
            <p className="text-xs text-amber-400">
              {L.balance || 'Balance'}: {formatCurrency(balance)}
            </p>
          )}
          {pendingCents > 0 && (
            <p className="text-xs" style={{ color: '#fb923c' }}>
              🛒 {formatCurrency(pendingCents)} {L.inCart || 'in cart'}
            </p>
          )}
          <p className="text-xs text-slate-600 mt-1">{formatDate(createdAt)}</p>
          {onDeposit && (
            <button
              onClick={(e) => { e.stopPropagation(); onDeposit(); }}
              className="btn btn-secondary btn-sm"
              style={{ fontSize: '0.82rem' }}
              title={L.deposit || 'Deposit'}
            >
              + {L.deposit || 'Deposit'}
            </button>
          )}
          {onComplete && (
            <button
              onClick={(e) => { e.stopPropagation(); if (!completeDisabled) onComplete(); }}
              disabled={completeDisabled}
              style={{
                fontSize: '0.82rem',
                padding: '0.5rem 0.75rem',
                borderRadius: '0.5rem',
                border: '1px solid',
                cursor: completeDisabled ? 'not-allowed' : 'pointer',
                opacity: completeDisabled ? 0.6 : 1,
                background: completeVariant === 'green' ? 'rgba(16,185,129,0.2)'
                          : completeVariant === 'amber' ? 'rgba(245,158,11,0.15)'
                          : 'rgba(255,255,255,0.05)',
                color: completeVariant === 'green' ? '#10b981'
                     : completeVariant === 'amber' ? '#f59e0b'
                     : '#9ca3af',
                borderColor: completeVariant === 'green' ? 'rgba(16,185,129,0.4)'
                           : completeVariant === 'amber' ? 'rgba(245,158,11,0.4)'
                           : 'rgba(255,255,255,0.1)',
              }}
            >
              {completeLabel || (L.complete || 'Complete')}
            </button>
          )}
          {balance > 0 && onCollectBalance && (
            <button
              onClick={(e) => { e.stopPropagation(); onCollectBalance(); }}
              className="btn btn-success btn-sm mt-2 text-xs"
            >
              💰 {L.collectBalance || 'Collect'}
            </button>
          )}
          {onWhatsApp && customerPhone && (
            <button
              onClick={(e) => { e.stopPropagation(); onWhatsApp(); }}
              className="btn btn-sm mt-1 text-xs"
              style={{ background: 'rgba(37,211,102,0.15)', color: '#25d366', border: '1px solid rgba(37,211,102,0.3)', width: '100%' }}
              title={`WhatsApp ${customerPhone}`}
            >
              📱 WhatsApp
            </button>
          )}
          <div style={{ display: 'flex', gap: '0.3rem' }}>
            {onPrint && (
              <button onClick={(e) => { e.stopPropagation(); onPrint(); }}
                      className="btn btn-secondary btn-sm"
                      style={{ padding: '0.4rem 0.6rem' }}
                      title={L.print || 'Print'}>🖨</button>
            )}
            {onSMS && (
              <button onClick={(e) => { e.stopPropagation(); if (smsAvailable) onSMS(); }}
                      className="btn btn-secondary btn-sm"
                      disabled={!smsAvailable}
                      style={{ padding: '0.4rem 0.6rem', opacity: smsAvailable ? 1 : 0.4 }}
                      title="SMS">💬</button>
            )}
            {onDelete && (
              <button onClick={(e) => { e.stopPropagation(); onDelete(); }}
                      style={{ padding: '0.4rem 0.6rem', borderRadius: '0.5rem',
                               background: 'rgba(239,68,68,0.15)', color: '#ef4444',
                               border: '1px solid rgba(239,68,68,0.35)', cursor: 'pointer' }}
                      title={L.delete || 'Delete'}>🗑</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

export default TicketCard;

// Inject pulse keyframe once
if (typeof document !== 'undefined' && !document.getElementById('cellhub-highlight-style')) {
  const style = document.createElement('style');
  style.id = 'cellhub-highlight-style';
  style.textContent = `
    @keyframes cellhub-highlight-pulse {
      0%, 100% { box-shadow: 0 0 0 4px rgba(102,126,234,0.15); }
      50% { box-shadow: 0 0 0 8px rgba(102,126,234,0.3); }
    }
  `;
  document.head.appendChild(style);
}
