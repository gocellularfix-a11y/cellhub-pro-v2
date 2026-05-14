// ============================================================
// CellHub Pro — Live Context Engine (R-INTELLIGENCE-LIVE-CONTEXT-V1)
// Bridges the window event bus → liveContextStore.
// Idempotent: safe to call initLiveContextEngine() multiple times.
// ============================================================

import type { AppState } from '@/store/types';
import { addAction, updateContext, getContext } from './liveContextStore';
import type { LiveAction, LiveCartMeta } from './contextTypes';
import {
  OPERATOR_ACTIVITY_EVENT,
  type OperatorActivityEventDetail,
} from '@/services/operator/operatorActivityHints';

let _initialized = false;

// Maps window event types to LiveActionType values
const ACTION_TYPE_MAP: Record<string, LiveAction['type']> = {
  'layaway.opened':                          'layaway_opened',
  'repair.opened':                           'repair_opened',
  'customer.history_opened':                 'customer_history_opened',
  'phone.payment.customer_selected':         'customer_selected',
  'phone.payment.known_line_selected':       'phone_number_entered',
  'phone.payment.number_entered':            'phone_number_entered',
  'phone.payment.customer_created':          'customer_selected',
  'phone.payment.customer_updated':          'customer_selected',
  'phone.payment.payment_recorded':          'payment_started',
  'phone.payment.number_linked_to_customer': 'customer_selected',
  'sale.completed':                          'sale_completed',
  'unlock.submitted':                        'unlock_submitted',
  'special_order.created':                   'special_order_created',
  'return.processed':                        'return_processed',
  'appointment.booked':                      'appointment_booked',
};

/** Call once from the bubble's mount useEffect. Safe to call multiple times. */
export function initLiveContextEngine(): void {
  if (_initialized) return;
  _initialized = true;

  const onActivity = (e: Event) => {
    const detail = (e as CustomEvent<OperatorActivityEventDetail>).detail;
    if (!detail?.type) return;

    const liveType: LiveAction['type'] = ACTION_TYPE_MAP[detail.type] ?? detail.type;
    const payload = detail.payload || {};

    const metadata: Record<string, string | number | boolean> = {};
    if (payload.customerId) metadata.customerId = payload.customerId;
    if (payload.phone) metadata.phone = payload.phone;
    if (payload.repairId) metadata.repairId = payload.repairId;
    if (payload.layawayId) metadata.layawayId = payload.layawayId;
    if (typeof payload.amountCents === 'number') metadata.amountCents = payload.amountCents;
    if (typeof payload.lineCount === 'number') metadata.lineCount = payload.lineCount;

    addAction({
      timestamp: Date.now(),
      type: liveType,
      module: getContext().activeModule,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    });
  };

  window.addEventListener(OPERATOR_ACTIVITY_EVENT, onActivity as EventListener);
}

type SyncInputs = Pick<
  AppState,
  'activeTab' | 'currentEmployee' | 'cart' | 'customers' | 'pendingPhonePaymentCustomerId' | 'pendingPosCustomer'
>;

/**
 * Sync module-level AppState into the live context store.
 * Called from the bubble's useEffect when relevant state changes.
 * Structural flags only — no financial totals.
 */
export function syncFromAppState(state: SyncInputs): void {
  const {
    activeTab,
    currentEmployee,
    cart,
    customers,
    pendingPhonePaymentCustomerId,
    pendingPosCustomer,
  } = state;

  // Cart — structural flags, no amounts
  const cartMeta: LiveCartMeta | null = Array.isArray(cart) && cart.length > 0
    ? {
        itemCount: cart.length,
        hasRepairItems: cart.some((i) => i.category === 'service' || !!i.repairId),
        hasPhonePayments: cart.some((i) => i.category === 'phone_payment'),
        hasAccessories: cart.some((i) => i.category === 'accessory'),
      }
    : null;

  // Resolve active customer: phone-payment flow wins over POS flow
  let activeCustomer = getContext().activeCustomer;
  const resolveId = pendingPhonePaymentCustomerId || pendingPosCustomer;
  if (resolveId && Array.isArray(customers)) {
    const found = customers.find((c) => c && c.id === resolveId);
    if (found) {
      const fn = (found.firstName || '').trim();
      const ln = (found.lastName || '').trim();
      activeCustomer = {
        id: found.id,
        name: fn || ln ? `${fn} ${ln}`.trim() : (found.name || ''),
        phone: found.phone || undefined,
        lastInteractionAt: activeCustomer?.id === found.id
          ? (activeCustomer.lastInteractionAt ?? Date.now())
          : Date.now(),
      };
    } else {
      // Customer id gone — clear
      activeCustomer = null;
    }
  } else if (!resolveId) {
    // No pending customer — preserve whatever event-driven context set
    // (don't clobber a customer set by repair.opened / customer.history_opened)
  }

  updateContext({
    activeModule: activeTab || 'pos',
    cart: cartMeta,
    activeCustomer,
    activeEmployeeId: currentEmployee?.id ?? null,
    activeEmployeeName: currentEmployee?.name ?? null,
  });
}
