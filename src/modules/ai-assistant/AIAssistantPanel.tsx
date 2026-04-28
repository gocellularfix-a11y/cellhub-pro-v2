// ============================================================
// CellHub Pro — AI Assistant Panel
// Sliding side panel powered by Claude API.
// Business-aware: gets live context from store state.
// Persistent: chat history saved to localStorage.
// Bilingual: EN/ES system prompt + UI labels.
// ============================================================

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useApp } from '@/store/AppProvider';
import { useTranslation } from '@/i18n';
import { formatCurrency } from '@/utils/currency';
import { isToday } from '@/utils/dates';
import { loadLocal } from '@/services/storage';
import { REPAIR_STATUS, normalizeRepairStatus, isDoneRepairStatus } from '@/utils/repairStatus';

// ── Types ─────────────────────────────────────────────────

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface ProactiveInsight {
  id: string;
  icon: string;
  text: string;
  action?: string;
  actionTab?: string;
  severity: 'info' | 'warning' | 'success';
}

// ── Constants ─────────────────────────────────────────────

const STORAGE_KEY = 'cellhub_ai_history';
const MAX_HISTORY = 40; // messages to keep in localStorage

// Round 25 — Claude model default. Kept as a constant so Settings audit
// r26: claudeModel field is now formal in StoreSettings; this is the fallback default
// when the field is unset (e.g. legacy saves from before r26).
const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-6';

// ── Helpers ───────────────────────────────────────────────

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function saveHistory(msgs: Message[]) {
  try {
    const trimmed = msgs.slice(-MAX_HISTORY);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Storage full — ignore
  }
}

