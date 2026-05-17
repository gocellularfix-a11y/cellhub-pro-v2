// ============================================================
// CellHub Pro — Ticket Card (list row)
// ============================================================

import { formatCurrency } from '@/utils/currency';
import { formatDate } from '@/utils/dates';
import { forwardRef, type ReactNode } from 'react';
import { useTranslation } from '@/i18n';
import { STATUS_LABELS } from '@/i18n/statusMap';

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

  // NEW — optional action callbacks. If provided, renders a button.
  onDeposit?: () => void;
  onComplete?: () => void;
  onPrint?: () => void;
  onDelete?: () => void;

  // NEW — complete button state hints (Repairs sets these; others don't)
  completeLabel?: string;
  completeDisabled?: boolean;
  completeVariant?: 'amber' | 'green' | 'neutral';

  // R-EDIT-AUDIT: optional extra badges rendered alongside the status/priority
  // badges (e.g. edit-history indicator). Caller is responsible for event
  // handling; stopPropagation in onClick to prevent card click passthrough.
  extraBadges?: ReactNode;

  // Intelligence operator actions — open Intelligence with repair/customer context.
  onFollowUp?: () => void;
  onEscalate?: () => void;
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
  onDeposit,
  onComplete,
  onPrint,
  onDelete,
  completeLabel,
  completeDisabled,
  completeVariant = 'amber',
  extraBadges,
  onFollowUp,
  onEscalate,
}, ref) {
  const { t } = useTranslation();
  const statusLabels = STATUS_LABELS(t);
  const PRIORITY_LABELS: Record<string, string> = {
    Normal: t('priority.normal'),
    normal: t('priority.normal'),
    Low: t('priority.low'),
    low: t('priority.low'),
    High: t('priority.high'),
    high: t('priority.high'),
    Urgent: t('priority.urgent'),
    urgent: t('priority.urgent'),
  };
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
            <span className={`badge ${statusBadgeClass}`}>{statusLabels[status as keyof typeof statusLabels] ?? status}</span>
            {priority && priority !== 'Normal' && priority !== 'normal' && (
              <span className={`badge ${
                priority === 'urgent' || priority === 'Urgent' ? 'badge-danger' :
                priority === 'high' || priority === 'High' ? 'badge-warning' : 'badge-neutral'
              }`}>
                {PRIORITY_LABELS[priority] ?? priority}
              </span>
            )}
            {extraBadges}
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
              {t('ticket.deposit')}: {formatCurrency(deposit)}
            </p>
          )}
          {balance > 0 && (
            <p className="text-xs text-amber-400">
              {t('ticket.balance')}: {formatCurrency(balance)}
            </p>
          )}
          {pendingCents > 0 && (
            <p className="text-xs" style={{ color: '#fb923c' }}>
              🛒 {formatCurrency(pendingCents)} {t('ticket.inCart')}
            </p>
          )}
          <p className="text-xs text-slate-600 mt-1">{formatDate(createdAt)}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', minWidth: 160, marginTop: '0.5rem' }}>
            {/* Primary buttons with labels */}
            {onDeposit && (
              <button
                onClick={(e) => { e.stopPropagation(); onDeposit(); }}
                className="btn btn-secondary btn-sm"
                style={{ width: '100%', justifyContent: 'center', fontSize: '0.82rem' }}
                title={t('ticket.deposit')}
              >
                + {t('ticket.deposit')}
              </button>
            )}

            {onComplete && (
              <button
                onClick={(e) => { e.stopPropagation(); if (!completeDisabled) onComplete(); }}
                disabled={completeDisabled}
                style={{
                  width: '100%',
                  justifyContent: 'center',
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
                {completeLabel || t('ticket.complete')}
              </button>
            )}

            {/* Legacy Collect (used by other modules that don't pass onComplete) */}
            {onCollectBalance && !onComplete && balance > 0 && (
              <button
                onClick={(e) => { e.stopPropagation(); onCollectBalance(); }}
                className="btn btn-success btn-sm"
                style={{ width: '100%', justifyContent: 'center', fontSize: '0.82rem' }}
              >
                💰 {t('ticket.collectBalance')}
              </button>
            )}

            {/* Secondary icon row */}
            {(onPrint || (onWhatsApp && customerPhone) || onDelete || onFollowUp || onEscalate) && (
              <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.5rem' }}>
                {onPrint && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onPrint(); }}
                    style={{
                      width: 38, height: 38, padding: 0,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      borderRadius: '0.5rem', fontSize: '1rem',
                      background: 'rgba(255,255,255,0.05)', color: '#e5e7eb',
                      border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer',
                    }}
                    title={t('ticket.print')}
                  >🖨</button>
                )}

                {onWhatsApp && customerPhone && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onWhatsApp(); }}
                    style={{
                      width: 38, height: 38, padding: 0,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      borderRadius: '0.5rem', fontSize: '1rem',
                      background: 'rgba(37,211,102,0.15)', color: '#25d366',
                      border: '1px solid rgba(37,211,102,0.35)', cursor: 'pointer',
                    }}
                    title={`WhatsApp ${customerPhone}`}
                  >📱</button>
                )}

                {onDelete && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(); }}
                    style={{
                      width: 38, height: 38, padding: 0,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      borderRadius: '0.5rem', fontSize: '1rem',
                      background: 'rgba(239,68,68,0.15)', color: '#ef4444',
                      border: '1px solid rgba(239,68,68,0.35)', cursor: 'pointer',
                    }}
                    title={t('ticket.delete')}
                  >🗑</button>
                )}
                {onFollowUp && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onFollowUp(); }}
                    style={{
                      width: 38, height: 38, padding: 0,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      borderRadius: '0.5rem', fontSize: '1rem',
                      background: 'rgba(139,92,246,0.15)', color: '#a78bfa',
                      border: '1px solid rgba(139,92,246,0.35)', cursor: 'pointer',
                    }}
                    title={t('ticket.followUp')}
                  >📋</button>
                )}
                {onEscalate && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onEscalate(); }}
                    style={{
                      width: 38, height: 38, padding: 0,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      borderRadius: '0.5rem', fontSize: '1rem',
                      background: 'rgba(245,158,11,0.15)', color: '#f59e0b',
                      border: '1px solid rgba(245,158,11,0.35)', cursor: 'pointer',
                    }}
                    title={t('ticket.escalate')}
                  >⚡</button>
                )}
              </div>
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
