// ============================================================
// CellHub Pro — Cart Panel (right sidebar in POS)
// ============================================================

import { useCallback, useMemo, useState } from 'react';
import type { CartItem, Customer, StoreSettings } from '@/store/types';
import type { CartTotals, DiscountState } from './types';
import { formatCurrency } from '@/utils/currency';
import { useToast } from '@/components/ui/Toast';

function resolveDefaultCcFeeCents(settings: StoreSettings): number {
  const shadow = (settings as any).creditCardFeeCents as number | undefined;
  if (shadow !== undefined && shadow !== null) return Math.round(shadow);
  const legacy = settings.creditCardFee;
  if (typeof legacy === 'number' && legacy > 0) return Math.round(legacy * 100);
  return 500;
}

interface CartProps {
  cart: CartItem[];
  setCart: (cart: CartItem[]) => void;
  totals: CartTotals;
  selectedCustomer: Customer | null;
  discount: DiscountState;
  setDiscount: (d: DiscountState) => void;
  paymentMethod: string;
  setPaymentMethod: (m: string) => void;
  cashAmount: number;
  setCashAmount: (n: number) => void;
  cardAmount: number;
  setCardAmount: (n: number) => void;
  addCreditCardFee: boolean;
  setAddCreditCardFee: (b: boolean) => void;
  creditCardFeeOverride: number | null;
  setCreditCardFeeOverride: (n: number | null) => void;
  sendSmsReceipt: boolean;
  setSendSmsReceipt: (b: boolean) => void;
  onCheckout: () => void;
  onClearCart: () => void;
  onSelectCustomer: () => void;
  settings: StoreSettings;
  lang: string;
  L: Record<string, any>;
}

