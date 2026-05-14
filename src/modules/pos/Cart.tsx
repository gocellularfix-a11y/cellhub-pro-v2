// ============================================================
// CellHub Pro — Cart Panel (right sidebar in POS)
// ============================================================

import { useCallback, useMemo, useState } from 'react';
import type { CartItem, Customer, StoreSettings } from '@/store/types';
import type { CartTotals, DiscountState } from './types';
import { formatCurrency } from '@/utils/currency';
import { useToast } from '@/components/ui/Toast';
import { useTranslation } from '@/i18n';
import { useApp } from '@/store/AppProvider';
import { useApprovalGate } from '@/hooks/useApprovalGate';
import { emitDiscountAttempted } from '@/services/intelligence/liveContext/liveContextEvents';
// R-CART-LINE-DISCOUNT-PRICE-OVERRIDE-V1: compact modal for per-line
// override / amount-off / percent-off. Effective per-unit price is
// written back into item.price so downstream totals/tax/receipts
// keep working without ANY math changes.
import Modal from '@/components/ui/Modal';

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
  onCheckout: () => void;
  onClearCart: () => void;
  onSelectCustomer: () => void;
  // R-POS-CUSTOMER-QUICKEDIT-V1: emit when the cashier wants to edit the
  // customer's wireless info (carrier/plan/monthlyPayment) directly from
  // the cart row. Optional — Cart only renders the button when both the
  // item is a phone_payment AND a customer is selected. Parent
  // (POSModule) owns the modal + persistence so Cart stays UI-only.
  onEditCustomerPlan?: (customerId: string) => void;
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
  onCheckout,
  onClearCart,
  onSelectCustomer,
  onEditCustomerPlan,
  settings,
  lang,
  L,
}: CartProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { state: { employees, currentEmployee } } = useApp();
  // R-APPROVAL-GATE-POS-OVERRIDES-V1: gate for per-line price/discount overrides.
  const approvalGate = useApprovalGate({ employees, settings, attemptedByName: currentEmployee?.name });
  const [showCcFeeOverride, setShowCcFeeOverride] = useState(false);

  // R-CART-LINE-DISCOUNT-PRICE-OVERRIDE-V1: line-discount modal state.
  // discountTarget is the cart line being edited; mode picks one of the
  // three exclusive mechanisms. Computed effective price overwrites
  // item.price; item.originalPrice is preserved (or stamped if absent).
  const [discountTarget, setDiscountTarget] = useState<CartItem | null>(null);
  const [discountMode, setDiscountMode] = useState<'override' | 'amount' | 'percent'>('amount');
  const [discountValue, setDiscountValue] = useState<string>('');
  const [discountReason, setDiscountReason] = useState<string>('');

  const openLineDiscount = useCallback((item: CartItem) => {
    setDiscountTarget(item);
    setDiscountMode('amount');
    setDiscountValue('');
    setDiscountReason(item.lineDiscountReason || '');
    emitDiscountAttempted();
  }, []);

  const closeLineDiscount = useCallback(() => {
    setDiscountTarget(null);
    setDiscountValue('');
    setDiscountReason('');
  }, []);

  const resetLineDiscount = useCallback(() => {
    if (!discountTarget) return;
    const original = discountTarget.originalPrice ?? discountTarget.price;
    setCart(cart.map((c) =>
      c.id === discountTarget.id
        ? { ...c, price: original, lineDiscountReason: undefined, lineDiscountApprovedBy: undefined }
        : c,
    ));
    closeLineDiscount();
  }, [cart, setCart, discountTarget, closeLineDiscount]);

  const applyLineDiscount = useCallback(async () => {
    if (!discountTarget) return;
    const raw = parseFloat(discountValue);
    if (!Number.isFinite(raw) || raw < 0) {
      toast(t('cart.lineDiscount.invalid'), 'warning');
      return;
    }
    const original = discountTarget.originalPrice ?? discountTarget.price;
    let effective = original;
    if (discountMode === 'override') {
      // Final per-unit price entered as dollars; convert to cents.
      effective = Math.round(raw * 100);
    } else if (discountMode === 'amount') {
      // Amount-off per UNIT entered as dollars. Clamp to >= 0.
      effective = Math.max(0, original - Math.round(raw * 100));
    } else if (discountMode === 'percent') {
      if (raw > 100) {
        toast(t('cart.lineDiscount.invalid'), 'warning');
        return;
      }
      effective = Math.max(0, Math.round(original * (1 - raw / 100)));
    }
    if (effective < 0) {
      toast(t('cart.lineDiscount.invalid'), 'warning');
      return;
    }

    // R-APPROVAL-GATE-POS-OVERRIDES-V1: gate before applying override/discount.
    const actionType = discountMode === 'override' ? 'PRICE_OVERRIDE' : 'DISCOUNT_OVERRIDE';
    const affectedAmount = Math.max(0, original - effective);
    const reasonStr = discountMode === 'override'
      ? `Price override — ${discountTarget.name}`
      : discountMode === 'percent'
      ? `${raw}% discount — ${discountTarget.name}`
      : `$${raw.toFixed(2)} off — ${discountTarget.name}`;
    const approval = await approvalGate.requestApproval({
      actionType,
      requestedByEmployeeId: currentEmployee?.id || '',
      entityId: discountTarget.id,
      affectedAmount,
      reason: reasonStr,
    });
    if (!approval.approved) return;

    setCart(cart.map((c) =>
      c.id === discountTarget.id
        ? {
            ...c,
            price: effective,
            originalPrice: c.originalPrice ?? original,
            lineDiscountReason: discountReason.trim() || undefined,
          }
        : c,
    ));
    closeLineDiscount();
  }, [cart, setCart, discountTarget, discountMode, discountValue, discountReason, t, toast, closeLineDiscount, approvalGate.requestApproval, currentEmployee]);

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

  // R-CART-FEES BUG-6: per-item toggle for CBE (Battery) and Screen Fee.
  // The booleans already exist on CartItem and are honored by the cart total
  // calculation in pos/types.ts (cbeEligible respects settings.cbeFeeEnabled
  // global gate; screenFeeEligible has no global gate). This just exposes
  // them in the cart UI.
  const toggleItemFee = useCallback(
    (itemId: string, flag: 'cbeEligible' | 'screenFeeEligible') => {
      setCart(cart.map((c) =>
        c.id === itemId ? { ...c, [flag]: !c[flag] } : c,
      ));
    },
    [cart, setCart],
  );

  // ── Loyalty points preview ────────────────────────────────
  const loyaltyPtsPreview = useMemo(() => {
    if (!settings.loyaltyEnabled) return 0;
    const base = cart
      .filter((i) => i.category !== 'phone_payment' && i.category !== 'top_up')
      .reduce((sum, i) => sum + i.price * i.qty, 0);
    return Math.trunc(base / 100);
  }, [cart, settings.loyaltyEnabled]);

  if (cart.length === 0) {
    return (
      <div className="glass-card flex flex-col items-center justify-center h-full p-6">
        <span className="text-5xl mb-4">🛒</span>
        <p className="text-slate-400 font-medium">{t('cart')}</p>
        <p className="text-xs text-slate-500 mt-1">{t('cartEmpty')}</p>
      </div>
    );
  }

  return (
    <div className="glass-card flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <h3 className="text-sm font-semibold text-white">
          🛒 {t('cart')} ({cart.length})
        </h3>
        <button onClick={onClearCart} className="text-xs text-red-400 hover:text-red-300">
          {t('clear')}
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
              : '1px solid var(--border-default)',
          background: selectedCustomer
            ? 'rgba(102,126,234,0.1)'
            : settings.loyaltyEnabled && loyaltyPtsPreview > 0
              ? 'rgba(251,191,36,0.07)'
              : 'var(--bg-input)',
          cursor: 'pointer',
          textAlign: 'left',
          width: 'calc(100% - 2rem)',
          transition: 'all 0.15s',
        }}
      >
        {selectedCustomer ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-accent-soft)', margin: 0 }}>
                👤 {selectedCustomer.name}
              </p>
              {selectedCustomer.storeCredit > 0 && (
                <p style={{ fontSize: '0.7rem', color: '#34d399', margin: '1px 0 0' }}>
                  {t('cart.credit')}: {formatCurrency(selectedCustomer.storeCredit)}
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
            <p style={{ fontSize: '0.78rem', color: settings.loyaltyEnabled && loyaltyPtsPreview > 0 ? '#fbbf24' : 'var(--text-muted)', margin: 0, fontWeight: settings.loyaltyEnabled && loyaltyPtsPreview > 0 ? 600 : 400 }}>
              {settings.loyaltyEnabled && loyaltyPtsPreview > 0
                ? `👤 ${t('cart.addCustomerWithPoints', loyaltyPtsPreview)}`
                : `👤 ${t('cart.addCustomerOptional')}`}
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
                {/* R-POS-CUSTOMER-QUICKEDIT-V1: quick-edit button for the
                    wireless info on the customer record. Only shown when
                    the line is a phone_payment AND a customer is selected
                    AND the parent supplied a handler — gracefully hidden
                    in legacy callers that don't pass onEditCustomerPlan. */}
                {item.category === 'phone_payment' && selectedCustomer && onEditCustomerPlan && (
                  <button
                    type="button"
                    onClick={() => onEditCustomerPlan(selectedCustomer.id)}
                    title={t('pos.cart.editCustomerPlanTooltip')}
                    className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 text-[10px] font-semibold transition"
                  >
                    ✏️ {t('pos.cart.editCustomerPlan')}
                  </button>
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
              {/* Qty controls + line-discount button */}
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
                {/* R-CART-LINE-DISCOUNT-PRICE-OVERRIDE-V1: per-line edit. */}
                <button
                  onClick={() => openLineDiscount(item)}
                  title={t('cart.lineDiscount.edit')}
                  className="w-6 h-6 rounded bg-white/10 text-white text-xs flex items-center justify-center hover:bg-white/20"
                  style={{ marginLeft: 4 }}
                >
                  ✏️
                </button>
              </div>

              {/* Price column. When item.originalPrice differs from
                  item.price, show struck-through original above the
                  effective line total + a small DISCOUNTED badge. */}
              <div style={{ textAlign: 'right' }}>
                {item.originalPrice !== undefined && item.originalPrice !== item.price && (
                  <p className="text-[10px] text-slate-500" style={{ textDecoration: 'line-through', marginBottom: 1 }}>
                    {formatCurrency(item.originalPrice * item.qty)}
                  </p>
                )}
                <p className="text-sm font-medium text-emerald-400">
                  {formatCurrency(item.price * item.qty)}
                </p>
                {item.originalPrice !== undefined && item.originalPrice !== item.price && (
                  <span style={{
                    display: 'inline-block',
                    fontSize: '0.6rem',
                    fontWeight: 700,
                    padding: '1px 5px',
                    borderRadius: 3,
                    background: 'rgba(245,158,11,0.15)',
                    color: '#fbbf24',
                    marginTop: 2,
                    letterSpacing: '0.04em',
                  }}>
                    {item.price === 0
                      ? t('cart.lineDiscount.badgeFree')
                      : (item.lineDiscountReason ? t('cart.lineDiscount.badgeDiscounted') : t('cart.lineDiscount.badgeOverride'))}
                  </span>
                )}
              </div>
            </div>

            {/* Notes */}
            <input
              type="text"
              value={item.notes || ''}
              onChange={(e) => updateNotes(item.id, e.target.value)}
              placeholder={t('addNote')}
              className="mt-2 w-full bg-transparent border-b border-white/10 text-xs text-slate-400
                         placeholder-slate-600 focus:outline-none focus:border-brand-500 py-1"
            />

            {/* R-CART-FEES BUG-6: per-item CBE / Screen Fee toggles.
                Default OFF (the cashier opts in per item). The CBE toggle
                is hidden when the global cbeFeeEnabled is off — otherwise
                clicking it would do nothing (calc gates on the global flag
                in pos/types.ts:124). Screen Fee has no global gate. */}
            <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
              {settings.cbeFeeEnabled && (
                <button
                  type="button"
                  onClick={() => toggleItemFee(item.id, 'cbeEligible')}
                  style={{
                    flex: 1,
                    padding: '0.3rem 0.5rem',
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    borderRadius: '0.4rem',
                    cursor: 'pointer',
                    background: item.cbeEligible
                      ? 'rgba(34,197,94,0.18)'
                      : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${item.cbeEligible
                      ? 'rgba(34,197,94,0.45)'
                      : 'rgba(255,255,255,0.12)'}`,
                    color: item.cbeEligible ? '#34d399' : '#94a3b8',
                  }}
                  aria-pressed={!!item.cbeEligible}
                >
                  🔋 {t('cart.batteryFeeToggle')} {item.cbeEligible ? 'ON' : 'OFF'}
                </button>
              )}
              <button
                type="button"
                onClick={() => toggleItemFee(item.id, 'screenFeeEligible')}
                style={{
                  flex: 1,
                  padding: '0.3rem 0.5rem',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  borderRadius: '0.4rem',
                  cursor: 'pointer',
                  background: item.screenFeeEligible
                    ? 'rgba(34,197,94,0.18)'
                    : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${item.screenFeeEligible
                    ? 'rgba(34,197,94,0.45)'
                    : 'rgba(255,255,255,0.12)'}`,
                  color: item.screenFeeEligible ? '#34d399' : '#94a3b8',
                }}
                aria-pressed={!!item.screenFeeEligible}
              >
                🖥️ {t('cart.screenFeeToggle')} {item.screenFeeEligible ? 'ON' : 'OFF'}
              </button>
            </div>
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
            placeholder={t('discount')}
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
          <span>{t('subtotal')}</span>
          <span>{formatCurrency(totals.subtotal)}</span>
        </div>
        {totals.discountAmount > 0 && (
          <div className="flex justify-between text-amber-400">
            <span>{t('discount')}</span>
            <span>-{formatCurrency(totals.discountAmount)}</span>
          </div>
        )}
        {totals.salesTax > 0 && (
          <div className="flex justify-between text-slate-400">
            <span>{t('tax')}</span>
            <span>{formatCurrency(totals.salesTax)}</span>
          </div>
        )}
        {totals.utilityTax > 0 && (
          <div className="flex justify-between text-slate-400">
            <span>{t('cart.utilityTax')}</span>
            <span>{formatCurrency(totals.utilityTax)}</span>
          </div>
        )}
        {totals.mobileSurcharge > 0 && (
          <div className="flex justify-between text-slate-400">
            <span>{t('cart.surcharge')}</span>
            <span>{formatCurrency(totals.mobileSurcharge)}</span>
          </div>
        )}
        {totals.cbeFee > 0 && (
          <div className="flex justify-between text-slate-400">
            <span>{t('cart.cbeFee')}</span>
            <span>{formatCurrency(totals.cbeFee)}</span>
          </div>
        )}
        {totals.screenFee > 0 && (
          <div className="flex justify-between text-slate-400">
            <span>{t('cart.screenFee')}</span>
            <span>{formatCurrency(totals.screenFee)}</span>
          </div>
        )}
        {totals.creditCardFee > 0 && (
          <div className="flex justify-between text-slate-400">
            <span>{t('cart.ccFee')}</span>
            <span>{formatCurrency(totals.creditCardFee)}</span>
          </div>
        )}
        <div className="flex justify-between text-white font-bold text-lg pt-2 border-t border-white/10">
          <span>{t('total')}</span>
          <span className="text-emerald-400">{formatCurrency(totals.total)}</span>
        </div>
      </div>

      {/* Payment Method */}
      <div className="px-4 py-3 border-t border-white/10 space-y-3">
        <p className="text-xs text-slate-400">{t('paymentMethodLabel')}</p>
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
                {method === 'Cash' ? `💵 ${t('cash')}` :
                 method === 'Card' ? `💳 ${t('card')}` :
                 method === 'Split' ? `✂️ ${t('cart.split')}` :
                 `🏪 ${t('cart.credit')}`}
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
              {t('cart.cashReceived')}
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
              {t('cart.exact')}: ${(totals.total / 100).toFixed(2)}
            </button>
            {(() => {
              // R-CHANGE-RECOMPUTE: cents-first to match saleBuilder.ts.
              // Float math (cashAmount * 100) drifts on penny inputs and
              // would trigger a phantom $0.00 change on exact payments.
              const cashCents = Math.round((cashAmount || 0) * 100);
              if (cashCents > totals.total) return (
                <div className="rounded-lg p-3 text-center" style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.35)' }}>
                  <div className="text-[0.65rem] text-slate-400 uppercase tracking-wide">{t('cart.change')}</div>
                  <div className="text-2xl font-bold text-emerald-400">
                    ${((cashCents - totals.total) / 100).toFixed(2)}
                  </div>
                </div>
              );
              if (cashCents > 0 && cashCents < totals.total) return (
                <div className="rounded-lg p-2 text-center" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
                  <div className="text-[0.65rem] text-red-400 uppercase tracking-wide">{t('cart.shortBy')}</div>
                  <div className="text-base font-bold text-red-400">
                    ${((totals.total - cashCents) / 100).toFixed(2)}
                  </div>
                </div>
              );
              return null;
            })()}
          </div>
        )}

        {/* ── Card mode: amount confirm ── */}
        {paymentMethod === 'Card' && (
          <div className="space-y-2">
            <label className="text-[0.7rem] text-slate-500 uppercase tracking-wide font-bold">
              {t('cart.cardAmount')}
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
                  💵 {t('cash')}
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
                  💳 {t('card')}
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
                  ✓ {t('cart.matches')}
                </div>
              );
              if (diff > 0) return (
                <div className="rounded p-1.5 text-center text-[0.7rem] font-bold text-amber-400" style={{ background: 'rgba(245,158,11,0.1)' }}>
                  {t('cart.overBy')} ${(diff / 100).toFixed(2)}
                </div>
              );
              return (
                <div className="rounded p-1.5 text-center text-[0.7rem] font-bold text-red-400" style={{ background: 'rgba(239,68,68,0.1)' }}>
                  {t('cart.shortBy')} ${(-diff / 100).toFixed(2)}
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
                  ⚠️ {t('cart.selectCustomerForCredit')}
                </div>
              </div>
            );
          }
          const creditBalance = selectedCustomer.storeCredit || 0;
          if (creditBalance <= 0) {
            return (
              <div className="rounded-lg p-3 text-center" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)' }}>
                <div className="text-xs font-semibold text-red-400">
                  ❌ {t('cart.noCreditAvailable')}
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
                <span className="text-slate-400">{t('cart.availableCredit')}</span>
                <span className="font-bold text-emerald-400">{formatCurrency(creditBalance)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">{t('cart.saleTotal')}</span>
                <span className="font-bold">{formatCurrency(totals.total)}</span>
              </div>
              <div className="flex justify-between border-t border-emerald-500/20 pt-1.5">
                <span className="text-slate-400">{t('cart.creditApplied')}</span>
                <span className="font-bold text-emerald-400">−{formatCurrency(creditUsed)}</span>
              </div>
              {remainingBalance > 0 && (
                <div className="flex justify-between">
                  <span className="text-amber-400 font-semibold">{t('cart.remainingDue')}</span>
                  <span className="font-bold text-amber-400">{formatCurrency(remainingBalance)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-emerald-500/20 pt-1.5">
                <span className="text-slate-500 text-[0.7rem]">{t('cart.remainingCredit')}</span>
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
                  💳 {t('cart.creditCardFee')}
                </div>
                <div className="text-[0.7rem] text-slate-500 mt-0.5">
                  {creditCardFeeOverride !== null
                    ? t('cart.customAmountLabel', formatCurrency(creditCardFeeOverride))
                    : formatCurrency(resolveDefaultCcFeeCents(settings))}
                  {' '}{t('cart.perTransaction')}
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
                  {showCcFeeOverride ? t('close') : t('edit')}
                </button>
              )}
            </div>

            {showCcFeeOverride && addCreditCardFee && (
              <div className="mt-2 pt-2 border-t border-orange-500/20">
                <div className="flex items-center gap-2">
                  <span className="text-[0.7rem] text-slate-400 whitespace-nowrap">
                    {t('cart.amountLabel')}
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
                        toast(t('cart.ccFeeWaived'), 'info');
                      } else {
                        toast(t('cart.ccFeeAmount', formatCurrency(cents)), 'info');
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
                      toast(t('cart.ccFeeAmount', formatCurrency(resolveDefaultCcFeeCents(settings))), 'info');
                    }}
                    className="text-[0.65rem] px-2 py-1 rounded bg-slate-500/20 text-slate-400 hover:bg-slate-500/30 transition-colors"
                  >
                    {t('cart.resetToDefault')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Checkout button */}
      <div className="p-4 border-t border-white/10">
        <button
          onClick={onCheckout}
          className="btn btn-success w-full text-base py-3"
          disabled={cart.length === 0}
        >
          {t('completeSale')} — {formatCurrency(totals.total)}
        </button>
      </div>

      {/* R-CART-LINE-DISCOUNT-PRICE-OVERRIDE-V1: per-line override / amount-off /
          percent-off picker. Effective per-unit price overwrites item.price
          so totals/tax/receipts pick it up via existing math — no parallel
          accounting introduced. originalPrice is preserved across edits. */}
      <Modal
        open={!!discountTarget}
        onClose={closeLineDiscount}
        title={t('cart.lineDiscount.title')}
        size="max-w-sm"
        footer={
          <>
            {discountTarget && discountTarget.originalPrice !== undefined &&
             discountTarget.originalPrice !== discountTarget.price && (
              <button
                className="btn btn-secondary"
                onClick={resetLineDiscount}
                style={{ marginRight: 'auto' }}
              >
                {t('cart.lineDiscount.reset')}
              </button>
            )}
            <button className="btn btn-secondary" onClick={closeLineDiscount}>
              {t('cancel')}
            </button>
            <button
              className="btn btn-primary"
              onClick={applyLineDiscount}
              disabled={!discountValue.trim()}
            >
              {t('cart.lineDiscount.apply')}
            </button>
          </>
        }
      >
        {discountTarget && (
          <div className="space-y-3">
            <div className="text-xs text-slate-400">
              {discountTarget.name}
              <br />
              {t('cart.lineDiscount.originalLabel')}: {' '}
              <strong className="text-slate-200">
                {formatCurrency(discountTarget.originalPrice ?? discountTarget.price)}
              </strong>
            </div>
            {/* Mode picker */}
            <div className="grid grid-cols-3 gap-1">
              {(['amount', 'percent', 'override'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setDiscountMode(m); setDiscountValue(''); }}
                  className="px-2 py-1.5 rounded text-xs font-semibold transition-colors duration-150"
                  style={{
                    background: discountMode === m ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.05)',
                    border: `1px solid ${discountMode === m ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.1)'}`,
                    color: discountMode === m ? '#a5b4fc' : '#94a3b8',
                  }}
                >
                  {t(`cart.lineDiscount.mode.${m}`)}
                </button>
              ))}
            </div>
            {/* Value input — units depend on mode */}
            <div>
              <label className="text-xs text-slate-400 font-semibold block mb-1">
                {discountMode === 'percent'
                  ? t('cart.lineDiscount.valuePercentLabel')
                  : t('cart.lineDiscount.valueDollarsLabel')}
              </label>
              <input
                type="number"
                step={discountMode === 'percent' ? '1' : '0.01'}
                min="0"
                max={discountMode === 'percent' ? '100' : undefined}
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                placeholder={discountMode === 'percent' ? '10' : '5.00'}
                className="input"
                autoFocus
              />
            </div>
            {/* Reason — optional */}
            <div>
              <label className="text-xs text-slate-400 font-semibold block mb-1">
                {t('cart.lineDiscount.reasonLabel')}
              </label>
              <input
                type="text"
                value={discountReason}
                onChange={(e) => setDiscountReason(e.target.value)}
                placeholder={t('cart.lineDiscount.reasonPlaceholder')}
                className="input"
              />
            </div>
          </div>
        )}
      </Modal>

      {/* R-APPROVAL-GATE-POS-OVERRIDES-V1 */}
      {approvalGate.modal}
    </div>
  );
}
