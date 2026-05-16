// ============================================================
// CellHub Intelligence — External Payment Verification Nudge
// R-INTELLIGENCE-PAYMENT-VERIFY-V1
//
// Small card rendered near the Intelligence bubble.
// Surfaces 2 min after phone_payment checkout to remind
// the cashier to confirm the carrier portal payment.
//
// CRITICAL: No sale data is modified. Human-only reminder.
// ============================================================

import { useEffect, useState, useCallback } from 'react';
import {
  getDueVerification,
  confirmVerification,
  dismissVerification,
  rescheduleVerification,
  type PaymentVerification,
} from '@/services/intelligence/paymentVerification/paymentVerificationService';
import { formatCurrency } from '@/utils/currency';

const POLL_INTERVAL_MS = 15_000;  // check every 15 seconds

interface Props {
  lang: 'en' | 'es' | 'pt';
}

export default function PaymentVerificationNudge({ lang }: Props) {
  const [due, setDue] = useState<PaymentVerification | null>(null);

  const checkDue = useCallback(() => {
    setDue(getDueVerification());
  }, []);

  // Poll localStorage every 15 s + listen for the checkout event.
  useEffect(() => {
    checkDue();
    const interval = setInterval(checkDue, POLL_INTERVAL_MS);

    const onEvent = () => checkDue();
    window.addEventListener('cellhub:payment-verify-nudge', onEvent);

    return () => {
      clearInterval(interval);
      window.removeEventListener('cellhub:payment-verify-nudge', onEvent);
    };
  }, [checkDue]);

  if (!due) return null;

  const handleConfirm = () => {
    confirmVerification(due.verificationId);
    setDue(null);
  };

  const handleNotYet = () => {
    rescheduleVerification(due.verificationId);
    setDue(null);   // hide now; will re-surface in 2 min
  };

  const handleDismiss = () => {
    dismissVerification(due.verificationId);
    setDue(null);
  };

  const amountDisplay = formatCurrency(due.amountCents);

  const txt = {
    title:   lang === 'es' ? '¿Pago en portal confirmado?' : lang === 'pt' ? 'Pagamento no portal confirmado?' : 'Portal payment confirmed?',
    body:
      lang === 'es'
        ? `${due.carrier} · ${due.customerName} · ${amountDisplay} — ¿Lo procesaste en el portal del carrier?`
        : lang === 'pt'
        ? `${due.carrier} · ${due.customerName} · ${amountDisplay} — Você processou no portal da operadora?`
        : `${due.carrier} · ${due.customerName} · ${amountDisplay} — Did you complete it in the carrier portal?`,
    confirm:  lang === 'es' ? '✓ Confirmado' : lang === 'pt' ? '✓ Confirmado' : '✓ Confirmed',
    notYet:   lang === 'es' ? 'Aún no (2 min)' : lang === 'pt' ? 'Ainda não (2 min)' : 'Not yet (2 min)',
    dismiss:  lang === 'es' ? 'Descartar' : lang === 'pt' ? 'Descartar' : 'Dismiss',
  };

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 88,
        right: 24,
        zIndex: 9999,
        width: 320,
        background: '#1F2937',
        border: '1px solid #F59E0B',
        borderRadius: 12,
        boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
        padding: '14px 16px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 18 }}>📡</span>
        <span style={{ color: '#F59E0B', fontWeight: 700, fontSize: 13 }}>
          {txt.title}
        </span>
      </div>

      {/* Body */}
      <p style={{ margin: 0, color: '#D1D5DB', fontSize: 12, lineHeight: 1.5 }}>
        {txt.body}
      </p>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button
          onClick={handleConfirm}
          style={{
            flex: 1,
            background: '#065F46',
            color: '#6EE7B7',
            border: 'none',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {txt.confirm}
        </button>
        <button
          onClick={handleNotYet}
          style={{
            flex: 1,
            background: '#374151',
            color: '#D1D5DB',
            border: '1px solid #4B5563',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {txt.notYet}
        </button>
        <button
          onClick={handleDismiss}
          style={{
            background: 'transparent',
            color: '#6B7280',
            border: 'none',
            padding: '6px 8px',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          {txt.dismiss}
        </button>
      </div>
    </div>
  );
}
