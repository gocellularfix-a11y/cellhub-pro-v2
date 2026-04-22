// ============================================================
// CellHub Pro — Payment / Checkout Modal
// ============================================================

import { useState, useMemo, useEffect } from 'react';
import { Modal, ConfirmDialog } from '@/components/ui';
import { formatCurrency } from '@/utils/currency';
import { sendSms } from '@/services/sms';
import type { CartItem, Customer, Sale, Employee, StoreSettings } from '@/store/types';
import type { CartTotals } from './types';
import { buildSale } from './saleBuilder';

interface PaymentModalProps {
  open: boolean;
  onClose: () => void;
  cart: CartItem[];
  totals: CartTotals;
  paymentMethod: string;
  selectedCustomer: Customer | null;
  currentEmployee: Employee | null;
  settings: StoreSettings;
  onComplete: (sale: Sale) => void;
  onSelectCustomer: () => void;
  lang: string;
  L: Record<string, any>;
}

export default function PaymentModal({
  open,
  onClose,
  cart,
  totals,
  paymentMethod,
  selectedCustomer,
  currentEmployee,
  settings,
  onComplete,
  onSelectCustomer,
  lang,
  L,
}: PaymentModalProps) {
  const [cashAmount, setCashAmount] = useState('');
  const [cardAmount, setCardAmount] = useState('');
  const [showPortalConfirm, setShowPortalConfirm] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [sendSmsReceipt, setSendSmsReceipt] = useState(false);

  // Reset payment amounts when method changes (avoids stale values
  // from a previous Cash/Split selection bleeding into the new one).
  // Only resets while modal is open, so opening with a pre-selected
  // method doesn't wipe legitimate state.
  useEffect(() => {
    if (open) {
      setCashAmount('');
      setCardAmount('');
    }
  }, [paymentMethod, open]);

  const cashNum = parseFloat(cashAmount) || 0;
  const cashCents = Math.round(cashNum * 100);
  const cardNum = parseFloat(cardAmount) || 0;

  const changeDue = useMemo(() => {
    if (paymentMethod === 'Cash') {
      return Math.max(0, cashCents - totals.total);
    }
    if (paymentMethod === 'Split') {
      const totalPaidCents = Math.round((cashNum + cardNum) * 100);
      return Math.max(0, totalPaidCents - totals.total);
    }
    return 0;
  }, [cashCents, cashNum, cardNum, totals.total, paymentMethod]);

  // Check if cart has external portal payments
  const hasExternalPortal = useMemo(
    () => cart.some((item) => item.category === 'phone_payment' && item.carrier),
    [cart],
  );

  const canComplete = useMemo(() => {
    if (cart.length === 0) return false;
    if (!currentEmployee) return false;
    if (paymentMethod === 'Cash' && cashCents < totals.total) return false;
    if (paymentMethod === 'Split' && (cashNum + cardNum) * 100 < totals.total) return false;
    if (paymentMethod === 'Store Credit') {
      if (!selectedCustomer) return false;
      if ((selectedCustomer.storeCredit || 0) < totals.total) return false;
    }
    return true;
  }, [cart, currentEmployee, paymentMethod, cashCents, cashNum, cardNum, totals.total, selectedCustomer]);

  const handleComplete = async () => {
    if (!canComplete) return;

    // External portal confirmation
    if (hasExternalPortal && !showPortalConfirm) {
      setShowPortalConfirm(true);
      return;
    }

    setProcessing(true);

    try {
      // Round R-POS-PAY-DEDUPE F1: Sale construction extracted to
      // saleBuilder.buildSale — single source of truth for both
      // checkout paths (invariants I1, I3, I7).
      const sale = buildSale({
        cart,
        totals,
        paymentMethod,
        cashAmount: cashNum,
        cardAmount: cardNum,
        selectedCustomer,
        currentEmployee,
        settings,
      });

      onComplete(sale);

      // Send SMS receipt if checkbox enabled and customer has phone
      if (sendSmsReceipt && selectedCustomer?.phone && settings.smsProvider && settings.smsProvider !== 'none') {
        try {
          const es = lang === 'es';
          const hasPhonePayment = sale.items.some((i) => i.category === 'phone_payment');
          const firstName = (selectedCustomer.name || '').split(' ')[0] || '';
          const storeName = settings.storeName || 'GO CELLULAR';

          let message = '';
          if (hasPhonePayment) {
            const ppItem = sale.items.find((i) => i.category === 'phone_payment');
            const carrier = ppItem?.carrier || '';
            const phoneNum = ppItem?.phoneNumber || '';
            message = es
              ? `¡Gracias por su pago ${firstName}!\n${carrier} - ${phoneNum}\nMonto: ${formatCurrency(sale.total)}\nRecibo: ${sale.invoiceNumber}\n${storeName}`
              : `Thanks for your payment ${firstName}!\n${carrier} - ${phoneNum}\nAmount: ${formatCurrency(sale.total)}\nReceipt: ${sale.invoiceNumber}\n${storeName}`;
          } else {
            message = es
              ? `¡Gracias por su compra ${firstName}!\nTotal: ${formatCurrency(sale.total)}\nRecibo: ${sale.invoiceNumber}\n¡Vuelva pronto! - ${storeName}`
              : `Thanks for your purchase ${firstName}!\nTotal: ${formatCurrency(sale.total)}\nReceipt: ${sale.invoiceNumber}\nCome back soon! - ${storeName}`;
          }

          // Fire and forget — don't block the receipt display on SMS errors
          sendSms(selectedCustomer.phone, message, settings).catch((err) => {
            console.warn('[SMS receipt] Failed:', err);
          });
        } catch (err) {
          console.warn('[SMS receipt] Build error:', err);
        }
      }
    } finally {
      setProcessing(false);
    }
  };

  // Quick cash buttons
  const quickCashAmounts = useMemo(() => {
    const totalDollars = totals.total / 100;
    const amounts = [
      Math.ceil(totalDollars),
      Math.ceil(totalDollars / 5) * 5,
      Math.ceil(totalDollars / 10) * 10,
      Math.ceil(totalDollars / 20) * 20,
    ];
    return [...new Set(amounts)].filter((a) => a >= totalDollars).slice(0, 4);
  }, [totals.total]);

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={`💰 ${L.payment || 'Payment'}`}
        size="max-w-md"
      >
        <div className="space-y-5">
          {/* Total */}
          <div className="text-center py-4 rounded-xl bg-white/5">
            <p className="text-sm text-slate-400">{L.total}</p>
            <p className="text-4xl font-bold text-emerald-400 mt-1">
              {formatCurrency(totals.total)}
            </p>
            <p className="text-sm text-slate-500 mt-2 capitalize">{paymentMethod}</p>
          </div>

          {/* Cash input */}
          {paymentMethod === 'Cash' && (
            <div>
              <label className="text-sm text-slate-400 block mb-2">{L.cashReceived}</label>
              <input
                type="number"
                value={cashAmount}
                onChange={(e) => setCashAmount(e.target.value)}
                placeholder="0.00"
                className="input text-2xl text-center"
                step="0.01"
                min="0"
                autoFocus
              />

              {/* Quick cash buttons */}
              <div className="flex gap-2 mt-3">
                {quickCashAmounts.map((amt) => (
                  <button
                    key={amt}
                    onClick={() => setCashAmount(amt.toFixed(2))}
                    className="btn btn-secondary flex-1 text-sm"
                  >
                    ${amt}
                  </button>
                ))}
              </div>

              {cashCents >= totals.total && (
                <div className="mt-3 text-center py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                  <p className="text-sm text-slate-400">{L.change}</p>
                  <p className="text-2xl font-bold text-emerald-400">
                    {formatCurrency(changeDue)}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Split payment */}
          {paymentMethod === 'Split' && (
            <div className="space-y-3">
              <div>
                <label className="text-sm text-slate-400 block mb-1">
                  💵 {lang === 'es' ? 'Monto en Efectivo' : 'Cash Amount'}
                </label>
                <input
                  type="number"
                  value={cashAmount}
                  onChange={(e) => setCashAmount(e.target.value)}
                  placeholder="0.00"
                  className="input"
                  step="0.01"
                  min="0"
                />
              </div>
              <div>
                <label className="text-sm text-slate-400 block mb-1">
                  💳 {lang === 'es' ? 'Monto en Tarjeta' : 'Card Amount'}
                </label>
                <input
                  type="number"
                  value={cardAmount}
                  onChange={(e) => setCardAmount(e.target.value)}
                  placeholder="0.00"
                  className="input"
                  step="0.01"
                  min="0"
                />
              </div>
              <p className="text-xs text-slate-500 text-center">
                Total: ${((cashNum + cardNum)).toFixed(2)} / {formatCurrency(totals.total)} {lang === 'es' ? 'requerido' : 'needed'}
              </p>
              {changeDue > 0 && (
                <div className="text-center py-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
                  <p className="text-xs text-slate-400">
                    ⚠️ {lang === 'es' ? 'Sobrepago — Cambio' : 'Overpayment — Change'}
                  </p>
                  <p className="text-xl font-bold text-amber-400">
                    {formatCurrency(changeDue)}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Store credit info */}
          {paymentMethod === 'Store Credit' && selectedCustomer && (
            <div className="text-center py-3 rounded-xl bg-blue-500/10 border border-blue-500/20">
              <p className="text-sm text-slate-400">
                {lang === 'es' ? 'Saldo de Crédito en Tienda' : 'Store Credit Balance'}
              </p>
              <p className="text-2xl font-bold text-blue-400">
                {formatCurrency(selectedCustomer.storeCredit || 0)}
              </p>
              {(selectedCustomer.storeCredit || 0) < totals.total && (
                <p className="text-xs text-red-400 mt-1">
                  {lang === 'es' ? 'Crédito insuficiente' : 'Insufficient credit'}
                </p>
              )}
            </div>
          )}

          {/* Loyalty nag removed in Round R-POS-PAY-DEDUPE F2 — Cart already
              renders an equivalent inline pts badge + "Add customer" CTA
              (Cart.tsx customer button section). Unified to one location. */}

          {/* SMS Receipt Option — only when customer has phone */}
          {selectedCustomer?.phone && (
            <div style={{
              padding: '0.875rem',
              background: 'rgba(16,185,129,0.06)',
              border: '1px solid rgba(16,185,129,0.25)',
              borderRadius: '0.75rem',
            }}>
              <label style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.7rem',
                cursor: 'pointer',
                userSelect: 'none',
              }}>
                <input
                  type="checkbox"
                  checked={sendSmsReceipt}
                  onChange={(e) => setSendSmsReceipt(e.target.checked)}
                  style={{ width: '18px', height: '18px', marginTop: '0.1rem', cursor: 'pointer', flexShrink: 0 }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#34d399' }}>
                    📱 {lang === 'es' ? 'Enviar Recibo por SMS' : 'Send SMS Receipt'}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.2rem' }}>
                    {lang === 'es' ? 'Enviar a' : 'Send to'} {selectedCustomer.name?.split(' ')[0]} — {selectedCustomer.phone}
                    {(!settings.smsProvider || settings.smsProvider === 'none') && (
                      <div style={{ color: '#fbbf24', marginTop: '0.25rem' }}>
                        ⚠️ {lang === 'es' ? 'SMS no configurado en Settings' : 'SMS not configured in Settings'}
                      </div>
                    )}
                  </div>
                </div>
              </label>
            </div>
          )}

          {/* Complete button */}
          <button
            onClick={handleComplete}
            disabled={!canComplete || processing || showPortalConfirm}
            className="btn btn-success w-full text-lg py-4"
          >
            {processing
              ? (lang === 'es' ? 'Procesando…' : 'Processing…')
              : `${L.completeSale} ✓`}
          </button>
        </div>
      </Modal>

      {/* External portal confirmation */}
      <ConfirmDialog
        open={showPortalConfirm}
        title={lang === 'es' ? '⚠️ Portal de Pago Externo' : '⚠️ External Payment Portal'}
        message={lang === 'es'
          ? '¿Ya COMPLETASTE el pago en el portal externo?'
          : 'Have you COMPLETED the payment in the external portal?'}
        confirmLabel={lang === 'es' ? '✅ SÍ — Completar' : '✅ YES — Complete'}
        cancelLabel={lang === 'es' ? '❌ NO — Aún no' : '❌ NO — Not Yet'}
        variant="warning"
        onConfirm={() => {
          setShowPortalConfirm(false);
          handleComplete();
        }}
        onCancel={() => setShowPortalConfirm(false)}
      />
    </>
  );
}