function loadHistory(): Message[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── Build System Prompt ───────────────────────────────────

function buildSystemPrompt(state: ReturnType<typeof useApp>['state']): string {
  const { sales, repairs, inventory, customers, unlocks, specialOrders, layaways, settings, lang: locale, employees, purchaseOrders, appointments } = state;
  const isEs = locale === 'es';
  const now = new Date();

  // Load Returns from localStorage — Returns module has not yet been migrated
  // to AppState (pre-r25 architectural debt). Read directly from its storage keys.
  const customerReturns = loadLocal<any[]>('customer_returns', []);
  const vendorReturns = loadLocal<any[]>('vendor_returns', []);

  // ── Today ──
  const todaySales = sales.filter((s) => isToday(s.createdAt as string | Date) && s.status !== 'voided');
  const todayRevenue = todaySales.reduce((sum, s) => sum + (s.total || 0), 0);
  const todayProfit = todaySales.reduce((sum, s) => sum + s.items.reduce((p, i) => p + (i.price - (i.cost || 0)) * i.qty, 0), 0);

  // ── Last 7 days vs previous 7 days (rolling window) ──
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const thisWeekStart = new Date(now.getTime() - weekMs);
  const lastWeekStart = new Date(now.getTime() - 2 * weekMs);
  const thisWeekSales = sales.filter((s) => { const d = new Date(s.createdAt as string); return d >= thisWeekStart && s.status !== 'voided'; });
  const lastWeekSales = sales.filter((s) => { const d = new Date(s.createdAt as string); return d >= lastWeekStart && d < thisWeekStart && s.status !== 'voided'; });
  const thisWeekRev = thisWeekSales.reduce((sum, s) => sum + s.total, 0);
  const lastWeekRev = lastWeekSales.reduce((sum, s) => sum + s.total, 0);
  const revTrend = lastWeekRev > 0 ? (((thisWeekRev - lastWeekRev) / lastWeekRev) * 100).toFixed(0) : null;

  // ── Top 5 selling items (last 30 days) ──
  const thirtyDaysAgo = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  const sixtyDaysAgo = now.getTime() - 60 * 24 * 60 * 60 * 1000;
  const ninetyDaysAgo = now.getTime() - 90 * 24 * 60 * 60 * 1000;
  const recentSales = sales.filter((s) => new Date(s.createdAt as string).getTime() > thirtyDaysAgo && s.status !== 'voided');
  const itemCounts: Record<string, { qty: number; revenue: number }> = {};
  recentSales.forEach((s) => s.items.forEach((i) => {
    if (!itemCounts[i.name]) itemCounts[i.name] = { qty: 0, revenue: 0 };
    itemCounts[i.name].qty += i.qty;
    itemCounts[i.name].revenue += i.price * i.qty;
  }));
  const topSellers = Object.entries(itemCounts)
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 5)
    .map(([name, d]) => `${name} (${d.qty} units, ${formatCurrency(d.revenue)})`);

  // ── Slow movers & dead inventory (round 25 enrichment) ──
  const soldNames = new Set(recentSales.flatMap((s) => s.items.map((i) => i.name)));
  const slowMovers = inventory
    .filter((i) => i.qty > 0 && i.category !== 'service' && !soldNames.has(i.name))
    .slice(0, 5)
    .map((i) => `${i.name} (${i.qty} in stock, ${formatCurrency(i.price)} each)`);
  // Dead inventory: items with meaningful cost (>$50) that haven't moved in 60+ days
  const sixtyDaySoldNames = new Set(
    sales
      .filter((s) => new Date(s.createdAt as string).getTime() > sixtyDaysAgo && s.status !== 'voided')
      .flatMap((s) => s.items.map((i) => i.name)),
  );
  const deadInventory = inventory
    .filter((i) => i.qty > 0 && i.category !== 'service' && (i.cost || 0) >= 5000 && !sixtyDaySoldNames.has(i.name))
    .sort((a, b) => ((b.cost || 0) * b.qty) - ((a.cost || 0) * a.qty))
    .slice(0, 5)
    .map((i) => `${i.name} (${i.qty}× @ ${formatCurrency(i.cost || 0)} cost = ${formatCurrency((i.cost || 0) * i.qty)} tied up)`);
  const deadInventoryValue = inventory
    .filter((i) => i.qty > 0 && i.category !== 'service' && (i.cost || 0) >= 5000 && !sixtyDaySoldNames.has(i.name))
    .reduce((sum, i) => sum + (i.cost || 0) * i.qty, 0);

  // ── Repairs + aging histogram (round 25 enrichment) ──
  // Round R2: canonical repair status comparisons via helper.
  const pendingRepairs = repairs.filter((r) => !isDoneRepairStatus(r.status || ''));
  const readyRepairs = repairs.filter((r) => {
    const s = normalizeRepairStatus(r.status || '');
    return s === REPAIR_STATUS.PICKED_UP || s === REPAIR_STATUS.READY;
  });
  const threeDaysAgo = now.getTime() - 3 * 24 * 60 * 60 * 1000;
  const fiveDaysAgo = now.getTime() - 5 * 24 * 60 * 60 * 1000;
  const tenDaysAgo = now.getTime() - 10 * 24 * 60 * 60 * 1000;
  const getRepairAge = (r: any) => {
    const updated = r.updatedAt ? new Date(r.updatedAt as string).getTime() : new Date(r.createdAt as string).getTime();
    return now.getTime() - updated;
  };
  const overdueRepairs = pendingRepairs.filter((r) => {
    const updated = r.updatedAt ? new Date(r.updatedAt as string).getTime() : new Date(r.createdAt as string).getTime();
    return updated < threeDaysAgo;
  });
  // Aging buckets: 3-5 days / 6-10 days / 10+ days
  const agingBuckets = {
    bucket35: pendingRepairs.filter((r) => {
      const u = r.updatedAt ? new Date(r.updatedAt as string).getTime() : new Date(r.createdAt as string).getTime();
      return u < threeDaysAgo && u >= fiveDaysAgo;
    }),
    bucket610: pendingRepairs.filter((r) => {
      const u = r.updatedAt ? new Date(r.updatedAt as string).getTime() : new Date(r.createdAt as string).getTime();
      return u < fiveDaysAgo && u >= tenDaysAgo;
    }),
    bucket10plus: pendingRepairs.filter((r) => {
      const u = r.updatedAt ? new Date(r.updatedAt as string).getTime() : new Date(r.createdAt as string).getTime();
      return u < tenDaysAgo;
    }),
  };
  const criticalRepairs = agingBuckets.bucket10plus
    .slice(0, 5)
    .map((r) => {
      const days = Math.floor(getRepairAge(r) / (24 * 60 * 60 * 1000));
      return `${r.customerName || 'Unknown'} (${(r as any).device || 'device'}, ${days}d)`;
    });
  // Repair conversion rate
  const repairsWithOutcome = repairs.filter((r) => (r as any).diagnosisOutcome);
  const acceptedRepairs = repairsWithOutcome.filter((r) => (r as any).diagnosisOutcome === 'accepted');
  const conversionRate = repairsWithOutcome.length > 0 ? ((acceptedRepairs.length / repairsWithOutcome.length) * 100).toFixed(0) : null;
  const conversionHealth = conversionRate !== null
    ? (Number(conversionRate) >= 70 ? 'HEALTHY' : Number(conversionRate) >= 50 ? 'OK' : 'LOW — pricing may be too high')
    : 'insufficient data';

  // ── Inventory ──
  const lowStock = inventory.filter((i) => i.category !== 'service' && i.qty > 0 && i.qty <= (settings.lowStockThreshold || 2));
  const outOfStock = inventory.filter((i) => i.category !== 'service' && i.qty === 0);
  const totalInventoryValue = inventory.reduce((sum, i) => sum + (i.cost || 0) * i.qty, 0);
  const totalInventoryRetail = inventory.reduce((sum, i) => sum + i.price * i.qty, 0);

  // ── Layaways overdue ──
  const overdueLayaways = layaways.filter((l) => {
    if (l.status !== 'active') return false;
    if (!(l as any).dueDate) return false;
    return new Date((l as any).dueDate).getTime() < now.getTime();
  });
  const activeLayawaysBalance = layaways
    .filter((l) => l.status === 'active')
    .reduce((sum, l) => sum + ((l as any).balance || 0), 0);

  // ── Customers + LTV (round 25 enrichment) ──
  // Lapsed: use updatedAt if present, else fall back to createdAt
  const lapsedCustomers = customers.filter((c) => {
    const reference = c.updatedAt || c.createdAt;
    if (!reference) return false;
    const d = new Date(reference as string);
    return d.getTime() < thirtyDaysAgo;
  });
  // LTV — top customers by actual revenue from sales in last 90 days
  const ltvMap: Record<string, number> = {};
  sales.forEach((s) => {
    if (s.status === 'voided') return;
    if (new Date(s.createdAt as string).getTime() < ninetyDaysAgo) return;
    const cid = (s as any).customerId;
    if (!cid) return;
    ltvMap[cid] = (ltvMap[cid] || 0) + (s.total || 0);
  });
  const topLtvCustomers = Object.entries(ltvMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cid, rev]) => {
      const c = customers.find((x) => x.id === cid);
      return c ? `${c.name} (${formatCurrency(rev)} in 90d)` : null;
    })
    .filter(Boolean);
  const topLoyaltyCustomers = [...customers]
    .filter((c) => (c.loyaltyPoints || 0) > 0)
    .sort((a, b) => (b.loyaltyPoints || 0) - (a.loyaltyPoints || 0))
    .slice(0, 3)
    .map((c) => `${c.name} (${c.loyaltyPoints || 0} pts, ${formatCurrency(c.storeCredit || 0)} credit)`);

  // ── Peak hours breakdown (round 25 enrichment) ──
  const hourCounts: Record<number, number> = {};
  recentSales.forEach((s) => {
    const h = new Date(s.createdAt as string).getHours();
    hourCounts[h] = (hourCounts[h] || 0) + 1;
  });
  const sortedHours = Object.entries(hourCounts).sort((a, b) => b[1] - a[1]);
  const peakHour = sortedHours[0];
  const peakHourStr = peakHour ? `${peakHour[0]}:00–${Number(peakHour[0]) + 1}:00 (${peakHour[1]} sales)` : 'Not enough data';
  const top3Hours = sortedHours.slice(0, 3).map(([h, c]) => `${h}:00 (${c})`).join(', ') || 'n/a';

  // ── CA Tax (current quarter) ──
  const month = now.getMonth();
  const year = now.getFullYear();
  const qMonths = month < 3 ? [0,1,2] : month < 6 ? [3,4,5] : month < 9 ? [6,7,8] : [9,10,11];
  const qLabel = month < 3 ? 'Q1' : month < 6 ? 'Q2' : month < 9 ? 'Q3' : 'Q4';
  const qSales = sales.filter((s) => { const d = new Date(s.createdAt as string); return d.getFullYear() === year && qMonths.includes(d.getMonth()) && s.status !== 'voided'; });
  const qRevenue = qSales.reduce((sum, s) => sum + (s.total || 0), 0);
  const qTax = qSales.reduce((sum, s) => sum + ((s as any).taxAmount || 0), 0);
  const qCBE = qSales.reduce((sum, s) => sum + (s.cbeTotal || 0), 0);
  const qPhonePayments = qSales.filter((s) => s.items?.some((i) => i.category === 'phone_payment'));

  const pendingOrders = specialOrders.filter((o) => !['Picked Up', 'Cancelled', 'picked_up', 'cancelled'].includes(o.status));
  const activeLayaways = layaways.filter((l) => l.status === 'active');
  const pendingUnlocks = unlocks.filter((u) => !['Completed', 'Cancelled', 'completed', 'cancelled', 'Failed', 'failed'].includes(u.status || ''));

  // ── Purchase Orders ──
  const openPOs = (purchaseOrders || []).filter((po) => !['received', 'cancelled'].includes(po.status));
  const draftPOs = openPOs.filter((po) => po.status === 'draft');
  const orderedPOs = openPOs.filter((po) => po.status === 'ordered');
  const partialPOs = openPOs.filter((po) => po.status === 'partial');
  const poTotalPending = openPOs.reduce((s, po) => s + (po.total || 0), 0);

  // ── Cash flow signal (round 25 enrichment) ──
  // Compare committed $ (open POs + active layaway balances) vs last 30 days revenue
  const last30DayRevenue = recentSales.reduce((sum, s) => sum + (s.total || 0), 0);
  const committedCash = poTotalPending + activeLayawaysBalance;
  const cashFlowRatio = last30DayRevenue > 0 ? committedCash / last30DayRevenue : null;
  const cashFlowSignal = cashFlowRatio === null
    ? 'insufficient data'
    : cashFlowRatio >= 0.8 ? 'TIGHT — committed cash ≥80% of last 30d revenue'
      : cashFlowRatio >= 0.5 ? 'CAUTION — committed cash 50-80% of revenue'
      : 'HEALTHY';

  // ── Returns (round 25 — now sourced from localStorage) ──
  const recentCustomerReturns = customerReturns.filter((r: any) => {
    const d = new Date(r.createdAt || r.date || 0);
    return d.getTime() > thirtyDaysAgo;
  });
  const recentVendorReturns = vendorReturns.filter((r: any) => {
    const d = new Date(r.createdAt || r.date || 0);
    return d.getTime() > thirtyDaysAgo;
  });
  const returnTotal = recentCustomerReturns.reduce(
    (s: number, r: any) => s + (r.refundAmount || r.total || r.amount || 0),
    0,
  );

  // ── Appointments (round 25 — canonical field estimatedDropOff) ──
  const upcomingAppts = appointments.filter((a) => {
    if (!a.estimatedDropOff) return false;
    if (a.status !== 'scheduled') return false;
    const d = new Date(a.estimatedDropOff);
    return d.getTime() > now.getTime();
  }).slice(0, 5);
  const todayAppts = appointments.filter((a) => {
    if (!a.estimatedDropOff) return false;
    const d = new Date(a.estimatedDropOff);
    return d.toDateString() === now.toDateString() && a.status === 'scheduled';
  });
  const arrivedAppts = appointments.filter((a) => a.status === 'arrived');

  // ── Employees detailed — commission display fixed to match r24 form ──
  const activeEmployees = (employees || []).filter((e) => e.active !== false);
  const employeeDetails = activeEmployees.slice(0, 8).map((e) => {
    const rate = (e as any).commissionRate;
    const commissionStr = typeof rate === 'number' && rate > 0
      ? `, ${(rate * 100).toFixed(1)}% commission`
      : '';
    return `${e.name} (${e.role || 'staff'}${commissionStr})`;
  });

  // ── Carrier portal summary (from phone_payment sales) ──
  const carrierSales: Record<string, { count: number; revenue: number }> = {};
  qSales.forEach((s) => {
    s.items?.filter((i) => i.category === 'phone_payment' && i.carrier).forEach((i) => {
      const c = i.carrier!;
      if (!carrierSales[c]) carrierSales[c] = { count: 0, revenue: 0 };
      carrierSales[c].count++;
      carrierSales[c].revenue += i.price * i.qty;
    });
  });
  const carrierSummary = Object.entries(carrierSales)
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .map(([carrier, d]) => `${carrier}: ${d.count} payments, ${formatCurrency(d.revenue)}`);

  return `You are the AI Business Assistant for CellHub Pro, embedded in ${settings.storeName || 'this store'} — a cell phone repair and wireless retail shop${settings.storeAddress ? ` at ${settings.storeAddress}` : ''}.

${isEs ? 'IMPORTANT: The operator prefers Spanish. Respond in Spanish unless they write in English. Use natural Mexican Spanish (not Spain Spanish).' : 'The operator prefers English. Respond in English unless they write in Spanish.'}

You have FULL real-time access to the store's data in the snapshot below. You are NOT a generic chatbot — you are a domain expert in cell phone repair, wireless retail, California sales tax compliance, and carrier portal reconciliation. You understand the specific patterns and pain points of this industry.

== LIVE STORE SNAPSHOT (${now.toLocaleString()}) ==

TODAY:
- Transactions: ${todaySales.length}
- Revenue: ${formatCurrency(todayRevenue)}
- Gross profit: ${formatCurrency(todayProfit)} (margin: ${todayRevenue > 0 ? ((todayProfit / todayRevenue) * 100).toFixed(1) : 0}%)
- Peak hour (last 30d): ${peakHourStr}
- Top 3 busiest hours (last 30d): ${top3Hours}

LAST 7 DAYS vs PREVIOUS 7 DAYS:
- This period: ${formatCurrency(thisWeekRev)} (${thisWeekSales.length} sales)
- Prior period: ${formatCurrency(lastWeekRev)} (${lastWeekSales.length} sales)
- Trend: ${revTrend !== null ? `${Number(revTrend) >= 0 ? '+' : ''}${revTrend}%` : 'Not enough data'}

REPAIRS (${pendingRepairs.length} active):
- Ready for pickup: ${readyRepairs.length}${readyRepairs.length > 0 ? ` → ${readyRepairs.slice(0, 6).map(r => r.customerName).join(', ')}` : ''}
- Aging breakdown (pending):
  · 3–5 days: ${agingBuckets.bucket35.length}
  · 6–10 days: ${agingBuckets.bucket610.length}
  · 10+ days: ${agingBuckets.bucket10plus.length}${criticalRepairs.length > 0 ? ` → ${criticalRepairs.join(', ')}` : ''}
- Total overdue (3+ days no update): ${overdueRepairs.length}
- Diagnosis conversion rate: ${conversionRate !== null ? `${conversionRate}%` : 'n/a'} (${acceptedRepairs.length}/${repairsWithOutcome.length} with outcome) — ${conversionHealth}

INVENTORY:
- Total SKUs: ${inventory.length} | Cost value: ${formatCurrency(totalInventoryValue)} | Retail value: ${formatCurrency(totalInventoryRetail)}
- Low stock (≤${settings.lowStockThreshold || 2}): ${lowStock.length}${lowStock.length > 0 ? ` → ${lowStock.slice(0,5).map(i => `${i.name} (${i.qty})`).join(', ')}` : ''}
- Out of stock: ${outOfStock.length}${outOfStock.length > 0 ? ` → ${outOfStock.slice(0,5).map(i => i.name).join(', ')}` : ''}
- Slow movers (0 sales 30d): ${slowMovers.length > 0 ? slowMovers.join('; ') : 'none'}
- Dead inventory (60+ days no sale, cost ≥$50): ${deadInventory.length} items, ${formatCurrency(deadInventoryValue)} tied up${deadInventory.length > 0 ? `\n  · ${deadInventory.join('\n  · ')}` : ''}

TOP SELLERS (last 30 days by revenue):
${topSellers.length > 0 ? topSellers.map((s, i) => `${i + 1}. ${s}`).join('\n') : 'Not enough sales data yet'}

CUSTOMERS:
- Total: ${customers.length}
- Lapsed (30+ days no activity): ${lapsedCustomers.length}${lapsedCustomers.length > 0 ? ` → ${lapsedCustomers.slice(0,3).map(c => c.name).join(', ')}` : ''}
- Top by revenue (last 90d, LTV): ${topLtvCustomers.length > 0 ? topLtvCustomers.join(', ') : 'no customer-linked sales yet'}
- Top by loyalty points: ${topLoyaltyCustomers.join(', ') || 'none yet'}

PENDING WORK:
- Unlocks: ${pendingUnlocks.length} pending
- Special orders: ${pendingOrders.length} pending
- Layaways: ${activeLayaways.length} active (${formatCurrency(activeLayawaysBalance)} balance)${overdueLayaways.length > 0 ? `, ${overdueLayaways.length} OVERDUE` : ''}

APPOINTMENTS:
- Today scheduled: ${todayAppts.length}${todayAppts.length > 0 ? ` → ${todayAppts.map((a) => a.customerName || 'Customer').join(', ')}` : ''}
- Already arrived (awaiting ticket): ${arrivedAppts.length}
- Upcoming scheduled: ${upcomingAppts.length}

RETURNS (last 30 days):
- Customer returns: ${recentCustomerReturns.length} (${formatCurrency(returnTotal)} refunded)
- Vendor returns: ${recentVendorReturns.length}

EMPLOYEES (${activeEmployees.length} active):
${employeeDetails.length > 0 ? employeeDetails.map((e) => `- ${e}`).join('\n') : '- No employees on record'}

PURCHASE ORDERS:
- Open: ${openPOs.length} (${draftPOs.length} draft, ${orderedPOs.length} ordered, ${partialPOs.length} partial)
- $ committed: ${formatCurrency(poTotalPending)}${openPOs.length > 0 ? `\n- Pending: ${openPOs.slice(0,4).map((po) => `${po.vendor} ${formatCurrency(po.total)} [${po.status}]`).join(', ')}` : ''}

CASH FLOW SIGNAL: ${cashFlowSignal}
- Last 30d revenue: ${formatCurrency(last30DayRevenue)}
- Committed cash (open POs + active layaways balance): ${formatCurrency(committedCash)}

CA TAX — ${qLabel} ${year}:
- Revenue: ${formatCurrency(qRevenue)} (${qSales.length} sales)
- Sales tax collected: ${formatCurrency(qTax)}
- Phone payments: ${qPhonePayments.length} transactions
- CBE fees collected: ${formatCurrency(qCBE)}
${carrierSummary.length > 0 ? `- Carrier portal breakdown (needs reconciliation against supplier portals):\n${carrierSummary.map((c) => `  · ${c}`).join('\n')}` : ''}

STORE CONFIG:
- Tax rate: ${((settings.taxRate ?? 0.0925) * 100).toFixed(2)}%
- Carriers supported: ${(settings.phoneCarriers || []).join(', ') || 'AT&T, T-Mobile, Verizon, Simple Mobile, Page Plus, H2O'}
- Loyalty enabled: ${settings.loyaltyEnabled ? 'Yes' : 'No'}

== DOMAIN KNOWLEDGE (cell phone repair + wireless retail) ==

Use this knowledge when the operator asks for advice. You are the expert — do not hedge with generic "consult a professional" unless legal/tax questions are truly outside these bounds.

REPAIR AGING PLAYBOOK:
- 0–2 days: healthy. No action.
- 3–5 days pending: ALWAYS suggest calling the customer with a status update. Silence kills referrals.
- 6–10 days pending: URGENT. Customer may have forgotten the phone or assumed it's lost. Suggest SMS + phone call. If a part is backordered, suggest offering a loaner or a small discount.
- 10+ days pending: CRITICAL. Recommend same-day contact. Suggest a 10% goodwill discount. If the customer is unreachable after 2 attempts, start the California abandoned-property clock (30 days notice required before legal disposal).

DIAGNOSIS CONVERSION RATE PLAYBOOK:
- ≥70%: healthy. Pricing and trust levels are right.
- 50–69%: OK but monitor. Small shifts in pricing or presentation could lift it.
- <50%: pricing is likely too high OR the diagnosis is not being explained well. Suggest reviewing the 3 most recent "declined" outcomes.

INVENTORY CASH FLOW PLAYBOOK:
- Dead inventory >$2,000 tied up: recommend a clearance discount (15–25%) to free cash.
- Cash flow signal TIGHT: do NOT suggest new PO drafts. Suggest clearing slow movers first and collecting overdue layaways.
- Cash flow signal HEALTHY: safe to suggest replenishing top-seller stock.

CALIFORNIA SALES TAX (CDTFA) & CBE:
- The operator's tax rate is listed in STORE CONFIG above. CA statewide base is 7.25%; Santa Barbara city adds district taxes bringing it to 8.75% typical.
- CBE (California Battery Fee) applies per battery sold, collected as a fixed fee, remitted quarterly to CDTFA via form CDTFA-501-LS.
- Phone payment carrier top-ups are generally NOT subject to sales tax (they're a telecom service), but commission revenue IS subject to income tax. The snapshot distinguishes these correctly.
- When asked about quarterly tax prep: direct the operator to the Tax Reports module and summarize the numbers from the CA TAX snapshot above. Do not invent numbers.

CARRIER PORTAL RECONCILIATION:
- AT&T uses WebPOS. Commissions post 15–30 days after the transaction.
- T-Mobile uses QPay. Commissions post 10–20 days after the transaction.
- Verizon uses VidaPay. Commissions post 20–45 days.
- H2O Wireless uses H2O Direct. Near-instant posting, lower commission.
- If the operator asks "how much am I owed from carriers this month", use the carrier portal breakdown in CA TAX above to estimate. ALWAYS remind them to check the actual supplier portal for pending vs posted commissions — the snapshot only knows what was SOLD, not what was PAID.

CUSTOMER RE-ENGAGEMENT PLAYBOOK:
- Lapsed customer + active store credit: draft an SMS reminder about the credit (offers high conversion).
- Lapsed customer + past repair history: offer a discount on battery replacement or screen protector.
- Top LTV customer + lapsed: PERSONAL call, not SMS. These are the most valuable to win back.

STAFFING PLAYBOOK:
- Use the top 3 busiest hours in TODAY section to suggest specific time blocks that need coverage.
- If peak hour is tight on staff during pending-repairs crisis, suggest reassigning a technician during peak to cover counter.

== RESPONSE RULES — MANDATORY ==

1. **BE SPECIFIC. Never generalize.** If there are 3 overdue repairs, name each customer. If a slow mover needs a discount, give the exact dollar amount. Generic advice is useless.

2. **Lead with the most urgent item.** Do not bury the critical thing under small talk.

3. **Use severity emojis** at the start of any flagged item:
   🔴 CRITICAL (money at risk, legal issue, customer about to leave a bad review)
   🟡 ATTENTION (needs action this week)
   🟢 INFO (nice to know, not urgent)
   ✅ HEALTHY (positive confirmation)

4. **Never invent data.** If the snapshot doesn't contain the answer, say so explicitly: "I don't see that in the current snapshot — check the [X] module directly." Do NOT guess. Do NOT say "typically" or "usually" when the operator is asking about THEIR store.

5. **Give actionable next steps.** Every response ends with ONE clear next action the operator can do in the next 5 minutes.

6. **Use the operator's language throughout.** Mix in Spanish phrases if the operator writes in Spanglish. Match their tone — casual if they're casual, formal if they're formal.

7. **Format: bullets over prose.** Max 250 words unless asked for detail. Use **bold** for customer names and dollar amounts that need attention.

8. **For SMS drafts:** always provide BOTH English and Spanish versions. Include the store name and a call-to-action. Max 160 characters per version (SMS limit).

9. **For CA tax questions:** use the CA TAX snapshot numbers directly. Do not hedge with "consult a CPA" unless the question is about personal income tax or legal structure.

10. **When asked "scan store" or "dame un reporte":** give a 5-section structured report in this order:
    (1) 🔴 Critical urgencies
    (2) 🟡 This week's attention items
    (3) Revenue + trend snapshot
    (4) Inventory health
    (5) 3 specific recommended actions for TODAY

Remember: you are embedded in a working store. The operator is likely on the sales floor, phone ringing, customer at the counter. Respect their time. Be useful, not chatty.`;
}

