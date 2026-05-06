// ============================================================
// CellHub Intelligence — Conversation Runner module
// R-INTELLIGENCE-CONVERSATION-RUNNER-MODULE-V1
//
// Pure refactor: extracted verbatim from handlers.ts. Owns:
//   - reply classification (R-INTELLIGENCE-CONVERSATION-RUNNER-V1)
//   - product-cue detection + closing strategy + deal progression
//     (R-INTELLIGENCE-DEAL-CLOSER-V1)
//   - sales playbook resolution (R-INTELLIGENCE-SALES-PLAYBOOKS-V1)
//
// Pure deterministic — no AI, no agents, no autonomous messaging,
// no engine calls, no persistence. Runs only when handleIntent
// dispatches to handleConversationRunner.
// ============================================================

import type { IntentMatch } from './intentRouter';
import type { ChatResponse, Lang3 } from './handlers';
import { tChat } from './handlers';

// ── Reply category (R-INTELLIGENCE-CONVERSATION-RUNNER-V1) ────

// R-INTELLIGENCE-DEAL-PIPELINE-V1: exported so handlers.ts can map a
// classified reply to a DealStage transition. No behavior change.
export type ReplyCategory =
  | 'PRICE_NEGOTIATION'
  | 'PRICE_TOO_HIGH'
  | 'MAYBE_LATER'
  | 'READY_TO_BUY'
  | 'INTERESTED'
  | 'ASKING_LOCATION'
  | 'ASKING_PHOTOS'
  | 'HOLD_REQUEST'
  | 'UNKNOWN';

// Order matters — first match wins. MAYBE_LATER is placed before
// READY_TO_BUY so "i'll take it later" classifies as deferred, not closed.
const REPLY_PATTERNS: Array<{ regex: RegExp; category: ReplyCategory }> = [
  // PRICE_NEGOTIATION — owner is being asked for a better number.
  { regex: /\b(lowest|best price|can you do better|cheaper|negotiate|do better than|cu[aá]nto m[aá]s barato|m[aá]s barato|mejor precio|precio m[aá]s bajo|lo m[aá]s bajo|pode fazer melhor|mais barato|melhor pre[cç]o)\b/i, category: 'PRICE_NEGOTIATION' },
  // PRICE_TOO_HIGH — overt rejection of price.
  { regex: /\b(too expensive|too pricey|too much|overpriced|too high|out of (my )?budget|muy caro|demasiado caro|caro demais|muito caro)\b/i, category: 'PRICE_TOO_HIGH' },
  // MAYBE_LATER — defer / not now.
  { regex: /\b(maybe later|later|next week|next month|not now|tal vez (m[aá]s tarde|despu[eé]s)|m[aá]s tarde|despu[eé]s|talvez (mais tarde|depois)|mais tarde|depois)\b/i, category: 'MAYBE_LATER' },
  // READY_TO_BUY — clear close signal.
  { regex: /\b(i'?ll take it|i want it|i'?m in|sold|deal|me lo llevo|lo quiero|cerrado|cierra|fechado|fechou|vou levar|eu levo|levo)\b/i, category: 'READY_TO_BUY' },
  // INTERESTED — engaged, not closed yet.
  { regex: /\b(interested|sounds good|tell me more|yes please|interesado|interesada|me interesa|interessado|interessada|me interessa)\b/i, category: 'INTERESTED' },
  // ASKING_LOCATION
  { regex: /\b(where are you located|where are you|address|location|directions|how do i get there|d[oó]nde est[aá]n|d[oó]nde queda|direcci[oó]n|ubicaci[oó]n|onde fica|onde est[aã]o|endere[cç]o)\b/i, category: 'ASKING_LOCATION' },
  // ASKING_PHOTOS
  { regex: /\b(send pics|send photos|photos|pictures|m[aá]ndame fotos|env[ií]ame fotos|fotos por favor|manda fotos|envie fotos|me envia fotos)\b/i, category: 'ASKING_PHOTOS' },
  // HOLD_REQUEST — wants you to set it aside.
  { regex: /\b(can you hold|hold it|reserve it|set it aside|gu[aá]rdamelo|res[eé]rvalo|reservar|guardar|guarda pra mim|reserva pra mim|guarda para mim)\b/i, category: 'HOLD_REQUEST' },
];

// R-INTELLIGENCE-DEAL-PIPELINE-V1: exported so the proposal_followup
// handler can stage the deal pipeline based on the same classifier the
// conversation runner uses (single source of truth — no duplicate
// regex table). No behavior change.
export function classifyReply(query: string): ReplyCategory {
  const q = query.toLowerCase();
  for (const p of REPLY_PATTERNS) {
    if (p.regex.test(q)) return p.category;
  }
  return 'UNKNOWN';
}

// R-INTELLIGENCE-DEAL-CLOSER-V1: deterministic product-category detector
// for upsell guidance. Pure regex over the same query — no engine call,
// no inventory scan, no learning. Returns null when nothing recognizable.
type UpsellCategory = 'phone' | 'repair' | 'console';
function detectProductCategory(query: string): UpsellCategory | null {
  const q = query.toLowerCase();
  if (/\b(phone|iphone|samsung|galaxy|pixel|android|celular|tel[eé]fono|tel[eé]fone|smartphone)\b/i.test(q)) return 'phone';
  if (/\b(repair|screen|pantalla|tela|battery|bater[íi]a|fix|arreglo|conserto|reparo|reparaci[oó]n)\b/i.test(q)) return 'repair';
  if (/\b(console|ps5|ps4|xbox|nintendo|switch|gaming|consola|videogame|videogame)\b/i.test(q)) return 'console';
  return null;
}

