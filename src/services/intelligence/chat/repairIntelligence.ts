// ============================================================
// CellHub Intelligence — Repair Intelligence module
// R-INTELLIGENCE-EXECUTION-OUTPUTS-V1
//
// Handles repair_follow_up + repair_escalate intents.
// Pattern follows productPromotion.ts.
// ============================================================

import type { IntelligenceEngine } from '../IntelligenceEngine';
import type { IntentMatch } from './intentRouter';
import type { ChatResponse, ChatActionUI, Lang3 } from './handlers';
import { tChat } from './handlers';
import { isDoneRepairStatus } from '@/utils/repairStatus';
import { scoreRepairFollowUp, scoreRepairEscalate } from '../operatorQueue/priorityScoring';
// R-EOD-BRIEF F1: parseTimestampSafe extracted to shared util so EOD brief
// composer and future intelligence modules can reuse the same parsing contract.
// Origin context preserved: Repair.createdAt is Timestamp|Date|string; raw
// `new Date(obj as string)` yields NaN when the value is a Firebase Timestamp.
import { parseTimestampSafe } from '../utils/timestamps';

function findActiveRepairByName(engine: IntelligenceEngine, nameFragment: string) {
  const nameLower = nameFragment.toLowerCase();
  const active = engine.getRepairs().filter((r) => !isDoneRepairStatus(r.status));
  const exact = active.find((r) => r.customerName.toLowerCase() === nameLower);
  if (exact) return exact;
  return active.find((r) => {
    const rName = r.customerName.toLowerCase();
    return rName.includes(nameLower) || nameLower.includes(rName.split(' ')[0]);
  }) ?? null;
}

function oldestActiveRepair(engine: IntelligenceEngine) {
  const active = engine.getRepairs().filter((r) => !isDoneRepairStatus(r.status));
  if (active.length === 0) return null;
  return active.slice().sort((a, b) => {
    const ta = parseTimestampSafe(a.createdAt) ?? Number.MAX_SAFE_INTEGER;
    const tb = parseTimestampSafe(b.createdAt) ?? Number.MAX_SAFE_INTEGER;
    return ta - tb;
  })[0];
}

export function handleRepairFollowUp(
  match: IntentMatch,
  engine: IntelligenceEngine,
  lang: Lang3,
): ChatResponse {
  const t = tChat(lang);
  const now = Date.now();

  const repair = match.extractedName
    ? findActiveRepairByName(engine, match.extractedName)
    : oldestActiveRepair(engine);

  if (!repair) return { kind: 'answer', text: t('chat.repairFollowUp.noRepair') };

  const firstName = repair.customerName.split(' ')[0] || repair.customerName;
  const deviceLabel = repair.device || repair.issue || 'device';
  const createdMs = parseTimestampSafe(repair.createdAt);
  const days = createdMs !== null
    ? Math.max(0, Math.floor((now - createdMs) / 86400000))
    : 0;

  const message = t('chat.repairFollowUp.message', firstName, deviceLabel);

  const lines = [
    t('chat.repairFollowUp.header', repair.customerName, deviceLabel, String(days)),
    '',
    t('chat.repairFollowUp.messageDraft'),
    `> ${message}`,
  ];

  const actions: ChatActionUI[] = [
    {
      id: `rfu-copy-${repair.id}-${now}`,
      label: t('chat.actions.copyMessage'),
      payload: {
        type: 'whatsapp',
        customMessage: message,
        customerId: repair.customerId,
        customerName: repair.customerName,
        executable: true,
        executionTarget: 'copy_to_clipboard',
      },
    },
  ];

  if (repair.customerPhone) {
    actions.push({
      id: `rfu-wa-${repair.id}-${now}`,
      label: t('chat.actions.openWhatsApp', firstName),
      actionType: 'whatsapp',
      payload: {
        type: 'whatsapp',
        customMessage: message,
        customerId: repair.customerId,
        customerName: repair.customerName,
        customerPhone: repair.customerPhone,
        executable: true,
        executionTarget: 'whatsapp_url',
      },
    });
  }

  actions.push({
    id: `rfu-view-${repair.id}-${now}`,
    label: t('chat.actions.viewRepair'),
    payload: {
      type: 'whatsapp',
      entityId: repair.id,
      customerName: repair.customerName,
      executable: true,
      executionTarget: 'open_repair',
    },
  });

  actions.push({
    id: `rfu-queue-${repair.id}-${now}`,
    label: t('oq.addToQueue'),
    payload: {
      type: 'whatsapp',
      queueType: 'repair_follow_up',
      queueSummary: `${repair.customerName} — ${deviceLabel} · ${days}d`,
      customMessage: message,
      customerId: repair.customerId,
      customerName: repair.customerName,
      customerPhone: repair.customerPhone ?? undefined,
      entityId: repair.id,
      executable: true,
      executionTarget: 'add_to_operator_queue',
      priorityMeta: scoreRepairFollowUp({
        daysInRepair: days,
        repairValueCents: (repair as any).estimatedCost || (repair as any).price || 0,
      }),
    },
  });

  return {
    kind: 'answer',
    text: lines.join('\n'),
    actions,
    establishesContext: { type: 'repair', value: repair.customerName },
  };
}

