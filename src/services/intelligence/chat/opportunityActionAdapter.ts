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
