// ============================================================
// CellHub Intelligence — External Payment Verification Nudge
// R-INTELLIGENCE-PAYMENT-VERIFY-V1
// R-BUBBLE-EXTERNAL-PAYMENT-REMINDER-NUDGE (additive: bubble-level mount,
//   2-min repeat pulse, t()-driven copy, dual-mount dedup guard).
//
// Small card rendered near the Floating Intelligence Bubble. Surfaces 2 min
// after a phone_payment / external-portal checkout to remind the cashier
// to confirm the carrier portal payment. Now mounted at AppShell level so
// it's visible even when the Intelligence panel is closed.
//
// CRITICAL: No sale data is modified. Human-only reminder. Confirmation
// just marks the reminder acknowledged in the existing localStorage
// reminder store — it does NOT mark the underlying sale as paid (the sale
// is already 'completed' from the moment POS posts it; the nudge only
// audits whether the cashier completed the external portal step).
// ============================================================

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  getDueVerification,
  confirmVerification,
  dismissVerification,
  rescheduleVerification,
  isAllowedVerificationSource,
  type PaymentVerification,
} from '@/services/intelligence/paymentVerification/paymentVerificationService';
import { formatCurrency } from '@/utils/currency';
import { useTranslation } from '@/i18n';

const POLL_INTERVAL_MS = 15_000;        // check storage every 15 seconds
const REPEAT_PULSE_MS  = 2 * 60 * 1000; // re-pulse every 2 minutes until confirmed
// R-PHONE-PAYMENT-REMINDER-BUBBLE-ANCHOR: read the same localStorage key the
// FloatingOperatorBubble writes on drag-end so the nudge can dock above /
// beside the bubble's actual position. If the user never dragged the bubble
// the key is empty → we fall back to the existing bottom-right anchor.
const BUBBLE_POSITION_KEY = 'cellhub:operatorBubble:position:v1';
const BUBBLE_SIZE_PX      = 110;
const NUDGE_WIDTH_PX      = 320;
const NUDGE_HEIGHT_EST_PX = 180;
const ANCHOR_GAP_PX       = 12;
const VIEWPORT_MARGIN_PX  = 16;

// ── Module-level dedup guard ───────────────────────────────
// AppShell mounts this nudge alongside the FloatingOperatorBubble so it's
// visible on every tab. IntelligenceModule still mounts a second instance
// for legacy reasons. To avoid two stacked cards, the first mount wins; the
// second mount renders null until the first unmounts.
let activeMountId: string | null = null;

interface Props {
  /**
   * Optional legacy prop kept for backward compat with the IntelligenceModule
   * call site. AppShell omits it and the component uses useTranslation()
   * locale instead.
   */
  lang?: 'en' | 'es' | 'pt';
}

