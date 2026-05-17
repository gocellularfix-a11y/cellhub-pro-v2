// ============================================================
// CellHub Pro — Deposit Modal
// Ported from original GOCELLULARAPP.html DepositModal.
// Used by: Repairs, Unlocks, Special Orders, Layaways
//
// Props:
//   title        — modal title string
//   itemLabel    — description of item (e.g. "iPhone 15 — Screen repair")
//   itemPrice    — price in DOLLARS (not cents)
//   taxRate      — e.g. 0.0925
//   taxable      — boolean
//   existingDeposit — already paid amount in dollars
//   mode         — 'deposit' | 'balance'
//   onConfirm    — ({ depositAmt, preTaxAmt, taxAmt, balanceDue, mode }) => void
//   onClose      — () => void
//   lang         — 'en' | 'es'
// ============================================================

import { useState } from 'react';
import { calcDepositTotals, reverseTaxFromPayment, forwardTaxFromBase } from '@/utils/depositTax';

interface DepositModalProps {
  title?: string;
  itemLabel: string;
  itemPrice: number;       // dollars
  taxRate: number;         // e.g. 0.0925
  taxable: boolean;
  existingDeposit?: number; // dollars already paid
  pendingInCart?: number;    // NEW — tax-inclusive dollars already in cart for this entity (not yet checked out)
  mode?: 'deposit' | 'balance';
  onConfirm: (result: {
    depositAmt: number;
    preTaxAmt: number;
    taxAmt: number;
    balanceDue: number;
    mode: string;
  }) => void;
  onClose: () => void;
  lang: string;
}