// ── Proactive Insights Generator ─────────────────────────

function buildInsights(state: ReturnType<typeof useApp>['state'], t: (key: string, ...args: any[]) => string): ProactiveInsight[] {
  const { sales, repairs, inventory, customers, layaways, settings } = state;
  const insights: ProactiveInsight[] = [];
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1000;

  // 1. Ready repairs — highest priority
  // Round R2: canonical repair status via helper.
  const readyRepairs = repairs.filter((r) => {
    const s = normalizeRepairStatus(r.status || '');
    return s === REPAIR_STATUS.PICKED_UP || s === REPAIR_STATUS.READY;
  });
  if (readyRepairs.length > 0) {
    insights.push({
      id: 'ready-repairs',
      icon: '🔧',
      severity: 'warning',
      text: t('ai.insightRepairsReady', readyRepairs.length),
      action: t('ai.viewRepairs'),
      actionTab: 'repairs',
    });
  }

  // 2. Overdue repairs (no update in 3+ days)
  // Round R2: canonical repair status via helper.
  const pendingRepairs = repairs.filter((r) => !isDoneRepairStatus(r.status || ''));
  const overdueRepairs = pendingRepairs.filter((r) => {
    const updated = r.updatedAt ? new Date(r.updatedAt as string).getTime() : new Date(r.createdAt as string).getTime();
    return updated < threeDaysAgo;
  });
  if (overdueRepairs.length > 0) {
    insights.push({
      id: 'overdue-repairs',
      icon: '⏰',
      severity: 'warning',
      text: t('ai.insightRepairsOverdue', overdueRepairs.length),
      action: t('ai.viewRepairs'),
      actionTab: 'repairs',
    });
  }

  // 3. Out of stock
  const outOfStock = inventory.filter((i) => i.category !== 'service' && i.qty === 0);
  if (outOfStock.length > 0) {
    insights.push({
      id: 'out-of-stock',
      icon: '🚫',
      severity: 'warning',
      text: t('ai.insightOutOfStock', outOfStock.length),
      action: t('ai.viewInventory'),
      actionTab: 'inventory',
    });
  }

  // 4. Low stock
  const lowStock = inventory.filter((i) => i.category !== 'service' && i.qty > 0 && i.qty <= (settings.lowStockThreshold || 2));
  if (lowStock.length > 0) {
    insights.push({
      id: 'low-stock',
      icon: '📦',
      severity: 'warning',
      text: t('ai.insightLowStock', lowStock.length),
      action: t('ai.viewInventory'),
      actionTab: 'inventory',
    });
  }

  // 5. Lapsed customers
  const lapsedCount = customers.filter((c) => {
    if (!c.updatedAt) return false;
    return new Date(c.updatedAt as string).getTime() < thirtyDaysAgo;
  }).length;
  if (lapsedCount >= 5) {
    insights.push({
      id: 'lapsed-customers',
      icon: '👤',
      severity: 'info',
      text: t('ai.insightLapsedCustomers', lapsedCount),
      action: t('ai.viewCustomers'),
      actionTab: 'customers',
    });
  }

  // 6. Overdue layaways
  const overdueLayaways = layaways.filter((l) => {
    if (l.status !== 'active') return false;
    if (!(l as any).dueDate) return false;
    return new Date((l as any).dueDate).getTime() < now;
  });
  if (overdueLayaways.length > 0) {
    insights.push({
      id: 'overdue-layaways',
      icon: '📅',
      severity: 'warning',
      text: t('ai.insightOverdueLayaways', overdueLayaways.length),
      action: t('ai.viewLayaways'),
      actionTab: 'layaways',
    });
  }

  // 7. Today's revenue (positive reinforcement)
  const todaySales = sales.filter((s) => isToday(s.createdAt as string | Date) && s.status !== 'voided');
  if (todaySales.length > 0) {
    const rev = todaySales.reduce((sum, s) => sum + (s.total || 0), 0);
    insights.push({
      id: 'today-revenue',
      icon: '💰',
      severity: 'success',
      text: t('ai.insightTodayRevenue', formatCurrency(rev), todaySales.length),
    });
  }

  return insights;
}

