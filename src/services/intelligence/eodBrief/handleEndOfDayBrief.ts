// ============================================================
// CellHub Intelligence — End-of-Day Brief Chat Handler
// R-EOD-BRIEF F2
//
// Wires composeEODBrief() into the chat intent surface. Produces a
// ChatResponse with text + actions sourced from the structured
// EODBriefResult shape. Strings come from i18n (chat.eodBrief.*) so
// EN/ES/PT all share one composition pipeline.
//
// Phase 2 scope:
//   - Money section: skipped when confidence='placeholder' beyond a
//     single "{count} sales today — detailed numbers coming soon"
//     line. Promotion to full money rendering is gated behind the
//     R-REPORTS-MONEY-EXTRACT round.
//   - Open items: each non-empty section gets a header + bullet list.
//   - Actions: top-1-each for repair / layaway / external payment,
//     capped at 5 total, deduped by target+entityId.
// ============================================================

import type { IntelligenceEngine } from '../IntelligenceEngine';
import { tChat, COP, type ChatResponse, type ChatActionUI, type Lang3 } from '../chat/handlers';
import { composeEODBrief } from './eodBriefComposer';

const LOCALE_BY_LANG: Record<Lang3, string> = {
  en: 'en-US',
  es: 'es-MX',
  pt: 'pt-BR',
};

function formatBriefDate(nowMs: number, lang: Lang3): string {
  return new Date(nowMs).toLocaleDateString(LOCALE_BY_LANG[lang], {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

export function handleEndOfDayBrief(
  engine: IntelligenceEngine,
  lang: Lang3,
  nowMs?: number,
): ChatResponse {
  const t = tChat(lang);
  const brief = composeEODBrief(engine, lang, nowMs);
  const { money, openItems } = brief;

  const dateStr = formatBriefDate(brief.generatedAtMs, lang);

  const lines: string[] = [];
  lines.push(`**🌙 ${t('chat.eodBrief.header')}**`);
  lines.push(t('chat.eodBrief.headerDate', dateStr));
  lines.push('');

  // ── Money section (placeholder-aware) ────────────────────
  // Phase 2 renders a single transparency line when confidence is
  // 'placeholder'. Once money math is extracted, this branch will
  // expand to revenue / profit / tender breakdown rendering.
  if (money.confidence === 'placeholder') {
    lines.push(t('chat.eodBrief.moneyPending', money.saleCount));
    lines.push('');
  }

  // ── Open items ────────────────────────────────────────────
  const {
    repairsPendingTomorrow,
    layawaysDueThisWeek,
    externalPaymentsPending,
    storeCreditExpiringSoon,
  } = openItems;

  const allClear =
    repairsPendingTomorrow.length === 0 &&
    layawaysDueThisWeek.length === 0 &&
    externalPaymentsPending.length === 0 &&
    storeCreditExpiringSoon.length === 0;

  if (allClear) {
    lines.push(t('chat.eodBrief.allClear'));
  } else {
    if (repairsPendingTomorrow.length > 0) {
      lines.push(t('chat.eodBrief.repairsHeader', repairsPendingTomorrow.length));
      for (const r of repairsPendingTomorrow) {
        const device = r.device || '—';
        const name   = r.customerName || '—';
        lines.push(`  • ${device} — ${name} — ${r.daysOpen}d`);
      }
      lines.push('');
    }

    if (layawaysDueThisWeek.length > 0) {
      lines.push(t('chat.eodBrief.layawaysHeader', layawaysDueThisWeek.length));
      for (const l of layawaysDueThisWeek) {
        const name = l.customerName || '—';
        lines.push(`  • ${name} — ${COP(l.balanceCents)} — ${l.daysUntilDue}d`);
      }
      lines.push('');
    }

    if (externalPaymentsPending.length > 0) {
      lines.push(t('chat.eodBrief.externalHeader'));
      for (const e of externalPaymentsPending) {
        const name = e.customerName || '—';
        const carrier = e.carrier || '—';
        lines.push(`  • ${name} — ${COP(e.amountCents)} — ${carrier}`);
      }
      lines.push('');
    }

    if (storeCreditExpiringSoon.length > 0) {
      lines.push(t('chat.eodBrief.creditExpiryHeader', storeCreditExpiringSoon.length));
      for (const c of storeCreditExpiringSoon) {
        const name = c.customerName || '—';
        lines.push(`  • ${name} — ${COP(c.balanceCents)} — ${c.daysUntilExpiry}d`);
      }
      lines.push('');
    }
  }

  // Trim trailing blank line if present.
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  // ── Actions ───────────────────────────────────────────────
  const actions: ChatActionUI[] = [];
  const addedTargets = new Set<string>();
  const pushAction = (
    id: string,
    label: string,
    executionTarget: 'open_repair' | 'open_layaway' | 'queue_manager_review',
    entityId?: string,
  ): void => {
    const key = `${executionTarget}|${entityId || ''}`;
    if (addedTargets.has(key)) return;
    addedTargets.add(key);
    actions.push({
      id,
      label,
      payload: {
        type: 'review',
        executable: true,
        executionTarget,
        ...(entityId ? { entityId } : {}),
      },
    });
  };

  const topRepair  = repairsPendingTomorrow[0];
  const topLayaway = layawaysDueThisWeek[0];
  const topExt     = externalPaymentsPending[0];

  if (topRepair) {
    pushAction('eod-open-repair', t('chat.eodBrief.actionViewRepair'), 'open_repair', topRepair.id);
  }
  if (topLayaway) {
    pushAction('eod-open-layaway', t('chat.eodBrief.actionViewLayaway'), 'open_layaway', topLayaway.id);
  }
  if (topExt) {
    pushAction('eod-verify-payment', t('chat.eodBrief.actionVerifyPayment'), 'queue_manager_review', topExt.id);
  }

  // Establish operational context on the most-overdue repair so follow-ups
  // ("open the first one", "what next") land naturally. Aligns with
  // dailyBrief.ts's alert-first context selection pattern.
  const establishesContext = topRepair
    ? { type: 'repair' as const, value: topRepair.id }
    : undefined;

  return {
    kind: 'answer',
    text: lines.join('\n'),
    ...(actions.length > 0 ? { actions: actions.slice(0, 5) } : {}),
    ...(establishesContext ? { establishesContext } : {}),
  };
}
