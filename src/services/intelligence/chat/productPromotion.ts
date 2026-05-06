// ============================================================
// CellHub Intelligence — Product Promotion module
// R-INTELLIGENCE-PRODUCT-PROMOTION-MODULE-V1
//
// Pure refactor: extracted verbatim from handlers.ts. Owns:
//   - handleProductPush (chat dispatcher entry)
//   - runProductPush (single source-of-truth shared with the
//     InventoryModule "Promote" button — exported)
//   - handleProductOpportunities (operator-style briefing)
//
// Behavior is byte-for-byte identical to the prior in-handlers.ts
// implementation. No translations changed, no scoring changed,
// no action shapes changed, no engine signatures changed.
// ============================================================

import type { IntelligenceEngine } from '../IntelligenceEngine';
import type { IntentMatch } from './intentRouter';
import type { ActionQueueItem } from '../types';
import { enqueueOutreachActions } from '../actions';
import type { ChatResponse, ChatActionUI, Lang3 } from './handlers';
import { tChat, COP } from './handlers';

// ── Product push (R-INTEL-PRODUCT-PUSH-ENGINE) ─────────────
// Owner says "promote this product X" → router extracts X into
// match.extractedProduct → this handler ranks customers by spend +
// recency boost (≤30 days) + visit frequency, picks top 5, drafts a
// per-customer WhatsApp message and persists pending_approval queue
// items. Existing 24h dedup in actions.ts on (customerId, type=
// 'whatsapp') prevents over-queueing same customer in same 24h window.
export function handleProductPush(match: IntentMatch, engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  // R-INTEL-INVENTORY-PROMOTE-BUTTON: thin adapter — delegates to
  // runProductPush so non-chat callers (e.g. InventoryModule's Promote
  // button) can invoke the same ranking + queue logic without going
  // through the chat router.
  return runProductPush(engine, lang, (match.extractedProduct || '').trim());
}

