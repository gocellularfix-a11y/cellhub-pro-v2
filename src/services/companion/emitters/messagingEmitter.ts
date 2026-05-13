// ============================================================
// CellHub Pro — Companion Messaging Emitter
// (R-COMPANION-MESSAGING-EMITTERS-V1)
//
// Shell-only helper functions. The desktop app has NO internal
// operational messaging system today (the "Messaging" Companion
// Center card is intentionally coming_soon). These helpers exist so
// the future messaging producer — whatever module ships first — can
// emit Companion events through a single typed entry point without
// importing the raw event bus or reasoning about envelope shape.
//
// Cero UI wiring. Cero producers in this round. Cero networking.
// Cero customer PII — phone numbers, names, message bodies past a
// short non-sensitive preview never enter the payload.
// ============================================================

import { emit } from '../companionEventBus';
import type { CompanionMessagePayload } from '../companionTypes';

export interface MessageEmitInput {
  messageId: string;
  /** Defaults are set per helper — sent emits outbound, received emits inbound. */
  direction?: 'outbound' | 'inbound';
  /** Transport class. 'internal' for in-app companion chat. */
  channel?: string;
  /** Desktop module name — 'pos', 'repairs', 'companion', etc. */
  source?: string;
  fromEmployeeId?: string;
  toEmployeeId?: string;
  senderRole?: 'owner' | 'manager' | 'technician' | 'sales' | 'cashier';
  /** Optional short preview. Caller is responsible for ensuring this
   *  is non-sensitive — never a customer name, phone, address, or
   *  any PII. Leave undefined when in doubt. */
  preview?: string;
}

/**
 * Emit a MESSAGE_SENT event. Use this from any future desktop
 * producer that creates an internal operational message destined
 * for an employee on the Companion mobile app.
 */
export function emitMessageSent(input: MessageEmitInput): void {
  emit({
    type: 'MESSAGE_SENT',
    category: 'messaging',
    payload: buildPayload({ ...input, direction: 'outbound' }),
    createdAt: Date.now(),
  });
}

/**
 * Emit a MESSAGE_RECEIVED event. Reserved for future inbound paths
 * (e.g. when a Companion mobile reply lands on the desktop side
 * through the bridge). No current producer.
 */
export function emitMessageReceived(input: MessageEmitInput): void {
  emit({
    type: 'MESSAGE_RECEIVED',
    category: 'messaging',
    payload: buildPayload({ ...input, direction: 'inbound' }),
    createdAt: Date.now(),
  });
}

// ── Internal ─────────────────────────────────────────────

function buildPayload(input: MessageEmitInput): CompanionMessagePayload {
  const out: CompanionMessagePayload = {
    messageId: input.messageId,
  };
  if (input.direction)      out.direction = input.direction;
  if (input.channel)        out.channel = input.channel;
  if (input.source)         out.source = input.source;
  if (input.fromEmployeeId) out.fromEmployeeId = input.fromEmployeeId;
  if (input.toEmployeeId)   out.toEmployeeId = input.toEmployeeId;
  if (input.senderRole)     out.senderRole = input.senderRole;
  if (input.preview)        out.preview = input.preview;
  return out;
}