// Categories that warrant a closing-strategy line (active sales motion).
const CLOSING_STRATEGY_CATEGORIES: ReplyCategory[] = [
  'PRICE_NEGOTIATION', 'READY_TO_BUY', 'INTERESTED', 'HOLD_REQUEST',
];

// R-INTELLIGENCE-SALES-PLAYBOOKS-V1: deterministic retail-coaching layer.
// Maps (reply category × product cue × keyword signals) → ONE playbook id.
// Pure function; no engine call, no learning, no model. Returns null when
// no playbook fits — section is then skipped from the response.
type PlaybookId =
  | 'UPGRADE_CLOSE'
  | 'ACCESSORY_ATTACH'
  | 'SAME_DAY_URGENCY'
  | 'REPAIR_RECOVERY'
  | 'FINANCING_PUSH'
  | 'TRADE_IN_POSITIONING'
  | 'DEPOSIT_COMMITMENT';

function resolvePlaybook(
  category: ReplyCategory,
  upsellCategory: UpsellCategory | null,
  query: string,
): PlaybookId | null {
  const q = query.toLowerCase();

  // Trade-in signal — strongest, wins regardless of category/product cue.
  if (/\btrade.?in|cambio de equipo|intercambio|troca|trocar\b/i.test(q)) {
    return 'TRADE_IN_POSITIONING';
  }
  // Hold request → deposit commitment regardless of product.
  if (category === 'HOLD_REQUEST') return 'DEPOSIT_COMMITMENT';
  // Repair context wins next — most repair conversations want urgency
  // around device downtime, not pricing motion.
  if (upsellCategory === 'repair') return 'REPAIR_RECOVERY';
  // Phone-specific cascades.
  if (upsellCategory === 'phone') {
    if (category === 'PRICE_NEGOTIATION') return 'SAME_DAY_URGENCY';
    if (category === 'READY_TO_BUY') return 'ACCESSORY_ATTACH';
    if (category === 'INTERESTED') return 'FINANCING_PUSH';
  }
  // Console close-of-sale → accessory attach (controllers / games).
  if (upsellCategory === 'console' && category === 'READY_TO_BUY') {
    return 'ACCESSORY_ATTACH';
  }
  // INTERESTED with no product cue — generic upgrade-close coaching.
  if (category === 'INTERESTED') return 'UPGRADE_CLOSE';
  return null;
}

export function handleConversationRunner(match: IntentMatch, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const rawQuery = (match.query || '').trim();

  // Empty or no query — nudge with help text.
  if (!rawQuery) {
    return { kind: 'help', text: t('chat.conversation.empty') };
  }

  const category = classifyReply(rawQuery);
  // R-INTELLIGENCE-DEAL-CLOSER-V1: detect product cue from the same query
  // text so an optional upsell line can attach. No engine call, no
  // inventory mutation, no auto-bundling.
  const upsellCategory = detectProductCategory(rawQuery);
  // R-INTELLIGENCE-SALES-PLAYBOOKS-V1: deterministic playbook resolver
  // off the same inputs. Adds operator coaching, not automation.
  const playbook = resolvePlaybook(category, upsellCategory, rawQuery);

  const lines: string[] = [];
  lines.push(t('chat.conversation.header'));
  lines.push('');

  // 1. Customer intent (always)
  lines.push(t('chat.conversation.intentLabel'));
  lines.push(t(`chat.conversation.category.${category}`));
  lines.push('');

  // 2. Recommended move (always)
  lines.push(t('chat.conversation.moveLabel'));
  lines.push(t(`chat.conversation.move.${category}`));

  // 3. Closing strategy (only for active-sales categories) — R-INTELLIGENCE-DEAL-CLOSER-V1
  if (CLOSING_STRATEGY_CATEGORIES.includes(category)) {
    lines.push('');
    lines.push(t('chat.conversation.strategyLabel'));
    lines.push(t(`chat.conversation.strategy.${category}`));
  }

  // 4. Sales playbook (only when resolver returns a hit) — R-INTELLIGENCE-SALES-PLAYBOOKS-V1
  if (playbook) {
    lines.push('');
    lines.push(t('chat.conversation.playbookLabel'));
    lines.push(t(`chat.conversation.playbook.${playbook}`));
  }

  // 5. Suggested reply (always)
  lines.push('');
  lines.push(t('chat.conversation.replyLabel'));
  lines.push(`"${t(`chat.conversation.reply.${category}`)}"`);

  // 6. Optional upsell (only when a product cue exists AND the lead is
  // still active — skip for MAYBE_LATER / UNKNOWN). R-INTELLIGENCE-DEAL-CLOSER-V1
  if (upsellCategory && category !== 'MAYBE_LATER' && category !== 'UNKNOWN') {
    lines.push('');
    lines.push(t('chat.conversation.upsellLabel'));
    lines.push(t(`chat.conversation.upsell.${upsellCategory}`));
  }

  // 7. Optional deal progression — replaces the prior single-line dealHint
  // with the structured section per R-INTELLIGENCE-DEAL-CLOSER-V1 spec.
  // Reuses the existing Pending Deal text path; no new flow.
  if (category === 'READY_TO_BUY' || category === 'INTERESTED') {
    lines.push('');
    lines.push(t('chat.conversation.progressionLabel'));
    lines.push(t(`chat.conversation.progression.${category}`));
  }

  return { kind: 'answer', text: lines.join('\n') };
}