export function handleRepairEscalate(
  match: IntentMatch,
  engine: IntelligenceEngine,
  lang: Lang3,
): ChatResponse {
  const t = tChat(lang);
  const now = Date.now();

  const repair = match.extractedName
    ? findActiveRepairByName(engine, match.extractedName)
    : oldestActiveRepair(engine);

  if (!repair) return { kind: 'answer', text: t('chat.repairEscalate.noRepair') };

  const firstName = repair.customerName.split(' ')[0] || repair.customerName;
  const deviceLabel = repair.device || repair.issue || 'device';
  const createdMs = parseTimestampSafe(repair.createdAt);
  const days = createdMs !== null
    ? Math.max(0, Math.floor((now - createdMs) / 86400000))
    : 0;

  const message = t('chat.repairEscalate.message', firstName, deviceLabel);

  const lines = [
    t('chat.repairEscalate.header', repair.customerName, deviceLabel, String(days), repair.status),
    '',
    t('chat.repairEscalate.messageDraft'),
    `> ${message}`,
  ];

  const actions: ChatActionUI[] = [
    {
      id: `re-copy-${repair.id}-${now}`,
      label: t('chat.actions.copyMessage'),
      payload: {
        type: 'whatsapp',
        customMessage: message,
        customerId: repair.customerId,
        customerName: repair.customerName,
        executable: true,
        executionTarget: 'copy_to_clipboard',
      },
    },
  ];

  if (repair.customerPhone) {
    actions.push({
      id: `re-wa-${repair.id}-${now}`,
      label: t('chat.actions.openWhatsApp', firstName),
      actionType: 'whatsapp',
      payload: {
        type: 'whatsapp',
        customMessage: message,
        customerId: repair.customerId,
        customerName: repair.customerName,
        customerPhone: repair.customerPhone,
        executable: true,
        executionTarget: 'whatsapp_url',
      },
    });
  }

  actions.push({
    id: `re-view-${repair.id}-${now}`,
    label: t('chat.actions.viewRepair'),
    payload: {
      type: 'whatsapp',
      entityId: repair.id,
      customerName: repair.customerName,
      executable: true,
      executionTarget: 'open_repair',
    },
  });

  actions.push({
    id: `re-queue-${repair.id}-${now}`,
    label: t('oq.addToQueue'),
    payload: {
      type: 'whatsapp',
      queueType: 'repair_escalate',
      queueSummary: `${repair.customerName} — ${deviceLabel} · ${days}d · ${repair.status}`,
      customMessage: message,
      customerId: repair.customerId,
      customerName: repair.customerName,
      customerPhone: repair.customerPhone ?? undefined,
      entityId: repair.id,
      executable: true,
      executionTarget: 'add_to_operator_queue',
      priorityMeta: scoreRepairEscalate({
        daysInRepair: days,
        repairValueCents: (repair as any).estimatedCost || (repair as any).price || 0,
      }),
    },
  });

  return {
    kind: 'answer',
    text: lines.join('\n'),
    actions,
    establishesContext: { type: 'repair', value: repair.customerName },
  };
}