// R-INTEL-INVENTORY-PROMOTE-BUTTON: exported single-source helper. Same
// scoring/eligibility/decision-tree as the chat handler — 1 implementation,
// 2 callsites (chat handler + InventoryModule Promote button).
export function runProductPush(engine: IntelligenceEngine, lang: Lang3, rawProductName: string): ChatResponse {
  const t = tChat(lang);
  const productName = (rawProductName || '').trim();
  if (!productName) {
    return { kind: 'answer', text: t('chat.productPush.noProduct') };
  }

  type Cand = {
    customerId: string;
    name: string;
    phone: string;
    grossRevenue: number;
    visitCount: number;
    daysSinceLastVisit: number;
    rankScore: number;
  };

  const now = Date.now();
  const scores = engine.getCustomerScores();
  const candidates: Cand[] = [];
  for (const cs of scores) {
    const h = engine.getCustomerHistory(cs.customerId);
    if (!h) continue;
    const phone = h.customer.phone || '';
    if (!phone) continue;                           // require contact channel
    if (h.visitCount < 1) continue;                 // require prior purchase
    if (!h.lastVisit) continue;
    const days = Math.max(0, Math.floor((now - h.lastVisit.getTime()) / 86400000));
    // Recency boost favors customers active within last 30 days.
    const recencyBoost = days <= 30 ? (30 - days) * 5 : 0;
    const rankScore = (h.grossRevenue / 100) + recencyBoost + h.visitCount * 10;
    candidates.push({
      customerId: cs.customerId,
      name: h.customer.name,
      phone,
      grossRevenue: h.grossRevenue,
      visitCount: h.visitCount,
      daysSinceLastVisit: days,
      rankScore,
    });
  }

  if (candidates.length === 0) {
    // R-INTELLIGENCE-COORDINATED-RESPONSES-V1: replace the hard dead-end
    // ("No eligible customers…") with an operator-style pivot. When direct
    // high-confidence customer matches are unavailable, point the owner at
    // the broader WhatsApp-campaign path that's already visible in the UI
    // (Promote Inventory panel → Generate Campaign button). Keeps the chat
    // response aligned with the visible action surfaces; no new buttons,
    // no new queue items, no new infrastructure.
    const lines = [
      t('chat.productPush.noDirectMatches', productName),
      '',
      t('chat.productPush.broaderCampaignSuggestion'),
      t('chat.productPush.fallbackPromotionAction'),
    ];
    // R-INTELLIGENCE-CONTEXT-MEMORY-V1: even when direct candidates are
    // empty, the owner is still "thinking about" this product — stamp
    // context so the next vague follow-up ("what about accessories?",
    // "discount it") routes back to the same entity.
    return {
      kind: 'answer',
      text: lines.join('\n'),
      establishesContext: { type: 'product', value: productName },
    };
  }

  const ranked = candidates.slice().sort((a, b) => b.rankScore - a.rankScore);
  const top = ranked.slice(0, 5);

  // R-INVENTORY-PRODUCT-PHOTOS-V1: detect whether any inventory item
  // matching the product name has a local photo. If so, the WhatsApp
  // message gets a mention sentence so the owner knows a real photo is
  // available to attach manually. No autonomous send, no auto-attach.
  const productLower = productName.toLowerCase();
  const hasPhoto = engine.getInventory().some(
    (i) => !!(i as { image?: string }).image && (i.name || '').toLowerCase().includes(productLower),
  );
  const composeMessage = (firstName: string): string => {
    const base = t('chat.productPush.message', firstName, productName);
    return hasPhoto ? `${base} ${t('chat.productPush.photoMention')}` : base;
  };

  // R-INTEL-PRODUCT-PUSH-DEDUP-FIX: distinct type from who_to_contact_today's
  // 'whatsapp' and marketing's 'marketing_whatsapp' so the 24h dedup in
  // actions.ts (keyed on customerId+type) does NOT collide. High-intent
  // single-product campaigns must always enqueue regardless of prior
  // outreach activity for the same customer.
  const queueItems: ActionQueueItem[] = top.map((c) => {
    const firstName = c.name.split(' ')[0] || c.name;
    return {
      id: `pp-${c.customerId}-${now}`,
      type: 'product_push_whatsapp',
      customerId: c.customerId,
      phone: c.phone,
      message: composeMessage(firstName),
      priority: 3000,                                // higher than marketing's max (2000)
      reason: t('chat.productPush.reason', productName),
      createdAt: now,
      status: 'pending_approval',
    };
  });
  try {
    enqueueOutreachActions(queueItems);
  } catch {
    // Queue persistence is best-effort.
  }

  // R-INTELLIGENCE-MANUAL-WHATSAPP-PRODUCT-PROMOTION-V1: surface inline
  // WhatsApp ChatActionUI buttons for the top 3 candidates so the owner
  // can launch the prepared message in one click. Reuses the EXISTING
  // executionTarget='whatsapp_url' path → wa.me deep link → owner manually
  // sends in WhatsApp Web/desktop. No autonomous send. The visible list
  // is trimmed to the same top-3 (matches button count); a remaining
  // count line summarizes the rest.
  const visible = top.slice(0, 3);
  const remainingVisible = Math.max(0, ranked.length - visible.length);

  const actions: ChatActionUI[] = [];
  for (const c of visible) {
    if (!c.phone) continue;
    const firstName = c.name.split(' ')[0] || c.name;
    actions.push({
      id: `pp-action-${c.customerId}-${now}`,
      label: t('chat.productPush.waActionLabel', firstName),
      actionType: 'whatsapp',
      payload: {
        type: 'whatsapp',
        customMessage: composeMessage(firstName),
        customerId: c.customerId,
        customerName: c.name,
        customerPhone: c.phone,
        executable: true,
        executionTarget: 'whatsapp_url',
      },
    });
  }

  // Format chat response.
  const lines = visible.map((c) => `• ${c.name} · ${c.phone} · ${COP(c.grossRevenue)} total`);
  const previewMessage = composeMessage('{customer}');
  const bodyParts: string[] = [
    t('chat.productPush.header', productName, visible.length),
    '',
    lines.join('\n'),
  ];
  if (remainingVisible > 0) {
    bodyParts.push('');
    bodyParts.push(t('chat.productPush.remaining', remainingVisible));
  }
  bodyParts.push('');
  bodyParts.push(`${t('chat.productPush.messagePreviewLabel')}: 💬 "${previewMessage}"`);

  return {
    kind: 'answer',
    text: bodyParts.join('\n'),
    actions: actions.length > 0 ? actions : undefined,
    // R-INTELLIGENCE-CONTEXT-MEMORY-V1: stamp the product so vague
    // follow-ups ("promote it", "what about accessories", "who else")
    // route back to this entity on the next turn.
    establishesContext: { type: 'product', value: productName },
  };
}

