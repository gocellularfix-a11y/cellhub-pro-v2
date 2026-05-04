// ============================================================
// CellHub Pro — Payment / Checkout Modal (SLIM — phone_payment portal path only)
//
// Round R-POS-PAY-DEDUPE F3: all payment-capture UI (Cash input,
// Card input, Split inputs, Store Credit preview, Quick cash buttons,
// Change display, SMS checkbox, Loyalty nag) was moved to Cart.tsx.
// This modal now only handles the external-portal-done warning that
// Jorge explicitly asked to preserve.
//
// R-PORTAL-WARN: Enhanced rotating confirmation modal — variant changes
// each time the modal opens so cashiers cannot click through on autopilot.
// Checkbox friction required before the Confirm button unlocks.
// ============================================================

import { useMemo, useRef, useState } from 'react';
import { Modal } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { useTranslation } from '@/i18n';
import { formatCurrency } from '@/utils/currency';
import type { CartItem, Customer, Sale, Employee, StoreSettings } from '@/store/types';
import type { CartTotals } from './types';
import { buildSale, computePaidCents } from './saleBuilder';

// ── Rotating variant definitions ─────────────────────────────
// 4 visual styles cycling deterministically on each modal open.
// Order: danger → warning → verification → attention
const PORTAL_VARIANTS = [
  {
    icon: '🛑',
    titleKey: 'paymentModal.portalV0Title',
    helperKey: 'paymentModal.portalV0Helper',
    accent: '#EF4444',
    bg: 'rgba(239,68,68,0.09)',
    borderColor: 'rgba(239,68,68,0.35)',
  },
  {
    icon: '⚠️',
    titleKey: 'paymentModal.portalV1Title',
    helperKey: 'paymentModal.portalV1Helper',
    accent: '#F59E0B',
    bg: 'rgba(245,158,11,0.09)',
    borderColor: 'rgba(245,158,11,0.35)',
  },
  {
    icon: '🔍',
    titleKey: 'paymentModal.portalV2Title',
    helperKey: 'paymentModal.portalV2Helper',
    accent: '#3B82F6',
    bg: 'rgba(59,130,246,0.09)',
    borderColor: 'rgba(59,130,246,0.35)',
  },
  {
    icon: '🔔',
    titleKey: 'paymentModal.portalV3Title',
    helperKey: 'paymentModal.portalV3Helper',
    accent: '#8B5CF6',
    bg: 'rgba(139,92,246,0.09)',
    borderColor: 'rgba(139,92,246,0.35)',
  },
] as const;

