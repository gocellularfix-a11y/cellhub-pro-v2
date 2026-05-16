// R-LAYAWAY-DIRECT-PAYMENT-V1
// Direct partial-payment modal for layaways.
// Records the payment immediately — NO POS cart required.
// Replaces the old DepositModal → cart → POS-checkout flow.

import { useState } from 'react';
import type { Layaway } from '@/store/types';
import { calculateLayawayTotals } from '@/services/layaway/payments';

interface LayawayPaymentModalProps {
  layaway: Layaway;
  lang: string;
  onConfirm: (amountCents: number, method: string, note: string) => void;
  onClose: () => void;
}

const METHODS = ['Cash', 'Card', 'Store Credit'];

export default function LayawayPaymentModal({
  layaway,
  lang,
  onConfirm,
  onClose,
}: LayawayPaymentModalProps) {
  const es = lang === 'es';
  const totals = calculateLayawayTotals(layaway);
  const remaining = totals.remainingBalanceCents;

  const [amountInput, setAmountInput] = useState((remaining / 100).toFixed(2));
  const [method, setMethod] = useState('Cash');
  const [note, setNote] = useState('');

  const enteredCents = Math.round((parseFloat(amountInput) || 0) * 100);
  const isPartial = enteredCents > 0 && enteredCents < remaining;
  const isFull = enteredCents >= remaining && remaining > 0;
  const isValid = enteredCents > 0 && enteredCents <= remaining + 1;
  const newBalance = Math.max(0, remaining - enteredCents);

  const fc = (cents: number) => '$' + (cents / 100).toFixed(2);

  const itemDesc = (layaway as any).itemDescription || layaway.items?.[0]?.name || (es ? 'Artículo' : 'Item');
  const ticket = (layaway as any).ticketNumber || layaway.id.slice(-6).toUpperCase();

  const row: React.CSSProperties = {
    display: 'flex', justifyContent: 'space-between',
    alignItems: 'center', padding: '0.35rem 0', fontSize: '0.87rem',
  };
  const divider: React.CSSProperties = {
    borderTop: '1px solid rgba(255,255,255,0.08)', margin: '0.4rem 0',
  };
  const box = (r: number, g: number, b: number): React.CSSProperties => ({
    background: `rgba(${r},${g},${b},0.07)`,
    border: `1px solid rgba(${r},${g},${b},0.22)`,
    borderRadius: '10px', padding: '0.75rem 1rem', marginBottom: '0.75rem',
  });

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '1rem', maxWidth: '460px', width: '95vw', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '1rem', color: '#fff' }}>
              💰 {es ? 'Registrar pago' : 'Record Payment'}
            </div>
            <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.15rem' }}>
              {ticket} — {layaway.customerName}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '1.25rem', padding: '0.25rem' }}>✕</button>
        </div>

        <div style={{ padding: '1.25rem' }}>
          {/* Item + balance summary */}
          <div style={box(56, 189, 248)}>
            <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              📦 {itemDesc}
            </div>
            <div style={row}>
              <span style={{ color: '#94a3b8' }}>{es ? 'Total acordado' : 'Agreed total'}</span>
              <span>{fc(layaway.totalPrice || 0)}</span>
            </div>
            <div style={row}>
              <span style={{ color: '#94a3b8' }}>{es ? 'Ya pagado' : 'Already paid'}</span>
              <span style={{ color: '#10b981' }}>− {fc(totals.totalPaidCents)}</span>
            </div>
            {totals.paymentCount > 0 && (
              <div style={{ fontSize: '0.73rem', color: '#64748b', textAlign: 'right', marginTop: '-0.15rem' }}>
                ({totals.paymentCount} {es ? `pago${totals.paymentCount !== 1 ? 's' : ''}` : `payment${totals.paymentCount !== 1 ? 's' : ''}`})
              </div>
            )}
            <div style={divider} />
            <div style={{ ...row, fontWeight: 700, fontSize: '1rem' }}>
              <span>{es ? 'Saldo pendiente' : 'Remaining balance'}</span>
              <span style={{ color: '#f59e0b' }}>{fc(remaining)}</span>
            </div>
          </div>

          {/* Amount input */}
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={{ display: 'block', fontSize: '0.78rem', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>
              {es ? 'Monto a cobrar' : 'Amount to collect'}
            </label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', fontSize: '1.4rem', fontWeight: 700, color: '#10b981' }}>$</span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max={(remaining / 100).toFixed(2)}
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                autoFocus
                style={{
                  width: '100%', padding: '0.85rem 1rem 0.85rem 2.5rem',
                  fontSize: '1.6rem', fontWeight: 700, textAlign: 'center',
                  background: 'rgba(16,185,129,0.1)', border: '2px solid rgba(16,185,129,0.4)',
                  borderRadius: '10px', color: '#e2e8f0', outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>
            {/* Quick amount buttons */}
            <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
              {[50, 100, 200].filter(v => v * 100 <= remaining).map(v => (
                <button key={v} onClick={() => setAmountInput(v.toFixed(2))}
                  style={{ padding: '0.3rem 0.65rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: '#94a3b8', cursor: 'pointer', fontSize: '0.78rem' }}>
                  ${v}
                </button>
              ))}
              <button onClick={() => setAmountInput((remaining / 100).toFixed(2))}
                style={{ padding: '0.3rem 0.65rem', borderRadius: '6px', border: '1px solid rgba(56,189,248,0.3)', background: 'rgba(56,189,248,0.08)', color: '#38bdf8', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}>
                {es ? 'Saldo completo' : 'Full balance'} {fc(remaining)}
              </button>
            </div>
          </div>

          {/* Payment method */}
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={{ display: 'block', fontSize: '0.78rem', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>
              {es ? 'Método de pago' : 'Payment method'}
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {METHODS.map(m => (
                <button key={m} onClick={() => setMethod(m)}
                  style={{
                    flex: 1, padding: '0.5rem 0.4rem', borderRadius: '8px', fontSize: '0.82rem', fontWeight: method === m ? 700 : 500, cursor: 'pointer',
                    border: method === m ? '1.5px solid #818cf8' : '1px solid rgba(255,255,255,0.1)',
                    background: method === m ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.04)',
                    color: method === m ? '#a5b4fc' : '#94a3b8',
                  }}>
                  {m === 'Cash' ? (es ? '💵 Efectivo' : '💵 Cash')
                   : m === 'Card' ? (es ? '💳 Tarjeta' : '💳 Card')
                   : (es ? '🏷️ Crédito' : '🏷️ Store Credit')}
                </button>
              ))}
            </div>
          </div>

          {/* Optional note */}
          <div style={{ marginBottom: '0.75rem' }}>
            <input
              type="text"
              placeholder={es ? 'Nota (opcional)' : 'Note (optional)'}
              value={note}
              onChange={e => setNote(e.target.value)}
              maxLength={120}
              style={{
                width: '100%', padding: '0.55rem 0.85rem',
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px', color: '#e2e8f0', fontSize: '0.85rem',
                outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>

          {/* New balance preview */}
          {isValid && (
            <div style={{ ...box(16, 185, 129), marginBottom: '0.75rem' }}>
              <div style={row}>
                <span style={{ color: '#94a3b8' }}>{es ? 'Este pago' : 'This payment'}</span>
                <span style={{ color: '#10b981', fontWeight: 700 }}>{fc(Math.min(enteredCents, remaining))}</span>
              </div>
              <div style={divider} />
              <div style={{ ...row, fontWeight: 700 }}>
                <span style={{ color: newBalance === 0 ? '#10b981' : '#f59e0b' }}>
                  {newBalance === 0 ? '✅ ' : '⏳ '}{es ? 'Saldo restante' : 'Remaining after'}
                </span>
                <span style={{ color: newBalance === 0 ? '#10b981' : '#f59e0b' }}>{fc(newBalance)}</span>
              </div>
              {newBalance === 0 && (
                <div style={{ fontSize: '0.78rem', color: '#10b981', marginTop: '0.3rem', textAlign: 'center' }}>
                  {es ? '🎉 Apartado completamente pagado' : '🎉 Layaway fully paid off'}
                </div>
              )}
            </div>
          )}

          {/* Overpay warning */}
          {enteredCents > remaining + 1 && (
            <div style={{ color: '#ef4444', fontSize: '0.83rem', marginBottom: '0.75rem', padding: '0.5rem 0.75rem', background: 'rgba(239,68,68,0.08)', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.2)' }}>
              ❌ {es ? `No puede exceder el saldo pendiente (${fc(remaining)})` : `Cannot exceed remaining balance (${fc(remaining)})`}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button onClick={onClose}
              style={{ flex: 1, padding: '0.7rem', borderRadius: '0.625rem', border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)', color: '#94a3b8', cursor: 'pointer', fontWeight: 600 }}>
              {es ? 'Cancelar' : 'Cancel'}
            </button>
            <button
              onClick={() => { if (isValid) onConfirm(Math.min(enteredCents, remaining), method, note.trim()); }}
              disabled={!isValid}
              style={{
                flex: 2, padding: '0.7rem', borderRadius: '0.625rem', border: 'none',
                background: isValid ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : 'rgba(255,255,255,0.08)',
                color: isValid ? '#fff' : '#475569',
                cursor: isValid ? 'pointer' : 'not-allowed',
                fontWeight: 700, fontSize: '0.9rem',
              }}>
              {isValid
                ? (isFull
                  ? (es ? `✅ Registrar pago completo ${fc(Math.min(enteredCents, remaining))}` : `✅ Record full payment ${fc(Math.min(enteredCents, remaining))}`)
                  : isPartial
                  ? (es ? `💰 Registrar pago parcial ${fc(enteredCents)}` : `💰 Record partial payment ${fc(enteredCents)}`)
                  : (es ? 'Registrar pago' : 'Record payment'))
                : (es ? 'Registrar pago' : 'Record payment')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