// ── Message Bubble ────────────────────────────────────────

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user';
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: isUser ? 'flex-end' : 'flex-start',
      marginBottom: '0.75rem',
    }}>
      <div style={{
        maxWidth: '88%',
        padding: '0.625rem 0.875rem',
        borderRadius: isUser ? '1rem 1rem 0.25rem 1rem' : '1rem 1rem 1rem 0.25rem',
        background: isUser
          ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
          : 'rgba(255,255,255,0.07)',
        border: isUser ? 'none' : '1px solid rgba(255,255,255,0.1)',
        color: isUser ? '#fff' : '#e2e8f0',
        fontSize: '0.875rem',
        lineHeight: 1.55,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}>
        {msg.content}
      </div>
      <span style={{ fontSize: '0.65rem', color: '#475569', marginTop: '0.2rem', paddingLeft: '0.25rem', paddingRight: '0.25rem' }}>
        {formatTime(msg.timestamp)}
      </span>
    </div>
  );
}

// ── Typing Indicator ──────────────────────────────────────

function TypingIndicator() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.5rem 0.875rem', marginBottom: '0.75rem' }}>
      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#667eea', animation: 'bounce 1.2s infinite', animationDelay: '0ms' }} />
      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#667eea', animation: 'bounce 1.2s infinite', animationDelay: '200ms' }} />
      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#667eea', animation: 'bounce 1.2s infinite', animationDelay: '400ms' }} />
      <style>{`@keyframes bounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-6px)} }`}</style>
    </div>
  );
}