type PortalVariant = typeof PORTAL_VARIANTS[number];

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
  const [portalVerified, setPortalVerified] = useState(false);
  // Deterministic rotation: ref tracks next variant index; state holds current.
  const nextVariantRef = useRef(0);
  const [variantIdx, setVariantIdx] = useState(0);

  const { toast } = useToast();
  const { t } = useTranslation();

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
      // Advance to next variant deterministically before opening.
      const vi = nextVariantRef.current;
      nextVariantRef.current = (vi + 1) % PORTAL_VARIANTS.length;
      setVariantIdx(vi);
      setPortalVerified(false);
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
    // R-POS-CARD-PAYMENT-FUNDS-BUG: pure Card payments delegate authorization
    // to the terminal — the cardAmount input is informational only and may be
    // stale (auto-prefill drift after cart/CC-fee changes). Skip the funds
    // guard for Card. Cash, Split (cash portion + record-keeping), and Store
    // Credit (known balance) still validate.
    if (paymentMethod !== 'Card' && paidCents < totals.total) {
      const shortBy = totals.total - paidCents;
      toast(t('paymentModal.insufficientPayment', formatCurrency(shortBy)), 'error');
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
        title={`💰 ${t('payment')}`}
        size="max-w-md"
      >
        <div className="space-y-5">
          {/* Total */}
          <div className="text-center py-4 rounded-xl bg-white/5">
            <p className="text-sm text-slate-400">{t('total')}</p>
            <p className="text-4xl font-bold text-emerald-400 mt-1">
              {formatCurrency(totals.total)}
            </p>
            <p className="text-sm text-slate-500 mt-2 capitalize">{paymentMethod}</p>
          </div>

          {/* External portal reminder — strengthened visual cue before button click */}
          {hasExternalPortal && (
            <div className="rounded-xl border-2 border-amber-500/40 bg-amber-500/10 px-4 py-4 text-center">
              <p className="text-base font-bold text-amber-400">
                ⚠️ {t('paymentModal.externalPortalRequired')}
              </p>
              <p className="text-xs text-amber-300/80 mt-1">
                {t('paymentModal.portalV1Helper')}
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
              ? t('paymentModal.processing')
              : `${t('completeSale')} ✓`}
          </button>
        </div>
      </Modal>

      {/* External portal confirmation — rotating enhanced modal (Jorge-mandated) */}
      {showPortalConfirm && (
        <ExternalPortalConfirmModal
          variant={PORTAL_VARIANTS[variantIdx]}
          verified={portalVerified}
          onVerifiedChange={setPortalVerified}
          onConfirm={() => {
            setShowPortalConfirm(false);
            setPortalVerified(false);
            handleComplete();
          }}
          onCancel={() => {
            setShowPortalConfirm(false);
            setPortalVerified(false);
          }}
        />
      )}
    </>
  );
}

// ── Rotating external-portal confirmation modal ──────────────
// Bigger, variant-styled, requires checkbox before confirm unlocks.
function ExternalPortalConfirmModal({
  variant,
  verified,
  onVerifiedChange,
  onConfirm,
  onCancel,
}: {
  variant: PortalVariant;
  verified: boolean;
  onVerifiedChange: (v: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Modal
      open
      onClose={onCancel}
      title={t(variant.titleKey)}
      size="max-w-lg"
      footer={
        <div className="flex gap-3 w-full">
          <button className="btn btn-secondary flex-1 py-3" onClick={onCancel}>
            {t('paymentModal.portalConfirmNo')}
          </button>
          <button
            className="btn flex-1 py-3 text-base font-bold transition-all"
            style={{
              background: verified ? variant.accent : 'rgba(100,100,100,0.25)',
              color: verified ? '#fff' : 'rgba(255,255,255,0.35)',
              border: `1px solid ${verified ? variant.accent : 'transparent'}`,
              cursor: verified ? 'pointer' : 'not-allowed',
            }}
            onClick={onConfirm}
            disabled={!verified}
          >
            {t('paymentModal.portalConfirmVerified')}
          </button>
        </div>
      }
    >
      <div className="space-y-5 py-1">
        {/* Variant accent block — icon + helper text */}
        <div
          className="text-center rounded-2xl py-7 px-5"
          style={{ background: variant.bg, border: `2px solid ${variant.borderColor}` }}
        >
          <div className="text-6xl mb-4 select-none">{variant.icon}</div>
          <p className="text-base font-medium text-slate-200 leading-relaxed">
            {t(variant.helperKey)}
          </p>
        </div>

        {/* Checkbox friction — must check before confirm unlocks */}
        <label
          className="flex items-start gap-3 cursor-pointer rounded-xl p-4 border-2 transition-all select-none"
          style={{
            borderColor: verified ? variant.accent : 'rgba(100,116,139,0.35)',
            background: verified ? `${variant.accent}18` : 'transparent',
          }}
        >
          <input
            type="checkbox"
            checked={verified}
            onChange={e => onVerifiedChange(e.target.checked)}
            className="mt-0.5 w-5 h-5 flex-shrink-0"
            style={{ accentColor: variant.accent }}
          />
          <span className="text-sm font-semibold text-slate-200 leading-snug">
            {t('paymentModal.portalCheckbox')}
          </span>
        </label>
      </div>
    </Modal>
  );
}
