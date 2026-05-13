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
import type { ChatResponse, ChatActionUI, Lang3, PanelCampaignDraft } from './handlers';
import { tChat, COP } from './handlers';

// R-OPERATOR-EXECUTABLE-ACTIONS-V1: shared audience-viability check.
// Returns true as soon as ONE customer meets the basic outreach criteria
// (has phone, has ≥1 prior visit, has lastVisit). Mirrors the exact
// filter runProductPush uses, so handleProductOpportunities can decide
// the strategy BEFORE recommending — eliminating the contradictory
// "promote → no audience" dead-end. Pure read; no enqueue, no side effects.
function hasViablePromotionAudience(engine: IntelligenceEngine): boolean {
  const scores = engine.getCustomerScores();
  for (const cs of scores) {
    const h = engine.getCustomerHistory(cs.customerId);
    if (!h) continue;
    if (!h.customer.phone) continue;
    if (h.visitCount < 1) continue;
    if (!h.lastVisit) continue;
    return true;
  }
  return false;
}

// R-OPERATOR-EXECUTABLE-ACTIONS-V1: build the executable open_promote_panel
// action button. Uses real inventory id (no string matching). Returns null
// if the inventory item is missing — caller falls back to chat-replay.
// R-OPERATOR-PROMOTE-AUTO-PREPARE-V1: now stamps the recommended strategy +
// channel onto the payload. When audience exists we recommend targeted
// WhatsApp; without audience we recommend broad campaign (Status/Marketplace).
// The downstream consumer (IntelligenceModule.handleOpenPromote) auto-fires
// the chat campaign on click so the panel opens with the draft already
// generated below — no extra "Generate Campaign" click required.
function buildOpenPromoteAction(
  inventoryId: string,
  productName: string,
  label: string,
  audienceAvailable: boolean = false,
): ChatActionUI {
  return {
    id: `open-promote-${inventoryId}-${Date.now()}`,
    label,
    actionType: 'whatsapp', // any actionType works; executor branches on executionTarget
    payload: {
      type: 'promote_product',
      productId: inventoryId,
      productName,
      strategy: audienceAvailable ? 'targeted_whatsapp' : 'broad_campaign',
      recommendedChannel: audienceAvailable ? 'whatsapp' : 'whatsapp_status',
      executable: true,
      executionTarget: 'open_promote_panel',
    },
  };
}

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
    // R-OPERATOR-PROMOTE-RECIPIENT-REASON-V1: deterministic-only reason +
    // confidence derived from data already in scope (h.topItems for
    // bought-before; gross/visit/days for the rest). No AI, no random.
    reasonKey: string;
    reasonArg?: number | string;
    confidence: 'high' | 'medium' | 'low';
  };

  // R-OPERATOR-PROMOTE-RECIPIENT-REASON-V1: hoist productLower once for
  // the bought-before substring check inside the per-candidate loop.
  // Same lower-cased value is reused below for the existing hasPhoto check.
  const productLowerForReason = productName.toLowerCase();

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

    // R-OPERATOR-PROMOTE-RECIPIENT-REASON-V1: deterministic reason rules.
    // First match wins. Bought-before is the strongest signal (repeat
    // customer is the highest-value outreach target). Thresholds:
    //   - high value: $500+ gross revenue (50000 cents)
    //   - frequent: 5+ visits
    //   - recent: visit within last 7 days
    //   - active: 2+ visits within last 30 days
    // h.topItems is already O(5) and pre-computed by getCustomerHistory
    // (cached via R-INTEL-CUSTOMER-INDEX-V1) — bought-before lookup is
    // constant time per candidate.
    const boughtBefore = h.topItems.some((it) => {
      const itLower = (it.name || '').toLowerCase();
      if (!itLower) return false;
      return itLower.includes(productLowerForReason) || productLowerForReason.includes(itLower);
    });
    let reasonKey: string;
    let reasonArg: number | string | undefined;
    let confidence: 'high' | 'medium' | 'low';
    if (boughtBefore) {
      reasonKey = 'chat.productPush.reason.boughtBefore';
      confidence = 'high';
    } else if (h.grossRevenue >= 50000 && days <= 14) {
      reasonKey = 'chat.productPush.reason.topSpenderRecent';
      confidence = 'high';
    } else if (h.grossRevenue >= 50000) {
      reasonKey = 'chat.productPush.reason.highValue';
      confidence = 'medium';
    } else if (h.visitCount >= 5) {
      reasonKey = 'chat.productPush.reason.frequentVisitor';
      reasonArg = h.visitCount;
      confidence = 'medium';
    } else if (days <= 7) {
      reasonKey = 'chat.productPush.reason.recentCustomer';
      reasonArg = days;
      confidence = 'medium';
    } else if (h.visitCount >= 2 && days <= 30) {
      reasonKey = 'chat.productPush.reason.activeCustomer';
      confidence = 'low';
    } else {
      reasonKey = 'chat.productPush.reason.returningCustomer';
      confidence = 'low';
    }

    candidates.push({
      customerId: cs.customerId,
      name: h.customer.name,
      phone,
      grossRevenue: h.grossRevenue,
      visitCount: h.visitCount,
      daysSinceLastVisit: days,
      rankScore,
      reasonKey,
      reasonArg,
      confidence,
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
    // R-OPERATOR-EXECUTABLE-ACTIONS-V1: also attach an executable button
    // so the owner can jump directly into the Promote Inventory panel
    // with the product preselected. We need the real inventory id —
    // resolved via deterministic case-insensitive match against the
    // engine's inventory snapshot. If no match (e.g. user typed a name
    // that's not in inventory), we fall back to text-only response.
    const lines = [
      t('chat.productPush.noDirectMatches', productName),
      '',
      t('chat.productPush.broaderCampaignSuggestion'),
      t('chat.productPush.fallbackPromotionAction'),
    ];
    const productLowerForMatch = productName.toLowerCase();
    const matchedInv = engine.getInventory().find(
      (i) => (i.name || '').toLowerCase() === productLowerForMatch,
    ) ?? engine.getInventory().find(
      (i) => (i.name || '').toLowerCase().includes(productLowerForMatch),
    );
    // R-OPERATOR-PROMOTE-AUTO-PREPARE-V1: empty-candidates path → broad
    // campaign strategy (audience not viable for targeted outreach).
    const actions: ChatActionUI[] | undefined = matchedInv
      ? [buildOpenPromoteAction(
          matchedInv.id,
          matchedInv.name,
          t('chat.productOps.promoteAction', matchedInv.name),
          false,
        )]
      : undefined;
    // R-OPERATOR-PROMOTE-PANEL-PREVIEW-V1: emit a panel-side draft for
    // the broad-campaign case. Empty `candidates` signals broadcast mode;
    // the panel renders the editable template + a single "Open WhatsApp
    // draft" button (recipient picker). Template uses {customer} so the
    // panel can substitute first names if the user later adds recipients.
    const broadTemplateBase = t('chat.productPush.message', '{customer}', productName);
    const broadTemplate = String(broadTemplateBase || '').trim();
    const panelCampaign: PanelCampaignDraft | undefined = matchedInv && broadTemplate.length > 0
      ? {
          productId: matchedInv.id,
          productName: matchedInv.name,
          templateMessage: broadTemplate,
          candidates: [],
        }
      : undefined;
    // R-INTELLIGENCE-CONTEXT-MEMORY-V1: even when direct candidates are
    // empty, the owner is still "thinking about" this product — stamp
    // context so the next vague follow-up ("what about accessories?",
    // "discount it") routes back to the same entity.
    return {
      kind: 'answer',
      text: lines.join('\n'),
      actions,
      panelCampaign,
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

  // R-OPERATOR-PROMOTE-PANEL-PREVIEW-V1: emit panel-side draft. Resolve
  // the inventoryId by deterministic case-insensitive match against the
  // engine's inventory. previewMessage already contains {customer} as the
  // template (composeMessage('{customer}') above) — reused verbatim so the
  // panel textarea and chat-side preview line stay in sync. candidates
  // carry name + phone + customerId so the panel can build per-recipient
  // wa.me links via the canonical buildWhatsAppUrl helper.
  const inventoryMatch = engine.getInventory().find(
    (i) => (i.name || '').toLowerCase() === productLower,
  ) ?? engine.getInventory().find(
    (i) => (i.name || '').toLowerCase().includes(productLower),
  );
  // R-OPERATOR-PROMOTE-RECIPIENT-REASON-V1: forward the deterministic
  // reason + confidence + lastVisitDays so the panel widget can render
  // the WHY line + confidence badge under each row. lastVisitDays is just
  // a re-export of the Cand.daysSinceLastVisit value (same number, named
  // for the consumer's intent).
  const panelCampaign: PanelCampaignDraft | undefined = inventoryMatch
    ? {
        productId: inventoryMatch.id,
        productName: inventoryMatch.name,
        templateMessage: previewMessage,
        candidates: visible.map((c) => ({
          customerId: c.customerId,
          name: c.name,
          phone: c.phone,
          reasonKey: c.reasonKey,
          reasonArg: c.reasonArg,
          confidence: c.confidence,
          lastVisitDays: c.daysSinceLastVisit,
        })),
      }
    : undefined;

  return {
    kind: 'answer',
    text: bodyParts.join('\n'),
    actions: actions.length > 0 ? actions : undefined,
    panelCampaign,
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

  // R-OPERATOR-EXECUTABLE-ACTIONS-V1: audience-validation + executable
  // hand-off. The previous chat-replay shortcut (triggerQuery: 'promote
  // {name}') re-fired the same query through the chat pipeline, which
  // dead-ended in runProductPush when no eligible customers existed —
  // a contradictory flow ("promote this!" → "no audience"). Now we:
  //   1. Validate audience BEFORE attaching the action.
  //   2. Switch the response strategy when audience is empty (fallback
  //      strategies: in-store push, clearance, WhatsApp Status,
  //      Marketplace) instead of recommending direct outreach.
  //   3. Attach an open_promote_panel action carrying the REAL
  //      inventoryId so the click jumps straight into the Promote
  //      Inventory panel with the exact product preselected — no manual
  //      search, no string matching.
  const audienceAvailable = hasViablePromotionAudience(engine);
  if (!audienceAvailable) {
    lines.push('');
    lines.push(t('chat.productOps.audienceFallbackHeader'));
    lines.push(t('chat.productOps.audienceFallbackBody'));
  }

  // R-OPERATOR-PROMOTE-AUTO-PREPARE-V1: stamp strategy + channel based on
  // the audience-availability check we already ran above. Targeted when
  // direct outreach is viable, broad campaign otherwise.
  const promoteAction = buildOpenPromoteAction(
    top.inventoryId,
    top.name,
    t('chat.productOps.promoteAction', top.name),
    audienceAvailable,
  );

  return { kind: 'answer', text: lines.join('\n'), actions: [promoteAction] };
}
