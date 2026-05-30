// CellHub Pro — Cancel Unlock Modal
// Asks what to do with the deposit when cancelling an unlock that has one.
import { useState } from 'react';
import type { Unlock } from '@/store/types';
import { useTranslation } from '@/i18n';

interface CancelUnlockModalProps {
  unlock: Unlock;
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

export default function CancelUnlockModal({
  unlock,
  customerHasPhone,
  customerName,
  lang: _lang,
  onConfirm,
  onClose,
  confirming,
}: CancelUnlockModalProps) {
  void _lang; // vestigial — V3 cleanup
  const { t } = useTranslation();
  const depositCents = unlock.depositAmount || 0;
  const depositDisplay = (depositCents / 100).toFixed(2);
  const item = `${unlock.device || t('device')}${unlock.carrier ? ` (${unlock.carrier})` : ''}`;
  const ticket = unlock.id?.slice(-6).toUpperCase() || 'N/A';

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
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9999,
    }} onClick={onClose}>
      <div style={{
        background: '#1e293b',
        borderRadius: '0.5rem',
        padding: '1.5rem',
        maxWidth: '400px',
        width: '90%',
        boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
      }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1rem', color: '#f87171' }}>
          ⚠️ {t('unlocks.cancel.modalTitle')}
        </div>

        {/* Ticket Info */}
        <div style={{ background: '#0f172a', padding: '0.75rem', borderRadius: '0.375rem', marginBottom: '1rem', fontSize: '0.875rem' }}>
          <div><strong>{t('quickServicePanel.service.unlock')}:</strong> {ticket}</div>
          <div><strong>{t('customer')}:</strong> {customerName}</div>
          <div><strong>{t('device')}:</strong> {item}</div>
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
          {t('unlocks.cancel.depositPaid', depositDisplay)}
        </div>

        {/* Question */}
        <div style={{ marginBottom: '1rem', fontSize: '0.875rem', color: '#cbd5e1' }}>
          {t('unlocks.cancel.depositQuestion')}
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
            <div style={{ fontWeight: 600 }}>{t('unlocks.cancel.storeCredit')}</div>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
              {t('unlocks.cancel.storeCreditDesc', depositDisplay)}
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
            <div style={{ fontWeight: 600 }}>{t('unlocks.cancel.cashRefund')}</div>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
              {t('unlocks.cancel.cashRefundDesc', depositDisplay)}
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
            <div style={{ fontWeight: 600 }}>{t('unlocks.cancel.forfeit')}</div>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
              {t('unlocks.cancel.forfeitDesc')}
            </div>
          </button>
        </div>

        {/* Forfeit Note */}
        {method === 'forfeit' && (
          <div style={{ marginBottom: '1rem' }}>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('unlocks.cancel.reasonPlaceholder')}
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
              {t('unlocks.cancel.charsMin', note.trim().length)}
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
            {t('unlocks.cancel.nevermind')}
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
            {isConfirming ? t('unlocks.cancel.confirming') : t('confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
