// R-INTELLIGENCE-EXECUTABLE-ACTIONS-V1
// Converts ExecutableOpportunityAction[] → ChatActionUI[] for Intelligence chat responses.
// Mirrors the productPromotion.ts pattern: imports from handlers.ts without
// circular-import issues because all imports are functions (not class instances).

import type { ExecutableOpportunityAction } from '../moduleWideOpportunities/moduleWideOpportunityTypes';
import type { ChatActionUI, Lang3 } from './handlers';
import { tChat } from './handlers';
import type { ActionPayload } from '../actions/actionEngine';

export function buildChatActionsFromOpportunity(
  actions: ExecutableOpportunityAction[],
  oppId: string,
  lang: Lang3,
): ChatActionUI[] {
  const t = tChat(lang);
  const result: ChatActionUI[] = [];
  let idx = 0;

  for (const act of actions) {
    idx++;
    const id = `mwo-${oppId}-${act.actionType}-${idx}`;
    const label = t(act.labelKey);
    let payload: ActionPayload;

    switch (act.actionType) {
      case 'whatsapp_followup':
        payload = {
          type: 'whatsapp',
          customerId: act.customerId,
          customerName: act.customerName,
          customerPhone: act.customerPhone,
          customMessage: act.customMessage ?? `Hi ${act.customerName ?? 'there'}, Go Cellular wanted to follow up with you.`,
          executable: Boolean(act.customerPhone || act.customerId),
          executionTarget: 'whatsapp_url',
        };
        break;
      case 'open_repair':
        payload = {
          type: 'review',
          entityId: act.entityId,
          executable: Boolean(act.entityId),
          executionTarget: 'open_repair',
        };
        break;
      case 'open_customer':
        payload = {
          type: 'review',
          entityId: act.entityId,
          executable: Boolean(act.entityId),
          executionTarget: 'open_customer',
        };
        break;
      case 'open_layaway':
        payload = {
          type: 'review',
          entityId: act.entityId,
          executable: Boolean(act.entityId),
          executionTarget: 'open_layaway',
        };
        break;
      case 'open_inventory':
        payload = {
          type: 'review',
          entityId: act.entityId,
          executable: Boolean(act.entityId),
          executionTarget: 'open_inventory',
        };
        break;
      case 'queue_manager_review':
        payload = {
          type: 'review',
          executable: true,
          executionTarget: 'queue_manager_review',
        };
        break;
      case 'callback_reminder':
        payload = {
          type: 'reminder',
          customerId: act.customerId,
          customerName: act.customerName,
          executable: Boolean(act.customerId || act.customerName),
          executionTarget: 'reminder_queue',
        };
        break;
      default:
        continue;
    }

    result.push({ id, label, payload });
  }

  return result;
}

// R-INTELLIGENCE-ACTION-UX-STABILITY-V1
// Deduplication key per action. Prevents showing the same WhatsApp send to the
// same phone number twice when multiple opportunities reference the same customer,
// and prevents duplicate open-repair/open-customer buttons across opps.
function dedupeKey(action: ChatActionUI): string {
  const t = action.payload.executionTarget;
  switch (t) {
    case 'whatsapp_url':
      return `whatsapp:${action.payload.customerPhone ?? action.payload.customerId ?? ''}`;
    case 'open_repair':
    case 'open_customer':
    case 'open_layaway':
    case 'open_inventory':
      return `${t}:${action.payload.entityId ?? ''}`;
    case 'reminder_queue':
      return `reminder:${action.payload.customerId ?? action.payload.customerName ?? ''}`;
    case 'queue_manager_review':
      return 'queue_manager_review';
    default:
      return `${t}:${action.id}`;
  }
}

// Dedupe + hard-cap. Higher-severity opps are processed first (mwoOpps already
// sorts DESC by severity), so first-seen wins — which is the highest-severity instance.
// WhatsApp stays before open/* because detectors push them in that order per opp.
export function dedupeAndLimitActions(actions: ChatActionUI[], max = 6): ChatActionUI[] {
  const seen = new Set<string>();
  const result: ChatActionUI[] = [];
  for (const action of actions) {
    if (result.length >= max) break;
    const key = dedupeKey(action);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(action);
  }
  return result;
}
