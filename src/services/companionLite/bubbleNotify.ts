// Companion Lite — Ephemeral notifications on the FloatingOperatorBubble.
//
// Uses the existing public bridge contract:
//   window.dispatchEvent(new CustomEvent('cellhub:operator-activity', { detail }))
// FloatingOperatorBubble already listens for this event and runs the
// detail through `computeHintFromEvent` (in @/services/operator), which
// has cases for our `companion_lite.message` / `approval.accepted` /
// `approval.denied` types. The bubble auto-dismisses the resulting
// hint after ~6s — that's the "ephemeral, no history" surface.
//
// Notes:
//   - We pass the short display label in payload.itemName because the
//     handler in operatorActivityHints reuses that string slot.
//   - This file does NOT import from src/services/companion (old
//     Companion) or the legacy event bus. The window CustomEvent is a
//     plain browser API.

import { OPERATOR_ACTIVITY_EVENT } from '@/services/operator/operatorActivityHints';

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
}

export function notifyApprovalDenied(label?: string): void {
  dispatch('approval.denied', label);
}

export function notifyCompanionLiteMessage(senderName: string): void {
  dispatch('companion_lite.message', senderName);
}