export default function DepositModal({
  title,
  itemLabel,
  itemPrice,
  taxRate,
  taxable,
  existingDeposit = 0,
  pendingInCart = 0,   // NEW
  mode = 'deposit',
  onConfirm,
  onClose,
  lang,
}: DepositModalProps) {
  const es = lang === 'es';
  const rc = (n: number) => Math.round(n * 100) / 100;
  const fc = (n: number) => '$' + rc(n).toFixed(2);

  // ── Helper bridge: props are in DOLLARS, helper works in CENTS ──
  const priceCents = Math.round((itemPrice || 0) * 100);
  const alreadyPaidCents = Math.round((existingDeposit || 0) * 100);
  const totals = calcDepositTotals(priceCents, alreadyPaidCents, taxRate, taxable);

  const _taxRate    = taxable ? taxRate : 0;
  const _price      = itemPrice;
  const _taxAmt     = totals.taxCents / 100;
  const _totalOwed  = totals.totalWithTaxCents / 100;
  const _alreadyPaid = existingDeposit;
  // r-new-5: subtract pending cart amount to prevent double-collection.
  // `pendingInCart` is tax-inclusive dollars — when cashier completes POS
  // those become real depositAmount. From user POV they're "already paid".
  const _remainingDue = Math.max(0, (totals.balanceCents / 100) - pendingInCart);

  const [depositInput, setDepositInput] = useState(
    mode === 'balance' && _remainingDue > 0 ? String(_remainingDue) : ''
  );
  const depositMode = 'round' as const;

  const enteredAmt = parseFloat(depositInput) || 0;
  const enteredCents = Math.round(enteredAmt * 100);

  let preDeposit: number, taxOnDeposit: number, registerTotal: number;
  if (depositMode === 'round') {
    // Tax-inclusive: customer hands over $X, split into base + tax
    const split = reverseTaxFromPayment(enteredCents, taxRate, taxable);
    preDeposit = split.baseCents / 100;
    taxOnDeposit = split.taxCents / 100;
    registerTotal = enteredAmt;
  } else {
    // Pre-tax: user enters base, system adds tax
    const fwd = forwardTaxFromBase(enteredCents, taxRate, taxable);
    preDeposit = fwd.baseCents / 100;
    taxOnDeposit = fwd.taxCents / 100;
    registerTotal = fwd.totalCents / 100;
  }

  const newBalanceDue = rc(Math.max(0, _totalOwed - _alreadyPaid - pendingInCart - registerTotal));
  const isValid = registerTotal > 0 && registerTotal <= _remainingDue + 0.01;

  const rowStyle: React.CSSProperties = {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '0.4rem 0', fontSize: '0.88rem',
  };
  const dividerStyle: React.CSSProperties = {
    borderTop: '1px solid rgba(255,255,255,0.1)', margin: '0.5rem 0',
  };
  const totalRowStyle: React.CSSProperties = {
    ...rowStyle, fontWeight: 700, fontSize: '1rem', padding: '0.5rem 0',
  };
  const highlightBox = (r: number, g: number, b: number): React.CSSProperties => ({
    background: `rgba(${r},${g},${b},0.08)`,
    border: `1px solid rgba(${r},${g},${b},0.25)`,
    borderRadius: '10px', padding: '0.75rem 1rem', marginBottom: '0.5rem',
  });

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div
        style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '1rem', maxWidth: '480px', width: '95vw', overflow: 'hidden' }}
        
      >
        {/* Header */}
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#fff' }}>
            💰 {title || (es ? 'Cobrar Depósito' : 'Collect Deposit')}
          </h3>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '1.25rem', padding: '0.25rem' }}>✕</button>
        </div>

        <div style={{ padding: '1.25rem' }}>
          {/* Item label */}
          <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '1rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            📦 {itemLabel}
          </div>

          {/* Price breakdown */}
          <div style={highlightBox(56, 189, 248)}>
            <div style={rowStyle}>
              <span style={{ color: '#94a3b8' }}>{es ? 'Precio del artículo' : 'Item price'}</span>
              <span>{fc(_price)}</span>
            </div>
            {taxable && (
              <div style={rowStyle}>
                <span style={{ color: '#94a3b8' }}>
                  {es ? `Impuesto (${(_taxRate * 100).toFixed(2)}%)` : `Tax (${(_taxRate * 100).toFixed(2)}%)`}
                </span>
                <span style={{ color: '#f59e0b' }}>+ {fc(_taxAmt)}</span>
              </div>
            )}
            <div style={dividerStyle} />
            <div style={totalRowStyle}>
              <span>{es ? 'Total con impuesto' : 'Total with tax'}</span>
              <span style={{ color: '#38bdf8' }}>{fc(_totalOwed)}</span>
            </div>
            {_alreadyPaid > 0 && (
              <>
                <div style={rowStyle}>
                  <span style={{ color: '#94a3b8' }}>{es ? 'Ya pagado (depósito)' : 'Already paid (deposit)'}</span>
                  <span style={{ color: '#10b981' }}>− {fc(_alreadyPaid)}</span>
                </div>
                <div style={dividerStyle} />
                <div style={totalRowStyle}>
                  <span>{es ? 'Saldo pendiente' : 'Remaining balance'}</span>
                  <span style={{ color: '#f59e0b' }}>{fc(_remainingDue)}</span>
                </div>
              </>
            )}
            {pendingInCart > 0 && (
              <>
                <div style={rowStyle}>
                  <span style={{ color: '#94a3b8' }}>🛒 {es ? 'En carrito (por cobrar)' : 'In cart (pending collection)'}</span>
                  <span style={{ color: '#fb923c' }}>− {fc(pendingInCart)}</span>
                </div>
                <div style={dividerStyle} />
                <div style={totalRowStyle}>
                  <span>{es ? 'Aún por cobrar' : 'Still to collect'}</span>
                  <span style={{ color: _remainingDue > 0 ? '#f59e0b' : '#10b981' }}>{fc(_remainingDue)}</span>
                </div>
              </>
            )}
          </div>

          {/* Input section */}
          <div style={{ marginTop: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
              {es ? 'Monto a cobrar ahora' : 'Amount to collect now'}
</label>

            {/* Big dollar input */}
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', fontSize: '1.4rem', fontWeight: 700, color: '#10b981' }}>$</span>
              <input
                type="number" step="0.01" min="0" max={_remainingDue.toFixed(2)}
                value={depositInput}
                onChange={(e) => setDepositInput(e.target.value)}
                autoFocus
                style={{
                  width: '100%', padding: '0.9rem 1rem 0.9rem 2.5rem',
                  fontSize: '1.6rem', fontWeight: 700, textAlign: 'center',
                  background: 'rgba(16,185,129,0.1)', border: '2px solid rgba(16,185,129,0.4)',
                  borderRadius: '10px', color: '#e2e8f0', outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Quick amount buttons */}
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
              {[100, 200, 300, 500].filter((v) => v <= _remainingDue + 0.01).map((v) => (
                <button
                  key={v}
                  onClick={() => setDepositInput(v.toFixed(2))}
                  style={{ padding: '0.3rem 0.7rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.06)', color: '#94a3b8', cursor: 'pointer', fontSize: '0.78rem' }}
                >
                  ${v}
                </button>
              ))}
              <button
                onClick={() => setDepositInput(_remainingDue.toFixed(2))}
                style={{ padding: '0.3rem 0.7rem', borderRadius: '6px', border: '1px solid rgba(56,189,248,0.3)', background: 'rgba(56,189,248,0.1)', color: '#38bdf8', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}
              >
                {es ? 'Total pendiente' : 'Full balance'} {fc(_remainingDue)}
              </button>
            </div>
          </div>

          {/* Payment breakdown */}
          {enteredAmt > 0 && (
            <div style={{ ...highlightBox(16, 185, 129), marginTop: '1rem' }}>
              <div style={{ fontSize: '0.75rem', color: '#10b981', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                {es ? '📋 Desglose de este pago' : '📋 This payment breakdown'}
              </div>
              {taxable && (
                <>
                  <div style={rowStyle}>
                    <span style={{ color: '#94a3b8' }}>{es ? 'Subtotal (pre-tax)' : 'Subtotal (pre-tax)'}</span>
                    <span>{fc(preDeposit)}</span>
                  </div>
                  <div style={rowStyle}>
                    <span style={{ color: '#94a3b8' }}>{es ? `Tax (${(_taxRate * 100).toFixed(2)}%)` : `Tax (${(_taxRate * 100).toFixed(2)}%)`}</span>
                    <span style={{ color: '#f59e0b' }}>+ {fc(taxOnDeposit)}</span>
                  </div>
                  <div style={dividerStyle} />
                </>
              )}
              <div style={totalRowStyle}>
                <span>{es ? '💳 Se cobra en caja' : '💳 Register total'}</span>
                <span style={{ color: '#10b981' }}>{fc(registerTotal)}</span>
              </div>
              <div style={dividerStyle} />
              <div style={{ ...totalRowStyle, fontSize: '1.1rem' }}>
                <span style={{ color: newBalanceDue === 0 ? '#10b981' : '#f59e0b' }}>
                  {newBalanceDue === 0 ? '✅ ' : '⏳ '}{es ? 'Saldo restante' : 'Remaining balance'}
                </span>
                <span style={{ color: newBalanceDue === 0 ? '#10b981' : '#f59e0b' }}>{fc(newBalanceDue)}</span>
              </div>
            </div>
          )}

          {/* Overpayment warning */}
          {enteredAmt > _remainingDue + 0.01 && (
            <div style={{ color: '#ef4444', fontSize: '0.83rem', marginTop: '0.5rem', padding: '0.5rem 0.75rem', background: 'rgba(239,68,68,0.1)', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.25)' }}>
              ❌ {es ? 'No puede exceder el saldo pendiente' : 'Cannot exceed remaining balance'} ({fc(_remainingDue)})
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
            <button
              onClick={onClose}
              style={{ flex: 1, padding: '0.7rem', borderRadius: '0.625rem', border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: '#94a3b8', cursor: 'pointer', fontWeight: 600 }}
            >
              {es ? 'Cancelar' : 'Cancel'}
            </button>
            <button
              onClick={() => {
                if (!isValid) return;
                onConfirm({ depositAmt: registerTotal, preTaxAmt: preDeposit, taxAmt: taxOnDeposit, balanceDue: newBalanceDue, mode: depositMode });
              }}
              disabled={!isValid}
              style={{
                flex: 2, padding: '0.7rem', borderRadius: '0.625rem', border: 'none',
                background: isValid ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : 'rgba(255,255,255,0.1)',
                color: isValid ? '#fff' : '#475569',
                cursor: isValid ? 'pointer' : 'not-allowed',
                fontWeight: 700, fontSize: '0.9rem',
              }}
            >
              💳 {es ? `Cobrar ${fc(registerTotal)} → Ir a POS` : `Charge ${fc(registerTotal)} → Go to POS`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
