// Companion Lite — Notifications to the FloatingOperatorBubble.
//
// Two surfaces are driven from here:
//   1. Ephemeral hint pill on the bubble (auto-dismiss ~6s).
//      Uses the bubble's public window CustomEvent contract.
//   2. Persistent badge dot+count on top of the bubble until clicked.
//      Pushes into ./pendingNotifications.
//
// Source matters: a manager message in the general thread should route
// the click to the Messages sub-tab; a thread message inside an approval
// or an approve/deny transition should route to Approvals.

import { OPERATOR_ACTIVITY_EVENT } from '@/services/operator/operatorActivityHints';
import { pushPending } from './pendingNotifications';

function dispatch(type: string, label?: string): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  try {
    window.dispatchEvent(new CustomEvent(OPERATOR_ACTIVITY_EVENT, {
      detail: { type, payload: label ? { itemName: label } : {} },
    }));
  } catch { /* best-effort — bubble notification is not load-bearing */ }
}

export function notifyApprovalAccepted(label?: string): void {
  dispatch('approval.accepted', label);
  pushPending('approvals');
}

export function notifyApprovalDenied(label?: string): void {
  dispatch('approval.denied', label);
  pushPending('approvals');
}

/** Manager wrote in the GENERAL message thread (Messages tab). */
export function notifyGeneralMessage(senderName: string): void {
  dispatch('companion_lite.message', senderName);
  pushPending('messages');
}

/** Manager wrote inside an approval-specific thread (Approvals tab). */
export function notifyApprovalMessage(senderName: string): void {
  dispatch('companion_lite.message', senderName);
  pushPending('approvals');
}
