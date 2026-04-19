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
  onClick: () => void;
  onCollectBalance?: () => void;
  onWhatsApp?: () => void;
  highlighted?: boolean;  // flash from GlobalSearch navigate
  lang: string;
  L: Record<string, any>;
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
  onClick,
  onCollectBalance,
  onWhatsApp,
  highlighted,
  lang,
  L,
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
          <p className="text-xs text-slate-600 mt-1">{formatDate(createdAt)}</p>
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