export default function PaymentVerificationNudge(_props: Props) {
  void _props; // lang prop intentionally vestigial — t() reads locale from context
  const { t } = useTranslation();
  const [due, setDue] = useState<PaymentVerification | null>(null);
  // R-BUBBLE-EXTERNAL-PAYMENT-REMINDER-NUDGE: pulseTick re-keys the card so
  // the urgent flash animation restarts every REPEAT_PULSE_MS until the
  // cashier acts. Pure visual cue — no state mutation on the reminder.
  const [pulseTick, setPulseTick] = useState(0);
  // Stable id for the dedup guard — registered on mount, released on unmount.
  const mountIdRef = useRef<string>(`pv-mount-${Math.random().toString(36).slice(2, 10)}`);
  const [isActiveMount, setIsActiveMount] = useState(false);

  // R-PHONE-PAYMENT-REMINDER-BUBBLE-ANCHOR: position computed from the bubble's
  // last saved position; recomputed on each storage poll + on window resize.
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);
  const recomputeAnchor = useCallback(() => {
    if (typeof window === 'undefined') { setAnchor(null); return; }
    let bx: number | null = null;
    let by: number | null = null;
    try {
      const raw = localStorage.getItem(BUBBLE_POSITION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
          bx = parsed.x;
          by = parsed.y;
        }
      }
    } catch { /* corrupt JSON — fall back below */ }
    if (bx === null || by === null) { setAnchor(null); return; }
    // Default: card sits directly ABOVE the bubble, aligned to its left edge.
    let left = bx;
    let top  = by - NUDGE_HEIGHT_EST_PX - ANCHOR_GAP_PX;
    // If clipped at the top, drop the card BELOW the bubble instead.
    if (top < VIEWPORT_MARGIN_PX) {
      top = by + BUBBLE_SIZE_PX + ANCHOR_GAP_PX;
    }
    // Clamp horizontally inside the viewport.
    const maxLeft = Math.max(VIEWPORT_MARGIN_PX, window.innerWidth - NUDGE_WIDTH_PX - VIEWPORT_MARGIN_PX);
    left = Math.max(VIEWPORT_MARGIN_PX, Math.min(left, maxLeft));
    // Clamp vertically inside the viewport.
    const maxTop = Math.max(VIEWPORT_MARGIN_PX, window.innerHeight - NUDGE_HEIGHT_EST_PX - VIEWPORT_MARGIN_PX);
    top = Math.max(VIEWPORT_MARGIN_PX, Math.min(top, maxTop));
    setAnchor({ left, top });
  }, []);

  // Claim the active-mount slot (additive dedup with no refactor).
  useEffect(() => {
    if (activeMountId === null) {
      activeMountId = mountIdRef.current;
      setIsActiveMount(true);
    }
    const id = mountIdRef.current;
    return () => {
      if (activeMountId === id) {
        activeMountId = null;
      }
    };
  }, []);

  const checkDue = useCallback(() => {
    // R-EXTERNAL-PAYMENT-ONLY-NUDGE-GUARD: defensive display-time filter.
    // The service already enforces the allowlist, but re-checking here
    // guarantees that even if a future caller bypasses the service guard,
    // the UI still refuses to surface a non-external-portal reminder.
    const next = getDueVerification();
    if (next) {
      const src = (next.source ?? 'phone_payment') as string;
      if (!isAllowedVerificationSource(src)) {
        setDue(null);
        return;
      }
    }
    setDue(next);
  }, []);

  // Poll localStorage every 15s + listen for the checkout event.
  useEffect(() => {
    if (!isActiveMount) return;
    checkDue();
    recomputeAnchor();
    const interval = setInterval(() => { checkDue(); recomputeAnchor(); }, POLL_INTERVAL_MS);
    const onEvent = () => { checkDue(); recomputeAnchor(); };
    const onResize = () => recomputeAnchor();
    window.addEventListener('cellhub:payment-verify-nudge', onEvent);
    window.addEventListener('resize', onResize);
    return () => {
      clearInterval(interval);
      window.removeEventListener('cellhub:payment-verify-nudge', onEvent);
      window.removeEventListener('resize', onResize);
    };
  }, [checkDue, recomputeAnchor, isActiveMount]);

  // R-BUBBLE-EXTERNAL-PAYMENT-REMINDER-NUDGE: 2-minute repeat pulse — ticks
  // ONLY while a card is on-screen and ONLY for the active mount.
  useEffect(() => {
    if (!isActiveMount || !due) return;
    const t = setInterval(() => {
      setPulseTick((n) => n + 1);
    }, REPEAT_PULSE_MS);
    return () => clearInterval(t);
  }, [due, isActiveMount]);

  if (!isActiveMount || !due) return null;

  const handleConfirm = () => {
    // SAFETY: only marks the reminder acknowledged in the existing store.
    // The underlying sale is already 'completed' — we do NOT mutate sale state.
    confirmVerification(due.verificationId);
    setDue(null);
    try {
      // Surface a non-blocking confirmation breadcrumb for any global listener.
      window.dispatchEvent(new CustomEvent('cellhub:payment-verify-resolved', {
        detail: { verificationId: due.verificationId, saleId: due.saleId },
      }));
    } catch { /* env without CustomEvent */ }
  };

  const handleNotYet = () => {
    rescheduleVerification(due.verificationId);
    setDue(null);
  };

  const handleDismiss = () => {
    dismissVerification(due.verificationId);
    setDue(null);
  };

  const amountDisplay = formatCurrency(due.amountCents);
  const minutesAgo = Math.max(0, Math.round((Date.now() - due.createdAt) / 60_000));
  const stillWaiting = minutesAgo >= 4; // surface "still waiting" sublabel after at least one pulse

  return (
    <div
      key={`pv-${due.verificationId}-${pulseTick}`}
      style={{
        position: 'fixed',
        // R-PHONE-PAYMENT-REMINDER-BUBBLE-ANCHOR: dock above/below the bubble's
        // saved position when known; otherwise fall back to the historical
        // bottom-right anchor so behavior is unchanged for users who never
        // dragged the bubble.
        ...(anchor
          ? { left: anchor.left, top: anchor.top }
          : { bottom: 88, right: 24 }),
        zIndex: 9999,
        width: NUDGE_WIDTH_PX,
        maxWidth: 'calc(100vw - 32px)',
        background: '#1F2937',
        border: '1px solid #F59E0B',
        borderRadius: 12,
        boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
        padding: '14px 16px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        animation: 'cellhub-nudge-pulse 1.4s ease-out',
      }}
    >
      {/* Inline keyframes — additive, scoped via name so no global CSS edits. */}
      <style>{`
        @keyframes cellhub-nudge-pulse {
          0%   { box-shadow: 0 0 0 0 rgba(245,158,11,0.6); }
          70%  { box-shadow: 0 0 0 18px rgba(245,158,11,0); }
          100% { box-shadow: 0 4px 24px rgba(0,0,0,0.5); }
        }
      `}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 18 }}>📡</span>
        <span style={{ color: '#F59E0B', fontWeight: 700, fontSize: 13 }}>
          {t('paymentVerify.bubble.title')}
        </span>
      </div>

      {/* Body */}
      <p style={{ margin: 0, color: '#D1D5DB', fontSize: 12, lineHeight: 1.5 }}>
        {t('paymentVerify.bubble.body', due.carrier, due.customerName, amountDisplay)}
      </p>
      <div style={{ fontSize: 11, color: '#9CA3AF' }}>
        {t('paymentVerify.bubble.createdAgo', String(minutesAgo))}
      </div>
      {stillWaiting && (
        <div style={{ fontSize: 11, color: '#FCD34D', fontWeight: 600 }}>
          ⏳ {t('paymentVerify.bubble.stillWaiting')}
        </div>
      )}

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
            fontWeight: 700,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {t('paymentVerify.bubble.confirmBtn')}
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
          {t('paymentVerify.bubble.notYetBtn')}
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
          title={t('paymentVerify.bubble.dismissTitle')}
        >
          {t('paymentVerify.bubble.dismissBtn')}
        </button>
      </div>
    </div>
  );
}
