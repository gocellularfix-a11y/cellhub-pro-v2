// ============================================================
// CellHub Intelligence — Customer Outreach module
// R-INTELLIGENCE-EXECUTION-OUTPUTS-V1
//
// Handles recover_customer + vip_outreach intents.
// Pattern follows productPromotion.ts.
// ============================================================

import type { IntelligenceEngine } from '../IntelligenceEngine';
import type { IntentMatch } from './intentRouter';
import type { ChatResponse, ChatActionUI, Lang3 } from './handlers';
import { tChat, COP } from './handlers';
import { scoreRecoverCustomer, scoreVipOutreach } from '../operatorQueue/priorityScoring';

export function handleRecoverCustomer(
  match: IntentMatch,
  engine: IntelligenceEngine,
  lang: Lang3,
): ChatResponse {
  const t = tChat(lang);
  const now = Date.now();

  // Prefer matched customer from name extraction; fall back to most inactive high-value
  let customerId = match.matchedCustomer?.id ?? null;
  if (!customerId) {
    const scores = engine.getCustomerScores();
    let best: { id: string; rankScore: number } | null = null;
    for (const cs of scores) {
      const h = engine.getCustomerHistory(cs.customerId);
      if (!h || !h.lastVisit || !h.customer.phone) continue;
      const days = Math.max(0, Math.floor((now - h.lastVisit.getTime()) / 86400000));
      if (days < 30) continue;
      const rankScore = h.grossRevenue + days * 100;
      if (!best || rankScore > best.rankScore) best = { id: cs.customerId, rankScore };
    }
    customerId = best?.id ?? null;
  }

  const h = customerId ? engine.getCustomerHistory(customerId) : null;
  if (!h) return { kind: 'answer', text: t('chat.recoverCustomer.noCustomer') };

  const customer = h.customer;
  const firstName = customer.name.split(' ')[0] || customer.name;
  const days = h.lastVisit
    ? Math.max(0, Math.floor((now - h.lastVisit.getTime()) / 86400000))
    : 0;

  const message = t('chat.recoverCustomer.message', firstName);

  const lines = [
    t('chat.recoverCustomer.header', customer.name, String(days), COP(h.grossRevenue)),
    '',
    t('chat.recoverCustomer.messageDraft'),
    `> ${message}`,
  ];

  const actions: ChatActionUI[] = [
    {
      id: `rc-copy-${customerId}-${now}`,
      label: t('chat.actions.copyMessage'),
      payload: {
        type: 'whatsapp',
        customMessage: message,
        customerId: customerId ?? undefined,
        customerName: customer.name,
        executable: true,
        executionTarget: 'copy_to_clipboard',
      },
    },
  ];

  if (customer.phone) {
    actions.push({
      id: `rc-wa-${customerId}-${now}`,
      label: t('chat.actions.openWhatsApp', firstName),
      actionType: 'whatsapp',
      payload: {
        type: 'whatsapp',
        customMessage: message,
        customerId: customerId ?? undefined,
        customerName: customer.name,
        customerPhone: customer.phone,
        executable: true,
        executionTarget: 'whatsapp_url',
      },
    });
  }

  actions.push({
    id: `rc-view-${customerId}-${now}`,
    label: t('chat.actions.viewCustomer'),
    payload: {
      type: 'whatsapp',
      entityId: customerId ?? undefined,
      customerName: customer.name,
      executable: true,
      executionTarget: 'open_customer',
    },
  });

  actions.push({
    id: `rc-queue-${customerId}-${now}`,
    label: t('oq.addToQueue'),
    payload: {
      type: 'whatsapp',
      queueType: 'recover_customer',
      queueSummary: `${customer.name} — ${days}d inactive · ${COP(h.grossRevenue)} spend`,
      customMessage: message,
      customerId: customerId ?? undefined,
      customerName: customer.name,
      customerPhone: customer.phone ?? undefined,
      entityId: customerId ?? undefined,
      executable: true,
      executionTarget: 'add_to_operator_queue',
      priorityMeta: scoreRecoverCustomer({
        daysInactive: days,
        grossRevenueCents: h.grossRevenue,
        visitCount: h.visitCount,
      }),
    },
  });

  return {
    kind: 'answer',
    text: lines.join('\n'),
    actions,
    establishesContext: { type: 'customer', value: customer.name },
  };
}

export function handleVipOutreach(
  match: IntentMatch,
  engine: IntelligenceEngine,
  lang: Lang3,
): ChatResponse {
  const t = tChat(lang);
  const now = Date.now();

  let customerId = match.matchedCustomer?.id ?? null;
  if (!customerId) {
    const scores = engine.getCustomerScores();
    const top = scores.slice().sort((a, b) => b.score - a.score)[0];
    customerId = top?.customerId ?? null;
  }

  const h = customerId ? engine.getCustomerHistory(customerId) : null;
  if (!h) return { kind: 'answer', text: t('chat.vipOutreach.noCustomer') };

  const customer = h.customer;
  const firstName = customer.name.split(' ')[0] || customer.name;
  const daysSinceLastVisit = h.lastVisit
    ? Math.max(0, Math.floor((now - h.lastVisit.getTime()) / 86400000))
    : 999;
  const message = t('chat.vipOutreach.message', firstName);

  const lines = [
    t('chat.vipOutreach.header', customer.name, String(h.visitCount), COP(h.grossRevenue)),
    '',
    t('chat.vipOutreach.messageDraft'),
    `> ${message}`,
  ];

  const actions: ChatActionUI[] = [
    {
      id: `vo-copy-${customerId}-${now}`,
      label: t('chat.actions.copyMessage'),
      payload: {
        type: 'whatsapp',
        customMessage: message,
        customerId: customerId ?? undefined,
        customerName: customer.name,
        executable: true,
        executionTarget: 'copy_to_clipboard',
      },
    },
  ];

  if (customer.phone) {
    actions.push({
      id: `vo-wa-${customerId}-${now}`,
      label: t('chat.actions.openWhatsApp', firstName),
      actionType: 'whatsapp',
      payload: {
        type: 'whatsapp',
        customMessage: message,
        customerId: customerId ?? undefined,
        customerName: customer.name,
        customerPhone: customer.phone,
        executable: true,
        executionTarget: 'whatsapp_url',
      },
    });
  }

  actions.push({
    id: `vo-view-${customerId}-${now}`,
    label: t('chat.actions.viewCustomer'),
    payload: {
      type: 'whatsapp',
      entityId: customerId ?? undefined,
      customerName: customer.name,
      executable: true,
      executionTarget: 'open_customer',
    },
  });

  actions.push({
    id: `vo-queue-${customerId}-${now}`,
    label: t('oq.addToQueue'),
    payload: {
      type: 'whatsapp',
      queueType: 'vip_outreach',
      queueSummary: `${customer.name} — ${h.visitCount} visits · ${COP(h.grossRevenue)} spend`,
      customMessage: message,
      customerId: customerId ?? undefined,
      customerName: customer.name,
      customerPhone: customer.phone ?? undefined,
      entityId: customerId ?? undefined,
      executable: true,
      executionTarget: 'add_to_operator_queue',
      priorityMeta: scoreVipOutreach({
        grossRevenueCents: h.grossRevenue,
        visitCount: h.visitCount,
        daysSinceLastVisit,
      }),
    },
  });

  return {
    kind: 'answer',
    text: lines.join('\n'),
    actions,
    establishesContext: { type: 'customer', value: customer.name },
  };
}