// ── Insight Card ──────────────────────────────────────────

function InsightCard({ insight, onAction }: { insight: ProactiveInsight; onAction: (tab: string) => void }) {
  const colors: Record<string, string> = {
    warning: 'rgba(251,191,36,0.1)',
    success: 'rgba(34,197,94,0.1)',
    info: 'rgba(59,130,246,0.1)',
  };
  const borderColors: Record<string, string> = {
    warning: 'rgba(251,191,36,0.3)',
    success: 'rgba(34,197,94,0.3)',
    info: 'rgba(59,130,246,0.3)',
  };
  return (
    <div style={{
      background: colors[insight.severity],
      border: `1px solid ${borderColors[insight.severity]}`,
      borderRadius: '0.625rem',
      padding: '0.625rem 0.75rem',
      display: 'flex',
      alignItems: 'center',
      gap: '0.625rem',
      marginBottom: '0.4rem',
    }}>
      <span style={{ fontSize: '1rem', flexShrink: 0 }}>{insight.icon}</span>
      <span style={{ flex: 1, fontSize: '0.8rem', color: '#e2e8f0' }}>{insight.text}</span>
      {insight.action && insight.actionTab && (
        <button
          onClick={() => onAction(insight.actionTab!)}
          style={{
            fontSize: '0.7rem', padding: '0.2rem 0.5rem', borderRadius: '0.375rem',
            background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
            color: '#94a3b8', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
          }}
        >
          {insight.action}
        </button>
      )}
    </div>
  );
}

