// CellHub Pro — Cancel Repair Modal
// Asks what to do with the deposit when cancelling a repair that has one.
import { useState } from 'react';
import { Modal } from '@/components/ui';
import { useTranslation } from '@/i18n';
import type { Repair } from '@/store/types';

interface CancelRepairModalProps {
  repair: Repair;
  customerHasPhone: boolean;
  customerName: string;
  lang: string;
  onConfirm: (choice: {
    method: 'store_credit' | 'cash' | 'forfeit';
    note: string;
  }) => void;
  onClose: () => void;
  // R-REPAIR-UNLOCK-CANCEL-DOUBLECLICK-UX1: parent-owned busy state to prevent
  // double-confirm. Mirrors CancelLayawayModal/CancelSpecialOrderModal. When
  // undefined the modal falls back to internal state, behaviour unchanged.
  confirming?: boolean;
}

export default function CancelRepairModal({
  repair,
  customerHasPhone,
  customerName,
  lang,
  onConfirm,
  onClose,
  confirming,
}: CancelRepairModalProps) {
  void lang; // vestigial — V3 cleanup
  const { t } = useTranslation();
  const depositCents = repair.depositAmount || 0;
  const depositDisplay = (depositCents / 100).toFixed(2);
  const device = repair.device || (repair as any).model || 'Device';
  const ticket = (repair as any).ticketNumber || repair.id?.slice(-6).toUpperCase() || 'N/A';

  const [method, setMethod] = useState<'store_credit' | 'cash' | 'forfeit'>('store_credit');
  const [note, setNote] = useState('');
  // R-REPAIR-UNLOCK-CANCEL-DOUBLECLICK-UX1: busy-state guard. Parent owns the
  // lifecycle when `confirming` is provided; otherwise internal state is the fallback.
  const [internalConfirming, setInternalConfirming] = useState(false);
  const isConfirming = confirming ?? internalConfirming;

  const handleConfirm = () => {
    if (isConfirming) return;
    if (method === 'forfeit' && note.trim().length < 10) return;
    if (confirming === undefined) setInternalConfirming(true);
    onConfirm({ method, note: note.trim() });
  };

  const isValid = method !== 'forfeit' || note.trim().length >= 10;

  return (
    // Round R1 F2: canonical <Modal> (body-scroll lock, ESC/X close, focus trap, a11y).
    <Modal open onClose={onClose} size="max-w-md" title={`⚠️ ${t('cancelRepair.modalTitle')}`}>
      {/* Ticket Info */}
      <div style={{ background: '#0f172a', padding: '0.75rem', borderRadius: '0.375rem', marginBottom: '1rem', fontSize: '0.875rem' }}>
        <div><strong>{t('cancelRepair.ticket')}:</strong> {ticket}</div>
        <div><strong>{t('customer')}:</strong> {customerName}</div>
        <div><strong>{t('device')}:</strong> {device}</div>
      </div>

      {/* Deposit Display */}
      <div style={{
        background: 'rgba(251,191,36,0.15)',
        border: '1px solid rgba(251,191,36,0.4)',
        padding: '0.75rem',
        borderRadius: '0.375rem',
        marginBottom: '1rem',
        fontSize: '1rem',
        fontWeight: 700,
        color: '#fbbf24',
        textAlign: 'center',
      }}>
        {t('cancelRepair.depositPaid')}: ${depositDisplay}
      </div>

      {/* Question */}
      <div style={{ marginBottom: '1rem', fontSize: '0.875rem', color: '#cbd5e1' }}>
        {t('cancelRepair.question')}
      </div>

      {/* Options */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
        <button
          type="button"
          onClick={() => setMethod('store_credit')}
          disabled={!customerHasPhone}
          style={{
            padding: '0.75rem',
            borderRadius: '0.375rem',
            border: method === 'store_credit' ? '2px solid #3b82f6' : '1px solid #334155',
            background: method === 'store_credit' ? 'rgba(59,130,246,0.2)' : '#1e293b',
            color: customerHasPhone ? '#e2e8f0' : '#64748b',
            textAlign: 'left',
            cursor: customerHasPhone ? 'pointer' : 'not-allowed',
            opacity: customerHasPhone ? 1 : 0.6,
          }}>
          <div style={{ fontWeight: 600 }}>💳 {t('cancelRepair.storeCredit')}</div>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
            ${depositDisplay} — {t('cancelRepair.storeCreditDesc')}
          </div>
        </button>

        <button
          type="button"
          onClick={() => setMethod('cash')}
          style={{
            padding: '0.75rem',
            borderRadius: '0.375rem',
            border: method === 'cash' ? '2px solid #f97316' : '1px solid #334155',
            background: method === 'cash' ? 'rgba(249,115,22,0.2)' : '#1e293b',
            color: '#e2e8f0',
            textAlign: 'left',
            cursor: 'pointer',
          }}>
          <div style={{ fontWeight: 600 }}>💵 {t('cancelRepair.cashRefund')}</div>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
            ${depositDisplay} — {t('cancelRepair.cashRefundDesc')}
          </div>
        </button>

        <button
          type="button"
          onClick={() => setMethod('forfeit')}
          style={{
            padding: '0.75rem',
            borderRadius: '0.375rem',
            border: method === 'forfeit' ? '2px solid #ef4444' : '1px solid #334155',
            background: method === 'forfeit' ? 'rgba(239,68,68,0.2)' : '#1e293b',
            color: '#e2e8f0',
            textAlign: 'left',
            cursor: 'pointer',
          }}>
          <div style={{ fontWeight: 600 }}>💰 {t('cancelRepair.keepDeposit')}</div>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
            {t('cancelRepair.keepDepositDesc')}
          </div>
        </button>
      </div>

      {/* Forfeit Note */}
      {method === 'forfeit' && (
        <div style={{ marginBottom: '1rem' }}>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('cancelRepair.reasonPlaceholder')}
            style={{
              width: '100%',
              minHeight: '80px',
              padding: '0.5rem',
              borderRadius: '0.375rem',
              border: note.trim().length >= 10 ? '1px solid #22c55e' : '1px solid #334155',
              background: '#0f172a',
              color: '#e2e8f0',
              fontFamily: 'inherit',
              fontSize: '0.875rem',
              resize: 'vertical',
            }}
          />
          <div style={{ fontSize: '0.7rem', color: note.trim().length >= 10 ? '#22c55e' : '#f87171', marginTop: '0.25rem' }}>
            {note.trim().length}/10 {t('cancelRepair.charsMin')}
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={onClose}
          style={{ padding: '0.5rem 1rem' }}>
          {t('cancelRepair.neverMind')}
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={handleConfirm}
          disabled={!isValid || isConfirming}
          style={{
            padding: '0.5rem 1rem',
            opacity: (isValid && !isConfirming) ? 1 : 0.5,
            cursor: (isValid && !isConfirming) ? 'pointer' : 'not-allowed',
          }}>
          {isConfirming ? t('repairs.cancel.confirming') : t('confirm')}
        </button>
      </div>
    </Modal>
  );
}
