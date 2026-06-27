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

// R-EOD-MONEY-WIRE: 4th arg threads the financial-privacy decision from the
// dispatch layer (IntelligenceChat → handleIntent). Default true preserves
// every existing caller (and the solo/owner operator) seeing full money.

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
  canSeeOwnerFinancials: boolean = true,
): ChatResponse {
  const t = tChat(lang);
  const brief = composeEODBrief(engine, lang, nowMs, canSeeOwnerFinancials);
  const { money, openItems } = brief;

  const dateStr = formatBriefDate(brief.generatedAtMs, lang);

  const lines: string[] = [];
  lines.push(`**🌙 ${t('chat.eodBrief.header')}**`);
  lines.push(t('chat.eodBrief.headerDate', dateStr));
  lines.push('');

  // ── Money section ─────────────────────────────────────────
  // R-EOD-MONEY-WIRE: core money is now real (engine.getTodayMoney).
  //   - 'placeholder' (defensive legacy path) → single transparency line.
  //   - empty day (no sales, no returns)      → "no sales yet" line.
  //   - otherwise                              → sales / revenue / profit /
  //     returns lines. Profit + margin render ONLY when money.profitVisible
  //     (financial-privacy gate). Tender + fees/taxes are NOT rendered — they
  //     are flagged unavailable (Priority A2) and must not appear as real.
  if (money.confidence === 'placeholder') {
    lines.push(t('chat.eodBrief.moneyPending', money.saleCount));
    lines.push('');
  } else {
    const noActivity =
      money.saleCount === 0 &&
      money.returnCount === 0 &&
      money.grossRevenueCents === 0;
    if (noActivity) {
      lines.push(t('chat.eodBrief.noSalesToday'));
      lines.push('');
    } else {
      lines.push(t('chat.eodBrief.salesCount', money.saleCount));
      lines.push(t('chat.eodBrief.revenueLine', COP(money.grossRevenueCents), COP(money.netRevenueCents)));
      if (money.profitVisible) {
        lines.push(t('chat.eodBrief.profitLine', COP(money.grossProfitCents), money.profitMarginPct.toFixed(1)));
      }
      if (money.returnCount > 0) {
        lines.push(t('chat.eodBrief.returnsLine', money.returnCount, COP(money.returnedAmountCents)));
      }
      lines.push('');
    }
  }

  // ── Tender breakdown (R-INTELLIGENCE-EOD-A2B) ─────────────
  // Decomposition of already-visible revenue (cash/card/store credit). Sales
  // totals are employee-allowed, so tender is NOT gated by profitVisible. Only
  // non-zero buckets render; section is skipped entirely when unavailable.
  if (money.tenderBreakdownAvailable) {
    const tb = money.tenderBreakdown;
    const tenderLines: string[] = [];
    if (tb.cashCents > 0)        tenderLines.push(`  • ${t('chat.eodBrief.tenderCash')} — ${COP(tb.cashCents)}`);
    if (tb.cardCents > 0)        tenderLines.push(`  • ${t('chat.eodBrief.tenderCard')} — ${COP(tb.cardCents)}`);
    if (tb.storeCreditCents > 0) tenderLines.push(`  • ${t('chat.eodBrief.tenderStoreCredit')} — ${COP(tb.storeCreditCents)}`);
    if (tb.externalCents > 0)    tenderLines.push(`  • ${t('chat.eodBrief.tenderExternal')} — ${COP(tb.externalCents)}`);
    if (tb.otherCents > 0)       tenderLines.push(`  • ${t('chat.eodBrief.tenderOther')} — ${COP(tb.otherCents)}`);
    if (tenderLines.length > 0) {
      lines.push(t('chat.eodBrief.tenderHeader'));
      lines.push(...tenderLines);
      lines.push('');
    }
  }

  // ── Taxes & fees collected (R-INTELLIGENCE-EOD-A2B) ───────
  // Gated behind money.profitVisible so employees (and any non-financial
  // viewer) never see the tax/fee breakdown. Owner sees it; the financial-
  // privacy gate already resolved profitVisible upstream. Only non-zero lines
  // render; totalCents === sum of the lines above (engine invariant).
  if (money.feesAndTaxesAvailable && money.profitVisible) {
    const ft = money.feesAndTaxes;
    const feeLines: string[] = [];
    if (ft.salesTaxCents > 0)      feeLines.push(`  • ${t('chat.eodBrief.taxSales')} — ${COP(ft.salesTaxCents)}`);
    if (ft.utilityTaxCents > 0)    feeLines.push(`  • ${t('chat.eodBrief.taxUtility')} — ${COP(ft.utilityTaxCents)}`);
    if (ft.caMobilityFeeCents > 0) feeLines.push(`  • ${t('chat.eodBrief.feeMobility')} — ${COP(ft.caMobilityFeeCents)}`);
    if (ft.cbeFeeCents > 0)        feeLines.push(`  • ${t('chat.eodBrief.feeCbe')} — ${COP(ft.cbeFeeCents)}`);
    if (ft.screenFeeCents > 0)     feeLines.push(`  • ${t('chat.eodBrief.feeScreen')} — ${COP(ft.screenFeeCents)}`);
    if (ft.creditCardFeeCents > 0) feeLines.push(`  • ${t('chat.eodBrief.feeCreditCard')} — ${COP(ft.creditCardFeeCents)}`);
    if (feeLines.length > 0) {
      lines.push(t('chat.eodBrief.taxesHeader'));
      lines.push(...feeLines);
      lines.push(`  • ${t('chat.eodBrief.taxesTotal')} — ${COP(ft.totalCents)}`);
      lines.push('');
    }
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