// ── Product opportunities (R-INTEL-2-PRODUCT) ───────────────
// R-INTELLIGENCE-OPERATOR-RESPONSES-V1: rewritten from a flat 8-bullet dump
// into operator-briefing form — best opportunity prominent, up to 2 secondary
// names, summary count for the rest. Same engine call, same actions; only the
// presentation changes. Pure deterministic — no scoring change, no AI.
export function handleProductOpportunities(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const oppsRaw = engine.getProductOpportunities();

  if (oppsRaw.length === 0) {
    return { kind: 'answer', text: t('chat.product.empty') };
  }

  // R-INTELLIGENCE-SIGNAL-QUALITY-V1: suppress weak opportunities. Only keep
  // entries with meaningful estimated impact (≥$10), or DEAD_STOCK (always
  // worth a clearance look), or strong margin (≥35%). Pure deterministic
  // gate — same engine call, same ranking, additive filter.
  const opps = oppsRaw.filter((o) =>
    o.impactCents >= 1000 ||
    o.type === 'DEAD_STOCK' ||
    o.marginPct >= 35,
  );
  if (opps.length === 0) {
    return { kind: 'answer', text: t('chat.product.weak') };
  }

  const REASON_KEY: Record<string, string> = {
    HIGH_MARGIN: 'chat.productOps.reason.highMargin',
    LOW_MARGIN:  'chat.productOps.reason.lowMargin',
    DEAD_STOCK:  'chat.productOps.reason.deadStock',
    HIGH_RETURN: 'chat.productOps.reason.highReturn',
  };
  const ACTION_KEY: Record<string, string> = {
    PROMOTE:  'chat.productOps.action.promote',
    DISCOUNT: 'chat.productOps.action.discount',
    BUNDLE:   'chat.productOps.action.bundle',
    REVIEW:   'chat.productOps.action.review',
  };

  const top = opps[0];
  const secondary = opps.slice(1, 3); // up to 2
  const remaining = Math.max(0, opps.length - (1 + secondary.length));

  const lines: string[] = [];
  lines.push(t('chat.productOps.bestHeader'));
  lines.push(top.name);
  lines.push('');
  lines.push(t('chat.productOps.whyLabel'));
  lines.push(t(REASON_KEY[top.type] || 'chat.productOps.reason.generic'));
  if (top.impactCents > 0) {
    lines.push('');
    lines.push(t('chat.productOps.upsideLabel'));
    lines.push(`~${COP(top.impactCents)}`);
  }
  lines.push('');
  lines.push(t('chat.productOps.actionLabel'));
  lines.push(t(ACTION_KEY[top.action] || 'chat.productOps.action.review'));

  if (secondary.length > 0) {
    lines.push('');
    lines.push(t('chat.productOps.alsoWatching'));
    for (const s of secondary) {
      lines.push(`• ${s.name}`);
    }
  }

  if (remaining > 0) {
    lines.push('');
    lines.push(t('chat.productOps.remaining', remaining));
  }

  // R-INTELLIGENCE-ACTION-BUTTONS-V1: attach a "Promote Product" button
  // that REPLAYS the chat through the existing product_push intent. No new
  // execution system; no autonomous send. The button reuses fireQuery →
  // classifyIntent → handleProductPush — same path the user already gets
  // when typing "promote {name}" manually.
  const promoteAction: ChatActionUI = {
    id: `promote-${top.name}-${Date.now()}`,
    label: t('chat.productOps.promoteAction', top.name),
    actionType: 'whatsapp',
    triggerQuery: `promote ${top.name}`,
    payload: {
      type: 'whatsapp',
      executable: true,
      executionTarget: 'none', // chat-replay; the executor branch is bypassed
    },
  };

  return { kind: 'answer', text: lines.join('\n'), actions: [promoteAction] };
}
