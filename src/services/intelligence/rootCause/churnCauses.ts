// R-INTEL-PHASE2D-RC: customer churn root cause detector
// For each customer inactive 60+ days within the last 90-day window,
// classifies WHY they stopped coming: lost_habit, price_sensitivity,
// one_time, or mixed. Returns sorted array (longest inactive first).
import type { Customer, Sale } from '@/store/types';
import type { ChurnRootCauseReport, ActionItem } from '../types';
import { getDaysAgo } from '../utils/dateHelpers';

const CHURN_WINDOW_DAYS   = 90;   // analysis window
const INACTIVE_DAYS       = 60;   // must be absent this long to qualify
const CONFIDENCE_VISITS   = 5;    // visits needed for full confidence
const TICKET_DROP_PCT     = 0.85; // <85% of prior avg = decreasing ticket

const LOST_HABIT_ACTIONS: ActionItem[] = [
  { labelKey: 'chat.churn.action.contact_customer',       effort: 'low',    priority: 1, actionType: 'whatsapp',  messageTemplateKey: 'whatsapp.template.reconnect' },
  { labelKey: 'chat.churn.action.send_offer',             effort: 'low',    priority: 2, actionType: 'whatsapp',  messageTemplateKey: 'whatsapp.template.discount' },
  { labelKey: 'chat.churn.action.remind_service',         effort: 'low',    priority: 3, actionType: 'reminder' },
];

const PRICE_SENSITIVITY_ACTIONS: ActionItem[] = [
  { labelKey: 'chat.churn.action.offer_discount',         effort: 'low',    priority: 1, actionType: 'discount' },
  { labelKey: 'chat.churn.action.bundle_offer',           effort: 'medium', priority: 2, actionType: 'bundle' },
  { labelKey: 'chat.churn.action.review_pricing',         effort: 'low',    priority: 3, actionType: 'review' },
];

const ONE_TIME_ACTIONS: ActionItem[] = [
  { labelKey: 'chat.churn.action.first_return_incentive', effort: 'low',    priority: 1, actionType: 'whatsapp',  messageTemplateKey: 'whatsapp.template.discount' },
  { labelKey: 'chat.churn.action.educate_customer',       effort: 'medium', priority: 2, actionType: 'reminder' },
];

const MIXED_ACTIONS: ActionItem[] = [
  { labelKey: 'chat.churn.action.contact_customer',       effort: 'low',    priority: 1, actionType: 'whatsapp',  messageTemplateKey: 'whatsapp.template.reconnect' },
  { labelKey: 'chat.churn.action.review_history',         effort: 'low',    priority: 2, actionType: 'review' },
];

export function diagnoseChurn(
  customers: Customer[],
  sales: Sale[],
): ChurnRootCauseReport[] {
  const now           = Date.now();
  const windowStart   = getDaysAgo(CHURN_WINDOW_DAYS);
  const inactiveSince = getDaysAgo(INACTIVE_DAYS);

  const validSales = sales.filter(s => s.status !== 'voided');

  const reports: ChurnRootCauseReport[] = [];

  for (const customer of customers) {
    const custSales = validSales.filter(s =>
      (s.customerId && s.customerId === customer.id) ||
      (!s.customerId && s.customerName === customer.name),
    );

    if (custSales.length === 0) continue;

    // Sorted ascending by date
    const sorted = custSales
      .map(s => ({ ts: new Date(s.createdAt as string).getTime(), total: s.total || 0 }))
      .sort((a, b) => a.ts - b.ts);

    const lastSaleTs = sorted[sorted.length - 1].ts;
    const lastVisitDaysAgo = Math.floor((now - lastSaleTs) / (1000 * 60 * 60 * 24));

    // Must be inactive INACTIVE_DAYS to qualify
    if (lastSaleTs >= inactiveSince.getTime()) continue;

    // Only count visits within CHURN_WINDOW_DAYS
    const windowSales = sorted.filter(s => s.ts >= windowStart.getTime());
    const totalVisits = windowSales.length;
    if (totalVisits === 0) continue;

    // Average gap between consecutive visits (days)
    let avgVisitGapDays = CHURN_WINDOW_DAYS;
    if (windowSales.length >= 2) {
      let gapSum = 0;
      for (let i = 1; i < windowSales.length; i++) {
        gapSum += Math.floor((windowSales[i].ts - windowSales[i - 1].ts) / (1000 * 60 * 60 * 24));
      }
      avgVisitGapDays = Math.round(gapSum / (windowSales.length - 1));
    }

    // Ticket trend: first half avg vs second half avg
    let ticketDecreasing = false;
    if (windowSales.length >= 3) {
      const mid        = Math.floor(windowSales.length / 2);
      const firstHalf  = windowSales.slice(0, mid);
      const secondHalf = windowSales.slice(mid);
      const avgFirst   = firstHalf.reduce((s, x) => s + x.total, 0) / firstHalf.length;
      const avgSecond  = secondHalf.reduce((s, x) => s + x.total, 0) / secondHalf.length;
      ticketDecreasing = avgFirst > 0 && avgSecond < avgFirst * TICKET_DROP_PCT;
    }

    // Diagnosis rules (spec-specified order)
    let diagnosis: ChurnRootCauseReport['diagnosis'];
    let actions: ActionItem[];

    if (totalVisits <= 1) {
      diagnosis = 'one_time';
      actions = ONE_TIME_ACTIONS;
    } else if (avgVisitGapDays > 0 && lastVisitDaysAgo > avgVisitGapDays * 2) {
      diagnosis = 'lost_habit';
      actions = LOST_HABIT_ACTIONS;
    } else if (ticketDecreasing) {
      diagnosis = 'price_sensitivity';
      actions = PRICE_SENSITIVITY_ACTIONS;
    } else {
      diagnosis = 'mixed';
      actions = MIXED_ACTIONS;
    }

    reports.push({
      customerId: customer.id,
      name: customer.name,
      lastVisitDaysAgo,
      avgVisitGapDays,
      totalVisits,
      diagnosis,
      confidence: Math.min(1, totalVisits / CONFIDENCE_VISITS),
      actions,
    });
  }

  // Highest impact first (days inactive × total visits)
  return reports.sort((a, b) => (b.lastVisitDaysAgo * b.totalVisits) - (a.lastVisitDaysAgo * a.totalVisits));
}