export default function Cart({
  cart,
  setCart,
  totals,
  selectedCustomer,
  discount,
  setDiscount,
  paymentMethod,
  setPaymentMethod,
  cashAmount,
  setCashAmount,
  cardAmount,
  setCardAmount,
  addCreditCardFee,
  setAddCreditCardFee,
  creditCardFeeOverride,
  setCreditCardFeeOverride,
  sendSmsReceipt,
  setSendSmsReceipt,
  onCheckout,
  onClearCart,
  onSelectCustomer,
  settings,
  lang,
  L,
}: CartProps) {
  const es = lang === 'es';
  const { toast } = useToast();
  const [showCcFeeOverride, setShowCcFeeOverride] = useState(false);

  const updateQty = useCallback(
    (itemId: string, delta: number) => {
      setCart(
        cart.map((c) =>
          c.id === itemId ? { ...c, qty: Math.max(1, c.qty + delta) } : c,
        ),
      );
    },
    [cart, setCart],
  );

  const removeItem = useCallback(
    (itemId: string) => {
      setCart(cart.filter((c) => c.id !== itemId));
    },
    [cart, setCart],
  );

  const updateNotes = useCallback(
    (itemId: string, notes: string) => {
      setCart(cart.map((c) => (c.id === itemId ? { ...c, notes } : c)));
    },
    [cart, setCart],
  );

  // ── Loyalty points preview ────────────────────────────────
  const loyaltyPtsPreview = useMemo(() => {
    if (!settings.loyaltyEnabled) return 0;
    const base = cart
      .filter((i) => i.category !== 'phone_payment' && i.category !== 'top_up')
      .reduce((sum, i) => sum + i.price * i.qty, 0);
    return Math.floor(base / 100);
  }, [cart, settings.loyaltyEnabled]);

  if (cart.length === 0) {
    return (
      <div className="glass-card flex flex-col items-center justify-center h-full p-6">
        <span className="text-5xl mb-4">🛒</span>
        <p className="text-slate-400 font-medium">{L.cart || 'Cart'}</p>
        <p className="text-xs text-slate-500 mt-1">{L.cartEmpty || 'Cart is empty'}</p>
      </div>
    );
  }

  return (
    <div className="glass-card flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <h3 className="text-sm font-semibold text-white">
          🛒 {L.cart} ({cart.length})
        </h3>
        <button onClick={onClearCart} className="text-xs text-red-400 hover:text-red-300">
          {L.clear}
        </button>
      </div>

      {/* Customer — prominent with loyalty preview */}
      <button
        onClick={onSelectCustomer}
        style={{
          margin: '0.625rem 1rem 0.375rem',
          padding: '0.5rem 0.75rem',
          borderRadius: '0.625rem',
          border: selectedCustomer
            ? '1px solid rgba(102,126,234,0.4)'
            : settings.loyaltyEnabled && loyaltyPtsPreview > 0
              ? '1px solid rgba(251,191,36,0.5)'
              : '1px solid rgba(255,255,255,0.1)',
          background: selectedCustomer
            ? 'rgba(102,126,234,0.1)'
            : settings.loyaltyEnabled && loyaltyPtsPreview > 0
              ? 'rgba(251,191,36,0.07)'
              : 'rgba(255,255,255,0.05)',
          cursor: 'pointer',
          textAlign: 'left',
          width: 'calc(100% - 2rem)',
          transition: 'all 0.15s',
        }}
      >
        {selectedCustomer ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ fontSize: '0.8rem', fontWeight: 700, color: '#a5b4fc', margin: 0 }}>
                👤 {selectedCustomer.name}
              </p>
              {selectedCustomer.storeCredit > 0 && (
                <p style={{ fontSize: '0.7rem', color: '#34d399', margin: '1px 0 0' }}>
                  {es ? 'Crédito' : 'Credit'}: {formatCurrency(selectedCustomer.storeCredit)}
                </p>
              )}
            </div>
            {settings.loyaltyEnabled && loyaltyPtsPreview > 0 && (
              <span style={{
                fontSize: '0.7rem', fontWeight: 700,
                background: 'rgba(102,126,234,0.2)', color: '#a5b4fc',
                padding: '0.15rem 0.5rem', borderRadius: '999px',
              }}>
                +{loyaltyPtsPreview} pts
              </span>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <p style={{ fontSize: '0.78rem', color: settings.loyaltyEnabled && loyaltyPtsPreview > 0 ? '#fbbf24' : '#64748b', margin: 0, fontWeight: settings.loyaltyEnabled && loyaltyPtsPreview > 0 ? 600 : 400 }}>
              {settings.loyaltyEnabled && loyaltyPtsPreview > 0
                ? (es ? `👤 Agregar cliente — +${loyaltyPtsPreview} pts` : `👤 Add customer — +${loyaltyPtsPreview} pts`)
                : (es ? '👤 Agregar cliente (opcional)' : '👤 Add customer (optional)')}
            </p>
            {settings.loyaltyEnabled && loyaltyPtsPreview > 0 && (
              <span style={{
                fontSize: '0.65rem', fontWeight: 700,
                background: 'rgba(251,191,36,0.15)', color: '#f59e0b',
                padding: '0.15rem 0.4rem', borderRadius: '999px',
              }}>
                🎁 {loyaltyPtsPreview} pts
              </span>
            )}
          </div>
        )}
      </button>

      {/* Items */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
        {cart.map((item) => (
          <div key={item.id} className="rounded-lg bg-white/5 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white font-medium truncate">{item.name}</p>
                {item.carrier && (
                  <p className="text-xs text-blue-400">{item.carrier}</p>
                )}
              </div>
              <button
                onClick={() => removeItem(item.id)}
                className="text-slate-500 hover:text-red-400 shrink-0"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex items-center justify-between mt-2">
              {/* Qty controls */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => updateQty(item.id, -1)}
                  className="w-6 h-6 rounded bg-white/10 text-white text-xs flex items-center justify-center hover:bg-white/20"
                >
                  −
                </button>
                <span className="text-sm text-white w-6 text-center">{item.qty}</span>
                <button
                  onClick={() => updateQty(item.id, 1)}
                  className="w-6 h-6 rounded bg-white/10 text-white text-xs flex items-center justify-center hover:bg-white/20"
                >
                  +
                </button>
              </div>

              <p className="text-sm font-medium text-emerald-400">
                {formatCurrency(item.price * item.qty)}
              </p>
            </div>

            {/* Notes */}
            <input
              type="text"
              value={item.notes || ''}
              onChange={(e) => updateNotes(item.id, e.target.value)}
              placeholder={L.addNote || 'Add note…'}
              className="mt-2 w-full bg-transparent border-b border-white/10 text-xs text-slate-400
                         placeholder-slate-600 focus:outline-none focus:border-brand-500 py-1"
            />
          </div>
        ))}
      </div>

      {/* Discount */}
      <div className="px-4 py-2 border-t border-white/10">
        <div className="flex gap-2">
          <input
            type="number"
            min="0"
            step="0.01"
            value={discount.amount || ''}
            onChange={(e) => setDiscount({ ...discount, amount: parseFloat(e.target.value) || 0 })}
            placeholder={L.discount || 'Discount'}
            className="input input-sm flex-1"
          />
          <select
            value={discount.type}
            onChange={(e) => setDiscount({ ...discount, type: e.target.value as 'percent' | 'dollar' })}
            className="select input-sm w-16"
          >
            <option value="percent">%</option>
            <option value="dollar">$</option>
          </select>
        </div>
      </div>

      {/* Totals */}
      <div className="px-4 py-3 border-t border-white/10 space-y-1 text-sm">
        <div className="flex justify-between text-slate-400">
          <span>{L.subtotal}</span>
          <span>{formatCurrency(totals.subtotal)}</span>
        </div>
        {totals.discountAmount > 0 && (
          <div className="flex justify-between text-amber-400">
            <span>{L.discount}</span>
            <span>-{formatCurrency(totals.discountAmount)}</span>
          </div>
        )}
        {totals.salesTax > 0 && (
          <div className="flex justify-between text-slate-400">
            <span>{L.tax}</span>
            <span>{formatCurrency(totals.salesTax)}</span>
          </div>
        )}
        {totals.utilityTax > 0 && (
          <div className="flex justify-between text-slate-400">
            <span>{es ? 'Imp. Utilidad' : 'Utility Tax'}</span>
            <span>{formatCurrency(totals.utilityTax)}</span>
          </div>
        )}
        {totals.mobileSurcharge > 0 && (
          <div className="flex justify-between text-slate-400">
            <span>{es ? 'Recargo Móvil' : 'Surcharge'}</span>
            <span>{formatCurrency(totals.mobileSurcharge)}</span>
          </div>
        )}
        {totals.cbeFee > 0 && (
          <div className="flex justify-between text-slate-400">
            <span>{es ? 'Cuota CBE' : 'CBE Fee'}</span>
            <span>{formatCurrency(totals.cbeFee)}</span>
          </div>
        )}
        {totals.screenFee > 0 && (
          <div className="flex justify-between text-slate-400">
            <span>{es ? 'Cuota Pantalla' : 'Screen Fee'}</span>
            <span>{formatCurrency(totals.screenFee)}</span>
          </div>
        )}
        {totals.creditCardFee > 0 && (
          <div className="flex justify-between text-slate-400">
            <span>{es ? 'Cargo Tarjeta' : 'CC Fee'}</span>
            <span>{formatCurrency(totals.creditCardFee)}</span>
          </div>
        )}
        <div className="flex justify-between text-white font-bold text-lg pt-2 border-t border-white/10">
          <span>{L.total}</span>
          <span className="text-emerald-400">{formatCurrency(totals.total)}</span>
        </div>
      </div>

      {/* Payment Method */}
      <div className="px-4 py-3 border-t border-white/10 space-y-3">
        <p className="text-xs text-slate-400">{L.paymentMethodLabel}</p>
        <div className="grid grid-cols-4 gap-1">
          {['Cash', 'Card', 'Split', 'Store Credit'].map((method) => {
            const isStoreCredit = method === 'Store Credit';
            const creditBalance = isStoreCredit && selectedCustomer ? (selectedCustomer.storeCredit || 0) : 0;
            return (
              <button
                key={method}
                onClick={() => {
                  setPaymentMethod(method);
                  // Auto-prefill amounts based on the chosen mode.
                  // Round R-POS-PAY-DEDUPE F3: totals.total is cents-as-int
                  // (confirmed in types.ts CartTotals). Prior expression
                  // `Math.ceil(totals.total / 100) * 100 / 100` was a no-op
                  // dollar round-up that happened to produce the correct
                  // value by accident — replaced with the explicit form.
                  if (method === 'Cash') {
                    const totalCents = Number(totals.total || 0);
                    setCashAmount(Math.ceil(totalCents / 100));
                  }
                  if (method === 'Card') setCardAmount(totals.total / 100);
                  if (method === 'Split') {
                    // half/half default
                    setCashAmount(0);
                    setCardAmount(0);
                  }
                }}
                className={`py-2 px-1 rounded-lg text-xs font-medium transition-all ${
                  paymentMethod === method
                    ? 'bg-emerald-600 text-white border-2 border-emerald-500'
                    : isStoreCredit && creditBalance > 0
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                      : 'bg-white/5 text-slate-400 hover:bg-white/10 border border-white/10'
                }`}
              >
                {method === 'Cash' ? `💵 ${L.cash || 'Cash'}` :
                 method === 'Card' ? `💳 ${L.card || 'Card'}` :
                 method === 'Split' ? (es ? '✂️ Dividir' : '✂️ Split') :
                 (es ? '🏪 Crédito' : '🏪 Credit')}
                {isStoreCredit && creditBalance > 0 && (
                  <div className="text-[0.62rem] font-normal mt-0.5 opacity-80">
                    {formatCurrency(creditBalance)}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* ── Cash mode: input + change ── */}
        {paymentMethod === 'Cash' && (
          <div className="space-y-2">
            <label className="text-[0.7rem] text-slate-500 uppercase tracking-wide font-bold">
              {es ? 'Efectivo Recibido' : 'Cash Received'}
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={cashAmount || ''}
              onChange={(e) => setCashAmount(parseFloat(e.target.value) || 0)}
              placeholder={(totals.total / 100).toFixed(2)}
              className="input"
              style={{
                textAlign: 'center',
                fontSize: '1.4rem',
                fontWeight: 700,
                color: '#10b981',
                background: 'rgba(16,185,129,0.08)',
                border: '1px solid rgba(16,185,129,0.3)',
              }}
            />
            {/* Quick cash buttons */}
            <div className="grid grid-cols-4 gap-1">
              {[20, 40, 60, 100].map((amt) => (
                <button
                  key={amt}
                  onClick={() => setCashAmount(amt)}
                  className="py-1 px-1 rounded text-[0.7rem] font-semibold bg-white/5 text-slate-400 hover:bg-white/10 transition"
                >
                  ${amt}
                </button>
              ))}
            </div>
            <button
              onClick={() => setCashAmount(Math.ceil(totals.total / 100))}
              className="w-full py-1 rounded text-[0.7rem] font-semibold bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition"
            >
              {es ? 'Exacto' : 'Exact'}: ${(totals.total / 100).toFixed(2)}
            </button>
            {cashAmount * 100 > totals.total && (
              <div className="rounded-lg p-3 text-center" style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.35)' }}>
                <div className="text-[0.65rem] text-slate-400 uppercase tracking-wide">{es ? 'Cambio' : 'Change'}</div>
                <div className="text-2xl font-bold text-emerald-400">
                  ${(cashAmount - totals.total / 100).toFixed(2)}
                </div>
              </div>
            )}
            {cashAmount > 0 && cashAmount * 100 < totals.total && (
              <div className="rounded-lg p-2 text-center" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
                <div className="text-[0.65rem] text-red-400 uppercase tracking-wide">{es ? 'Falta' : 'Short by'}</div>
                <div className="text-base font-bold text-red-400">
                  ${(totals.total / 100 - cashAmount).toFixed(2)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Card mode: amount confirm ── */}
        {paymentMethod === 'Card' && (
          <div className="space-y-2">
            <label className="text-[0.7rem] text-slate-500 uppercase tracking-wide font-bold">
              {es ? 'Monto Tarjeta' : 'Card Amount'}
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={cardAmount || ''}
              onChange={(e) => setCardAmount(parseFloat(e.target.value) || 0)}
              placeholder={(totals.total / 100).toFixed(2)}
              className="input"
              style={{
                textAlign: 'center',
                fontSize: '1.3rem',
                fontWeight: 700,
                color: '#a78bfa',
                background: 'rgba(167,139,250,0.08)',
                border: '1px solid rgba(167,139,250,0.3)',
              }}
            />
          </div>
        )}

        {/* ── Split mode: cash + card inputs ── */}
        {paymentMethod === 'Split' && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[0.65rem] text-emerald-400 uppercase tracking-wide font-bold block mb-1">
                  💵 {es ? 'Efectivo' : 'Cash'}
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={cashAmount || ''}
                  onChange={(e) => setCashAmount(parseFloat(e.target.value) || 0)}
                  placeholder="0.00"
                  className="input"
                  style={{ textAlign: 'center', fontWeight: 700, color: '#10b981' }}
                />
              </div>
              <div>
                <label className="text-[0.65rem] text-purple-400 uppercase tracking-wide font-bold block mb-1">
                  💳 {es ? 'Tarjeta' : 'Card'}
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={cardAmount || ''}
                  onChange={(e) => setCardAmount(parseFloat(e.target.value) || 0)}
                  placeholder="0.00"
                  className="input"
                  style={{ textAlign: 'center', fontWeight: 700, color: '#a78bfa' }}
                />
              </div>
            </div>
            {(() => {
              const sum = (cashAmount + cardAmount) * 100;
              const diff = sum - totals.total;
              if (Math.abs(diff) < 1) return (
                <div className="rounded p-1.5 text-center text-[0.7rem] font-bold text-emerald-400" style={{ background: 'rgba(16,185,129,0.1)' }}>
                  ✓ {es ? 'Cuadra' : 'Matches'}
                </div>
              );
              if (diff > 0) return (
                <div className="rounded p-1.5 text-center text-[0.7rem] font-bold text-amber-400" style={{ background: 'rgba(245,158,11,0.1)' }}>
                  {es ? 'Sobra' : 'Over by'} ${(diff / 100).toFixed(2)}
                </div>
              );
              return (
                <div className="rounded p-1.5 text-center text-[0.7rem] font-bold text-red-400" style={{ background: 'rgba(239,68,68,0.1)' }}>
                  {es ? 'Falta' : 'Short by'} ${(-diff / 100).toFixed(2)}
                </div>
              );
            })()}
          </div>
        )}

        {/* ── Store Credit preview ── */}
        {paymentMethod === 'Store Credit' && (() => {
          if (!selectedCustomer) {
            return (
              <div className="rounded-lg p-3 text-center" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)' }}>
                <div className="text-xs font-semibold text-red-400">
                  ⚠️ {es ? 'Selecciona un cliente para usar crédito' : 'Select a customer to use store credit'}
                </div>
              </div>
            );
          }
          const creditBalance = selectedCustomer.storeCredit || 0;
          if (creditBalance <= 0) {
            return (
              <div className="rounded-lg p-3 text-center" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)' }}>
                <div className="text-xs font-semibold text-red-400">
                  ❌ {es ? 'Sin crédito disponible' : 'No store credit available'}
                </div>
              </div>
            );
          }
          const creditUsed = Math.min(creditBalance, totals.total);
          const remainingBalance = Math.max(0, totals.total - creditUsed);
          const newCreditBalance = creditBalance - creditUsed;
          return (
            <div className="rounded-lg p-3 space-y-1.5 text-xs" style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.3)' }}>
              <div className="flex justify-between">
                <span className="text-slate-400">{es ? 'Crédito disponible' : 'Available credit'}</span>
                <span className="font-bold text-emerald-400">{formatCurrency(creditBalance)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">{es ? 'Total a cobrar' : 'Sale total'}</span>
                <span className="font-bold">{formatCurrency(totals.total)}</span>
              </div>
              <div className="flex justify-between border-t border-emerald-500/20 pt-1.5">
                <span className="text-slate-400">{es ? 'Crédito aplicado' : 'Credit applied'}</span>
                <span className="font-bold text-emerald-400">−{formatCurrency(creditUsed)}</span>
              </div>
              {remainingBalance > 0 && (
                <div className="flex justify-between">
                  <span className="text-amber-400 font-semibold">{es ? 'Falta cobrar' : 'Remaining due'}</span>
                  <span className="font-bold text-amber-400">{formatCurrency(remainingBalance)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-emerald-500/20 pt-1.5">
                <span className="text-slate-500 text-[0.7rem]">{es ? 'Crédito restante' : 'Remaining credit'}</span>
                <span className="text-slate-400 text-[0.7rem]">{formatCurrency(newCreditBalance)}</span>
              </div>
            </div>
          );
        })()}

        {/* ── Credit Card Fee toggle + override (Card or Split only) ── */}
        {(paymentMethod === 'Card' || paymentMethod === 'Split') && (
          <div
            className="rounded-lg p-2.5"
            style={{ background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.25)' }}
          >
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={addCreditCardFee}
                onChange={(e) => setAddCreditCardFee(e.target.checked)}
                style={{ width: '18px', height: '18px', accentColor: '#f97316', cursor: 'pointer' }}
              />
              <div className="flex-1 text-xs">
                <div className="font-bold text-orange-400">
                  💳 {es ? 'Cargo por Tarjeta' : 'Credit Card Fee'}
                </div>
                <div className="text-[0.7rem] text-slate-500 mt-0.5">
                  {creditCardFeeOverride !== null
                    ? es ? `Personalizado: ${formatCurrency(creditCardFeeOverride)}` : `Custom: ${formatCurrency(creditCardFeeOverride)}`
                    : formatCurrency(resolveDefaultCcFeeCents(settings))}
                  {es ? ' por transacción' : ' per transaction'}
                </div>
              </div>
              {addCreditCardFee && totals.creditCardFee > 0 && (
                <span className="font-bold text-orange-400 text-sm">
                  +{formatCurrency(totals.creditCardFee)}
                </span>
              )}
              {addCreditCardFee && (
                <button
                  type="button"
                  onClick={() => setShowCcFeeOverride(!showCcFeeOverride)}
                  className="text-[0.65rem] px-2 py-1 rounded bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 transition-colors"
                >
                  {showCcFeeOverride ? (es ? 'Cerrar' : 'Close') : (es ? 'Editar' : 'Edit')}
                </button>
              )}
            </div>

            {showCcFeeOverride && addCreditCardFee && (
              <div className="mt-2 pt-2 border-t border-orange-500/20">
                <div className="flex items-center gap-2">
                  <span className="text-[0.7rem] text-slate-400 whitespace-nowrap">
                    {es ? 'Monto ($):' : 'Amount ($):'}
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={creditCardFeeOverride !== null ? (creditCardFeeOverride / 100).toFixed(2) : ''}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      const cents = Math.max(0, Math.round(val * 100));
                      setCreditCardFeeOverride(cents);
                      if (cents === 0) {
                        toast(es ? 'Cargo de tarjeta removido' : 'CC fee waived', 'info');
                      } else {
                        toast(es ? `Cargo de tarjeta: ${formatCurrency(cents)}` : `CC fee: ${formatCurrency(cents)}`, 'info');
                      }
                    }}
                    className="input flex-1 text-xs py-1"
                    style={{ textAlign: 'right' }}
                    placeholder="5.00"
                    autoFocus
                  />
                </div>
                <div className="flex gap-2 mt-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setCreditCardFeeOverride(null);
                      setShowCcFeeOverride(false);
                      toast(es ? `Cargo de tarjeta: ${formatCurrency(resolveDefaultCcFeeCents(settings))}` : `CC fee: ${formatCurrency(resolveDefaultCcFeeCents(settings))}`, 'info');
                    }}
                    className="text-[0.65rem] px-2 py-1 rounded bg-slate-500/20 text-slate-400 hover:bg-slate-500/30 transition-colors"
                  >
                    {es ? 'Restaurar default' : 'Reset to default'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* SMS Receipt checkbox — only when customer has a valid phone (>=10 digits).
          Round R-POS-PAY-DEDUPE F2: moved from PaymentModal for bypass-path parity. */}
      {selectedCustomer?.phone
       && typeof selectedCustomer.phone === 'string'
       && selectedCustomer.phone.replace(/\D/g, '').length >= 10 && (
        <div className="px-4 py-3 border-t border-white/10">
          <label
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.7rem',
              cursor: 'pointer',
              userSelect: 'none',
              padding: '0.75rem',
              background: 'rgba(16,185,129,0.06)',
              border: '1px solid rgba(16,185,129,0.25)',
              borderRadius: '0.625rem',
            }}
          >
            <input
              type="checkbox"
              checked={sendSmsReceipt}
              onChange={(e) => setSendSmsReceipt(e.target.checked)}
              style={{ width: '18px', height: '18px', marginTop: '0.1rem', cursor: 'pointer', flexShrink: 0 }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#34d399' }}>
                📱 {es ? 'Enviar Recibo por SMS' : 'Send SMS Receipt'}
              </div>
              <div style={{ fontSize: '0.68rem', color: '#94a3b8', marginTop: '0.15rem' }}>
                {es ? 'Enviar a' : 'Send to'} {selectedCustomer.name?.split(' ')[0]} — {selectedCustomer.phone}
                {(!settings.smsProvider || settings.smsProvider === 'none') && (
                  <div style={{ color: '#fbbf24', marginTop: '0.2rem' }}>
                    ⚠️ {es ? 'SMS no configurado en Settings' : 'SMS not configured in Settings'}
                  </div>
                )}
              </div>
            </div>
          </label>
        </div>
      )}

      {/* Checkout button */}
      <div className="p-4 border-t border-white/10">
        <button
          onClick={onCheckout}
          className="btn btn-success w-full text-base py-3"
          disabled={cart.length === 0}
        >
          {L.completeSale} — {formatCurrency(totals.total)}
        </button>
      </div>
    </div>
  );
}