// ── Quick Prompts ─────────────────────────────────────────


// ── Main Panel ────────────────────────────────────────────

export default function AIAssistantPanel() {
  const { state, dispatch, setActiveTab } = useApp();
  const { showAIAssistant, settings } = state;
  const { t, locale } = useTranslation();

  const [messages, setMessages] = useState<Message[]>(() => loadHistory());
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showQuickPrompts, setShowQuickPrompts] = useState(messages.length === 0);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Round 25 — C6: anti-stale messages ref for rapid-fire sends
  const messagesRef = useRef(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const quickPrompts = [
    t('ai.qpScanStore'), t('ai.qpRepairsReady'), t('ai.qpLowStock'), t('ai.qpWeeklySales'),
    t('ai.qpLapsedCustomers'), t('ai.qpSmsRepair'), t('ai.qpTopSellers'), t('ai.qpCbe'),
  ];
  const insights = useMemo(() => buildInsights(state, t), [state, t]);
  // Round 25 — M1: systemPrompt is expensive to build (O(n) over all collections)
  // and the panel doesn't display it. Build lazily inside sendMessage instead of
  // recomputing on every state tick. Read state via ref to stay fresh without re-memoing.
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  const hasApiKey = useMemo(() => {
    const p = settings.aiProvider || 'claude';
    if (p === 'claude')  return !!settings.claudeApiKey?.trim();
    if (p === 'openai')  return !!settings.openaiApiKey?.trim();
    if (p === 'gemini')  return !!settings.geminiApiKey?.trim();
    if (p === 'custom')  return !!settings.customAiUrl?.trim() && !!settings.customAiKey?.trim();
    return false;
  }, [settings.aiProvider, settings.claudeApiKey, settings.openaiApiKey, settings.geminiApiKey, settings.customAiUrl, settings.customAiKey]);

  const providerLabel = (() => {
    const p = settings.aiProvider || 'claude';
    if (p === 'claude')  return 'Claude · Anthropic';
    if (p === 'openai')  return `${settings.openaiModel || 'gpt-4o'} · OpenAI`;
    if (p === 'gemini')  return `${settings.geminiModel || 'gemini-1.5-flash'} · Google`;
    if (p === 'custom')  return `${settings.customAiModel || 'Custom'} · Custom API`;
    return 'AI';
  })();

  // ── Scroll to bottom on new messages ──────────────────

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // ── Focus input when panel opens ───────────────────────

  useEffect(() => {
    if (showAIAssistant) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [showAIAssistant]);

  // ── Close panel ───────────────────────────────────────

  const handleClose = useCallback(() => {
    dispatch({ type: 'SET_SHOW_AI_ASSISTANT', payload: false });
  }, [dispatch]);

  // ── ESC key intentionally disabled — close via X button only ──

  // ── Navigate to tab from insight ──────────────────────

  const handleInsightAction = useCallback((tab: string) => {
    setActiveTab(tab);
    handleClose();
  }, [setActiveTab, handleClose]);

  // ── Clear history ─────────────────────────────────────

  const handleClear = () => {
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY);
    setShowQuickPrompts(true);
  };

  // ── Send message ──────────────────────────────────────

  const sendMessage = useCallback(async (text: string) => {
    const content = text.trim();
    if (!content || loading) return;
    if (!hasApiKey) {
      setError(t('ai.apiKeyError'));
      return;
    }

    setError(null);
    setShowQuickPrompts(false);

    // Round 25 — C6: read messages via ref for rapid-fire safety
    const userMsg: Message = { id: genId(), role: 'user', content, timestamp: Date.now() };
    const nextMessages = [...messagesRef.current, userMsg];
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    setInput('');
    setLoading(true);

    const historyForApi = nextMessages
      .slice(-20)
      .map((m) => ({ role: m.role, content: m.content }));

    // Round 25 — M1: build systemPrompt lazily right before sending
    const systemPrompt = buildSystemPrompt(stateRef.current);

    try {
      abortRef.current = new AbortController();
      const signal = abortRef.current.signal;

      const provider = settings.aiProvider || 'claude';
      let replyText = '…';

      // ── Claude (Anthropic) — C1 + C2 fix ───────────────
      if (provider === 'claude') {
        const claudeModel = settings.claudeModel || DEFAULT_CLAUDE_MODEL;
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': settings.claudeApiKey || '',
            'anthropic-version': '2023-06-01',
            // Required for direct browser/Electron calls — Anthropic's opt-in
            // header for desktop apps that bundle the key locally.
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          signal,
          body: JSON.stringify({
            model: claudeModel,
            max_tokens: 1024,
            system: systemPrompt,
            messages: historyForApi,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as any)?.error?.message || `Claude API error ${res.status}`);
        }
        const data = await res.json();
        replyText = data.content?.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n') || '…';

      // ── OpenAI / ChatGPT ───────────────────────────────
      } else if (provider === 'openai') {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${settings.openaiApiKey}`,
          },
          signal,
          body: JSON.stringify({
            model: settings.openaiModel || 'gpt-4o',
            max_tokens: 1024,
            messages: [
              { role: 'system', content: systemPrompt },
              ...historyForApi,
            ],
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as any)?.error?.message || `OpenAI error ${res.status}`);
        }
        const data = await res.json();
        replyText = data.choices?.[0]?.message?.content || '…';

      // ── Gemini — C5 fix: key in header, not URL ───────
      } else if (provider === 'gemini') {
        const model = settings.geminiModel || 'gemini-1.5-flash';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
        // Gemini uses a different format — prepend system as a user turn
        const geminiContents = [
          { role: 'user', parts: [{ text: `[SYSTEM CONTEXT]\n${systemPrompt}\n[/SYSTEM CONTEXT]\n\nUnderstood. I am the AI Assistant for this store.` }] },
          { role: 'model', parts: [{ text: 'Understood! I\'m ready to help.' }] },
          ...historyForApi.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          })),
        ];
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': settings.geminiApiKey || '',
          },
          signal,
          body: JSON.stringify({ contents: geminiContents }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as any)?.error?.message || `Gemini error ${res.status}`);
        }
        const data = await res.json();
        replyText = data.candidates?.[0]?.content?.parts?.[0]?.text || '…';

      // ── Custom / OpenAI-compatible — C4 fix: validate URL ──
      } else if (provider === 'custom') {
        // Validate URL before fetching. Refuse non-HTTPS or malformed endpoints
        // to prevent accidentally leaking the key + store context over http.
        const customUrl = (settings.customAiUrl || '').trim();
        let parsedUrl: URL;
        try {
          parsedUrl = new URL(customUrl);
        } catch {
          throw new Error(t('ai.invalidUrl'));
        }
        if (parsedUrl.protocol !== 'https:') {
          throw new Error(t('ai.httpsRequired'));
        }
        const res = await fetch(customUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${settings.customAiKey}`,
          },
          signal,
          body: JSON.stringify({
            model: settings.customAiModel || undefined,
            max_tokens: 1024,
            messages: [
              { role: 'system', content: systemPrompt },
              ...historyForApi,
            ],
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as any)?.error?.message || `API error ${res.status}`);
        }
        const data = await res.json();
        replyText = data.choices?.[0]?.message?.content || data.content?.[0]?.text || '…';
      }

      const assistantMsg: Message = { id: genId(), role: 'assistant', content: replyText, timestamp: Date.now() };
      const finalMessages = [...nextMessages, assistantMsg];
      messagesRef.current = finalMessages;
      setMessages(finalMessages);
      saveHistory(finalMessages);
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error('AI error:', err);
      setError(err.message || 'Unknown error');
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [loading, hasApiKey, locale, settings]);

  const handleSubmit = () => sendMessage(input);
  const handleQuickPrompt = (prompt: string) => sendMessage(prompt);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // ── Render ────────────────────────────────────────────

  return (
    <>
      {/* Sliding Panel — no backdrop, app stays fully interactive underneath */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: showAIAssistant ? 0 : '-420px',
          width: '420px',
          height: '100vh',
          background: 'linear-gradient(180deg, #0f172a 0%, #1a1f35 100%)',
          borderLeft: '1px solid rgba(102,126,234,0.2)',
          zIndex: 1001,
          display: 'flex',
          flexDirection: 'column',
          transition: 'right 0.3s cubic-bezier(0.4,0,0.2,1)',
          boxShadow: showAIAssistant ? '-8px 0 32px rgba(0,0,0,0.4)' : 'none',
          // When closed, make sure the hidden panel can't swallow clicks
          pointerEvents: showAIAssistant ? 'auto' : 'none',
        }}
      >
        {/* ── Header ──────────────────────────────────────── */}
        <div style={{
          padding: '1rem 1.25rem',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          flexShrink: 0,
        }}>
          <div style={{
            width: '36px', height: '36px', borderRadius: '50%',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.1rem', flexShrink: 0,
          }}>
            🤖
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: '#fff', fontSize: '0.95rem' }}>
              AI Assistant
            </div>
            <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
              {hasApiKey
                ? `Connected · ${providerLabel}`
                : t('ai.noApiKey')}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            {messages.length > 0 && (
              <button
                onClick={handleClear}
                title={t('ai.clearHistory')}
                style={{
                  background: 'transparent', border: 'none', color: '#475569',
                  cursor: 'pointer', padding: '0.35rem', borderRadius: '6px',
                  fontSize: '0.75rem', display: 'flex', alignItems: 'center',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#94a3b8')}
                onMouseLeave={(e) => (e.currentTarget.style.color = '#475569')}
              >
                🗑️
              </button>
            )}
            <button
              onClick={handleClose}
              style={{
                background: 'transparent', border: 'none', color: '#475569',
                cursor: 'pointer', padding: '0.35rem', borderRadius: '6px',
                display: 'flex', alignItems: 'center', transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#94a3b8')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#475569')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* ── No API Key banner ──────────────────────────── */}
        {!hasApiKey && (
          <div style={{
            margin: '0.75rem', padding: '0.875rem',
            background: 'rgba(251,191,36,0.08)',
            border: '1px solid rgba(251,191,36,0.25)',
            borderRadius: '0.75rem', fontSize: '0.8rem', color: '#fbbf24',
            display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
          }}>
            <span style={{ fontSize: '1rem', flexShrink: 0 }}>⚠️</span>
            <span>
              {t('ai.setupBannerPre')}
              {' '}
              <strong style={{ color: '#fcd34d' }}>
                {t('ai.settingsPath')}
              </strong>.
            </span>
          </div>
        )}

        {/* ── Proactive Insights ─────────────────────────── */}
        {insights.length > 0 && (
          <div style={{ padding: '0.75rem 0.875rem 0', flexShrink: 0 }}>
            <div style={{ fontSize: '0.65rem', color: '#475569', fontWeight: 700, letterSpacing: '0.06em', marginBottom: '0.4rem' }}>
              {t('ai.attention')}
            </div>
            {insights.map((ins) => (
              <InsightCard key={ins.id} insight={ins} onAction={handleInsightAction} />
            ))}
          </div>
        )}

        {/* ── Messages ───────────────────────────────────── */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '0.875rem',
          display: 'flex',
          flexDirection: 'column',
        }}>
          {/* Empty state */}
          {messages.length === 0 && (
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              textAlign: 'center', color: '#475569', padding: '1.5rem',
            }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem', opacity: 0.6 }}>🤖</div>
              <p style={{ fontSize: '0.9rem', fontWeight: 600, color: '#64748b', marginBottom: '0.4rem' }}>
                {t('ai.greeting')}
              </p>
              <p style={{ fontSize: '0.8rem', lineHeight: 1.5 }}>
                {t('ai.greetingSub')}
              </p>
            </div>
          )}

          {/* Message list */}
          {messages.map((msg) => (
            <MessageBubble key={msg.id} msg={msg} />
          ))}

          {/* Typing indicator */}
          {loading && <TypingIndicator />}

          {/* Error */}
          {error && (
            <div style={{
              background: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: '0.625rem', padding: '0.625rem 0.875rem',
              fontSize: '0.8rem', color: '#fca5a5', marginBottom: '0.5rem',
            }}>
              ⚠️ {error}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* ── Quick Prompts ──────────────────────────────── */}
        {showQuickPrompts && messages.length === 0 && (
          <div style={{ padding: '0 0.875rem 0.5rem', flexShrink: 0 }}>
            <div style={{ fontSize: '0.65rem', color: '#475569', fontWeight: 700, letterSpacing: '0.06em', marginBottom: '0.4rem' }}>
              {t('ai.quickPrompts')}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              {quickPrompts.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => handleQuickPrompt(prompt)}
                  disabled={!hasApiKey || loading}
                  style={{
                    textAlign: 'left', padding: '0.45rem 0.625rem',
                    background: 'rgba(102,126,234,0.07)',
                    border: '1px solid rgba(102,126,234,0.15)',
                    borderRadius: '0.5rem', color: '#94a3b8',
                    cursor: hasApiKey ? 'pointer' : 'not-allowed',
                    fontSize: '0.78rem', lineHeight: 1.4, transition: 'all 0.15s',
                    opacity: hasApiKey ? 1 : 0.5,
                  }}
                  onMouseEnter={(e) => {
                    if (hasApiKey) {
                      (e.currentTarget as HTMLElement).style.background = 'rgba(102,126,234,0.15)';
                      (e.currentTarget as HTMLElement).style.color = '#c7d2fe';
                    }
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = 'rgba(102,126,234,0.07)';
                    (e.currentTarget as HTMLElement).style.color = '#94a3b8';
                  }}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Input Area ─────────────────────────────────── */}
        <div style={{
          padding: '0.75rem',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          flexShrink: 0,
        }}>
          <div style={{
            display: 'flex',
            gap: '0.5rem',
            alignItems: 'flex-end',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '0.875rem',
            padding: '0.5rem 0.5rem 0.5rem 0.875rem',
            transition: 'border-color 0.2s',
          }}
            onFocusCapture={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = 'rgba(102,126,234,0.5)';
            }}
            onBlurCapture={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.1)';
            }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                hasApiKey
                  ? t('ai.placeholder')
                  : t('ai.placeholderNoKey')
              }
              disabled={!hasApiKey || loading}
              rows={1}
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: '#e2e8f0',
                fontSize: '0.875rem',
                lineHeight: 1.5,
                resize: 'none',
                maxHeight: '120px',
                overflow: 'auto',
                fontFamily: 'inherit',
              }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = 'auto';
                el.style.height = Math.min(el.scrollHeight, 120) + 'px';
              }}
            />
            <button
              onClick={loading ? () => { abortRef.current?.abort(); setLoading(false); } : handleSubmit}
              disabled={(!input.trim() && !loading) || !hasApiKey}
              style={{
                width: '32px', height: '32px', borderRadius: '50%', border: 'none',
                background: loading
                  ? 'rgba(239,68,68,0.3)'
                  : input.trim() && hasApiKey
                    ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
                    : 'rgba(255,255,255,0.05)',
                color: input.trim() || loading ? '#fff' : '#475569',
                cursor: (input.trim() || loading) && hasApiKey ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, transition: 'all 0.2s', fontSize: '0.85rem',
              }}
            >
              {loading ? '⏹' : '↑'}
            </button>
          </div>
          <div style={{ fontSize: '0.62rem', color: '#334155', marginTop: '0.35rem', textAlign: 'center' }}>
            {t('ai.shiftEnter')}
            {messages.length > 0 && ` • ${messages.length} ${t('ai.messages')}`}
          </div>
        </div>
      </div>
    </>
  );
}
