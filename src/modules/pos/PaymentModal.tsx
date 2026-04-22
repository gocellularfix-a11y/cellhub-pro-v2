// ============================================================
// CellHub Pro — Payment / Checkout Modal (SLIM — phone_payment portal path only)
//
// Round R-POS-PAY-DEDUPE F3: all payment-capture UI (Cash input,
// Card input, Split inputs, Store Credit preview, Quick cash buttons,
// Change display, SMS checkbox, Loyalty nag) was moved to Cart.tsx.
// This modal now only handles the external-portal-done warning that
// Jorge explicitly asked to preserve.
// ============================================================

import { useMemo, useState } from 'react';
import { Modal, ConfirmDialog } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { formatCurrency } from '@/utils/currency';
import type { CartItem, Customer, Sale, Employee, StoreSettings } from '@/store/types';
import type { CartTotals } from './types';
import { buildSale, computePaidCents } from './saleBuilder';

interface PaymentModalProps {
  open: boolean;
  onClose: () => void;
  cart: CartItem[];
  totals: CartTotals;
  paymentMethod: string;
  /** DOLLARS — readonly from Cart/POSModule state (invariant I3). */
  cashAmount: number;
  /** DOLLARS — readonly from Cart/POSModule state (invariant I3). */
  cardAmount: number;
  selectedCustomer: Customer | null;
  currentEmployee: Employee | null;
  settings: StoreSettings;
  onComplete: (sale: Sale) => void;
  lang: string;
  L: Record<string, any>;
}

export default function PaymentModal({
  open,
  onClose,
  cart,
  totals,
  paymentMethod,
  cashAmount,
  cardAmount,
  selectedCustomer,
  currentEmployee,
  settings,
  onComplete,
  lang,
  L,
}: PaymentModalProps) {
  const [showPortalConfirm, setShowPortalConfirm] = useState(false);
  const [processing, setProcessing] = useState(false);
  const { toast } = useToast();

  // External portal detection — invariant I6 robust: explicit string check
  // on carrier prevents a phone_payment item with undefined/empty carrier
  // from silently skipping the portal warning.
  const hasExternalPortal = useMemo(
    () => cart.some((item) =>
      item.category === 'phone_payment'
      && typeof item.carrier === 'string'
      && item.carrier.trim().length > 0
    ),
    [cart],
  );

  // CRITICAL: PaymentModal must NOT own payment logic (I3 invariant).
  // Values come from Cart state via readonly props (cashAmount,
  // cardAmount, paymentMethod). Do NOT recompute or derive here —
  // ensures parity with bypass path in POSModule.onCheckout (F4).
  const handleComplete = async () => {
    if (processing) return;

    // Paso 1: ConfirmDialog portal PRIMERO (antes del guard).
    // Jorge-mandated warning for carrier-portal payments.
    if (hasExternalPortal && !showPortalConfirm) {
      setShowPortalConfirm(true);
      return;
    }

    // Paso 2: Guard de pago insuficiente — invariant I2.
    // NOTA: NO reseteamos showPortalConfirm aquí. El ConfirmDialog
    // se pregunta una sola vez por apertura del modal; si el user
    // corrige cash y reintenta, va directo al guard sin re-preguntar.
    const paidCents = computePaidCents(
      paymentMethod,
      cashAmount,
      cardAmount,
      selectedCustomer?.storeCredit ?? 0,
      totals.total,
    );
    if (paidCents < totals.total) {
      const shortBy = totals.total - paidCents;
      toast(
        lang === 'es'
          ? `Pago insuficiente — falta $${(shortBy / 100).toFixed(2)}`
          : `Insufficient payment — short by $${(shortBy / 100).toFixed(2)}`,
        'error',
      );
      return;
    }

    // Paso 3: buildSale + onComplete — single post-sale layer (I1, I7).
    setProcessing(true);
    try {
      const sale = buildSale({
        cart,
        totals,
        paymentMethod,
        cashAmount,
        cardAmount,
        selectedCustomer,
        currentEmployee,
        settings,
      });
      onComplete(sale);
    } finally {
      setProcessing(false);
    }
  };

  const disabled = cart.length === 0 || !currentEmployee || processing || showPortalConfirm;

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

          {/* External portal reminder — visual cue before button click */}
          {hasExternalPortal && (
            <div className="text-center py-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <p className="text-sm text-amber-400">
                ⚠️ {lang === 'es'
                  ? 'Requiere pago en portal externo'
                  : 'External portal payment required'}
              </p>
            </div>
          )}

          {/* Complete button */}
          <button
            onClick={handleComplete}
            disabled={disabled}
            className="btn btn-success w-full text-lg py-4"
          >
            {processing
              ? (lang === 'es' ? 'Procesando…' : 'Processing…')
              : `${L.completeSale} ✓`}
          </button>
        </div>
      </Modal>

      {/* External portal confirmation — keep (Jorge-mandated) */}
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
