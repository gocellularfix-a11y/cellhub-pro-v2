// ============================================================
// CellHub Pro — Dashboard with Global Search Engine
// Searches: Customers, Inventory, Repairs, Unlocks, Sales,
//           Special Orders, Layaways, Expenses
//
// r-global-search: the global search logic + dropdown was extracted to
// src/components/shared/GlobalSearchBar.tsx so it can also be mounted in
// other modules (Inventory, Customers, Repairs, etc). Dashboard now just
// imports and renders <GlobalSearchBar showTip width="320px" />. Both
// SearchSection and SearchResultBtn helpers moved to that file too.
// ============================================================

import { useState, useMemo, useEffect } from 'react';
import { useApp } from '@/store/AppProvider';
import { useTranslation } from '@/i18n';
import { formatCurrency } from '@/utils/currency';
import { isToday, toDate, formatDate } from '@/utils/dates';
import GlobalSearchBar from '@/components/shared/GlobalSearchBar';
import { loadLocal } from '@/services/storage';
import { DEFAULT_LOW_STOCK_THRESHOLD } from '@/config/constants';
import { REPAIR_STATUS, normalizeRepairStatus } from '@/utils/repairStatus';
import { STATUS_LABELS, PAYMENT_LABELS } from '@/i18n/statusMap';
import { normalizeCarrier } from '@/utils/normalize';
// R-DASHBOARD-PROFIT-RECONCILE-V1: reuse Reports' pseudo-item detection
// + proportional-cost helpers so the Dashboard's profit pipeline applies
// the SAME accounting rules as Reports (no duplicated math).
import {
  isPseudoItem,
  getLayawayProportionalCost,
  getSpecialOrderProportionalCost,
  getRepairProportionalCost,
  getUnlockProportionalCost,
} from '@/modules/reports/ReportsModule';

/** Sale is countable for revenue if not voided/refunded. Handles legacy case variations. */
function isSaleCountable(s: { status?: string }): boolean {
  const st = (s.status || '').toLowerCase();
  return st !== 'voided' && st !== 'refunded';
}

// ── Stat Card Icon ────────────────────────────────────────
function StatIcon({ icon, color }: { icon: string; color: string }) {
  return (
    <div className="stat-icon-circle" style={{
      position: 'absolute', top: '1rem', right: '1rem',
      width: '40px', height: '40px', borderRadius: '50%',
      background: color, display: 'flex', alignItems: 'center',
      justifyContent: 'center', fontSize: '1.1rem',
    }}>
      {icon}
    </div>
  );
}

// r-global-search: SearchSection and SearchResultBtn moved to
// src/components/shared/GlobalSearchBar.tsx — they're sub-components of
// the new shared GlobalSearchBar.

export default function Dashboard() {
  const {
    state: {
      sales, repairs, unlocks, inventory, customers,
      specialOrders, layaways, lang, settings,
    },
    setActiveTab,
  } = useApp();
  const { t } = useTranslation();
  const statusLabels = STATUS_LABELS(t);
  const paymentLabels = PAYMENT_LABELS(t);

  // r-global-search: local `search` state and the 8 match useMemos + goTo
  // navigator + dropdown JSX were all extracted to GlobalSearchBar.tsx.
  // Dashboard now just renders <GlobalSearchBar showTip width="320px" />
  // below in the header — see render section. The component manages its
  // own input state internally in standalone mode.

  // ── Computed Stats ──────────────────────────────────────

  // Tick every 60s to advance time-based alerts (lapsed customers, abandoned repairs,
  // returns logged today) without requiring a sale or other state change.
  // Declared BEFORE derived memos so they can include it in deps for day-boundary refresh.
  const [minuteTick, setMinuteTick] = useState(() => Math.floor(Date.now() / 60000));
  useEffect(() => {
    const id = setInterval(() => setMinuteTick(Math.floor(Date.now() / 60000)), 60000);
    return () => clearInterval(id);
  }, []);

  // Round 21: `minuteTick` in deps so `isToday()` re-evaluates every minute.
  // Without this, a dashboard left open overnight keeps showing yesterday's
  // sales after midnight until a new sale arrives from Firestore.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const todaySales = useMemo(
    () => sales.filter((s) => isSaleCountable(s) && isToday(s.createdAt)),
    [sales, minuteTick],
  );
  const todayRevenue = useMemo(
    () => todaySales.reduce((sum, s) => sum + s.total, 0), [todaySales],
  );

  // Today's returns (in CENTS, integer). Reads from localStorage where the
  // schema stores refund amounts as DOLLARS (legacy fields refundAmount/amount,
  // current field `total` from ReturnsModule). All converted to cents here.
  const todayReturnsCents = useMemo(() => {
    try {
      const all = loadLocal<any[]>('customer_returns', []);
      return (all || [])
        .filter((r) => r && r.createdAt && isToday(r.createdAt))
        .reduce((sum, r) => {
          // CustomerReturn.total is always DOLLARS (per types.ts).
          // Convert to cents for consistency with the rest of Dashboard.
          const val = (r.total ?? r.refundAmount ?? r.amount ?? 0) as number;
          return sum + Math.round(val * 100);
        }, 0);
    } catch {
      return 0;
    }
  }, [todaySales, minuteTick]);

  // Gross profit IN CENTS. item.price/cost stored in cents.
  //
  // Round 21 fixes:
  //   BUG 1: Added sale.creditCardFee as 100%-margin profit. After round 15
  //   creditCardFee is a top-level Sale field (not a line item), and Dashboard
  //   never summed it. CC fee is a pure pass-through surcharge — the processor
  //   collects it, so it's 100% profit to the shop.
  //
  //   BUG 2: Removed the item.name.includes('fee'|'tax'|'surcharge'|'cbe')
  //   filter. It was a LEGACY workaround from when tax/CBE/CC fee were line
  //   items in the cart. Post-v2 they are all top-level Sale fields (taxAmount,
  //   cbeTotal, screenFeeTotal, creditCardFee), never in sale.items. The filter
  //   only created false positives with legitimate products that happened to
  //   contain those substrings ("Screen Protector Fee", "Setup Fee", etc.).
  //
  // We still exclude `service`, `phone_payment`, and `activation` categories
  // from profit because those are commission/fee-based (phone payments) or
  // price=cost labor (services) — counting them in margin math inflates profit
  // or double-counts commission income tracked elsewhere.
  // R-DASHBOARD-PROFIT-COMMISSION: phone_payment items must use commission
  // lookup (mirrors ReportsModule L672-710) — they ship from PhonePaymentModal
  // with cost=undefined, so (price-cost) treated 100% as margin which inflates
  // Dashboard profit by ~10x for typical carrier rates. Replicated logic:
  //   1) Trust transaction-time stamped item.commissionRate first.
  //   2) Else resolve carrier: item.carrier → name regex → known-carrier regex.
  //   3) commRate = settings.carrierCommissions[normalized] ?? defaultCommissionRate ?? 0.
  //   4) profit = revenue × commRate (Reports: cost = revenue × (1-commRate)).
  // Strict rule: if no commission resolvable → that item's profit = 0
  // (NO 0.07 fallback — refuse to fabricate profit).
  // R-DASHBOARD-PROFIT-RECONCILE-V1: precomputed entity Maps so per-item
  // proportional-cost lookups are O(1). Built once per source array
  // change — no per-render scans.
  const layawaysById       = useMemo(() => new Map((layaways || []).map((l) => [l.id, l])), [layaways]);
  const specialOrdersById  = useMemo(() => new Map((specialOrders || []).map((o) => [o.id, o])), [specialOrders]);
  const repairsById        = useMemo(() => new Map((repairs || []).map((r) => [r.id, r])), [repairs]);
  const unlocksById        = useMemo(() => new Map((unlocks || []).map((u) => [u.id, u])), [unlocks]);

  const todayProfitGross = useMemo(
    () => todaySales.reduce((sum, s) => {
      const itemProfit = (s.items || []).reduce((p, item) => {
        const qty = item.qty || (item as any).quantity || 1;
        const revenueCents = (item.price || 0) * qty;
        const cat = (item.category || '').toLowerCase();

        if (cat === 'phone_payment') {
          let commRate = (item as any).commissionRate;
          if (commRate == null || commRate === 0) {
            let rawCarrier = ((item as any).carrier || (item as any).carrierName || (item as any).provider || '').trim();
            if (!rawCarrier && item.name) {
              const m = String(item.name).match(/^([A-Za-z0-9\s&]+?)(?:\s*[-–]\s*|\s+Bill Payment)/i);
              if (m) rawCarrier = m[1].trim();
            }
            if (!rawCarrier && item.name) {
              const km = String(item.name).match(
                /\b(h2o|t-?mobile|verizon|at&?t|cricket|tracfone|page\s*plus|simple\s*mobile|ultra(?:\s+mobile)?|telcel|boost|metro(?:\s*pcs)?|mint\s*mobile|visible)\b/i,
              );
              if (km) rawCarrier = km[1].trim();
            }
            const normalized = normalizeCarrier(rawCarrier);
            // R-DASHBOARD-CARRIER-COMMISSION-LOOKUP-FIX: settings keys are
            // Title Case ("AT&T", "Simple Mobile", "H2O") so a normalized-only
            // lookup misses when normalizeCarrier returns different casing or
            // spacing. Try raw → normalized → case-insensitive → default → 0.
            const ccs: Record<string, number> = settings.carrierCommissions || {};
            let carrierRate: number | undefined;
            if (rawCarrier && typeof ccs[rawCarrier] === 'number') carrierRate = ccs[rawCarrier];
            if (carrierRate == null && normalized && typeof ccs[normalized] === 'number') carrierRate = ccs[normalized];
            if (carrierRate == null) {
              const needle = (rawCarrier || normalized || '').toLowerCase();
              if (needle) {
                const hit = Object.keys(ccs).find((k) => k.toLowerCase() === needle);
                if (hit && typeof ccs[hit] === 'number') carrierRate = ccs[hit];
              }
            }
            commRate = carrierRate ?? settings.defaultCommissionRate ?? 0;
          }
          if (!commRate) return p;
          const costCents = Math.round(revenueCents * (1 - commRate));
          return p + (revenueCents - costCents);
        }

        // R-DASHBOARD-PROFIT-RECONCILE-V1: pseudo-item branch. Mirrors
        // ReportsModule lines 839-863. Layaway/Repair/SO/Unlock Deposit
        // and Balance pseudo-items ship with cost=0 → without this branch
        // they trivially booked 100% margin and inflated dashboard profit.
        // When the linked entity has reliable cost+price data, inherit
        // a proportional slice (payment / totalPrice * totalCost). When
        // the helper returns 0 (missing cost data), the pseudo-item is
        // EXCLUDED from profit (matches Reports' Round 10 fix 3 — they
        // contribute to revenue display only, not to margin numerator).
        if (isPseudoItem(item)) {
          let realCost = 0;
          if (item.layawayId) {
            const linked = layawaysById.get(item.layawayId);
            if (linked) realCost = getLayawayProportionalCost(linked, inventory, revenueCents);
          } else if (item.specialOrderId) {
            const linked = specialOrdersById.get(item.specialOrderId);
            if (linked) realCost = getSpecialOrderProportionalCost(linked, inventory, revenueCents);
          } else if (item.repairId) {
            const linked = repairsById.get(item.repairId);
            if (linked) realCost = getRepairProportionalCost(linked, inventory, revenueCents);
          } else if (item.unlockId) {
            const linked = unlocksById.get(item.unlockId);
            if (linked) realCost = getUnlockProportionalCost(linked, inventory, revenueCents);
          }
          if (realCost > 0) {
            return p + (revenueCents - realCost);
          }
          return p; // pseudo-item with no recoverable cost — exclude from profit
        }

        // R-DASHBOARD-PROFIT-RECONCILE-V1: layaway-linked NON-pseudo items
        // also use proportional cost (mirrors Reports lines 812-821). Cart
        // lines tied to a layaway often ship with cost=undefined; without
        // this they'd book 100% margin too.
        if (item.layawayId) {
          const linked = layawaysById.get(item.layawayId);
          if (linked) {
            const proportional = getLayawayProportionalCost(linked, inventory, revenueCents);
            if (proportional > 0) {
              return p + (revenueCents - proportional);
            }
          }
        }

        return p + (revenueCents - (item.cost || 0) * qty);
      }, 0);
      // CC fee is 100% margin — add directly to sum (no cost to deduct).
      return sum + itemProfit + (s.creditCardFee || 0);
    }, 0), [todaySales, settings, inventory, layawaysById, specialOrdersById, repairsById, unlocksById],
  );

  // Subtotal of ONLY profit-generating items + CC fee (apples-to-apples with
  // todayProfitGross). Used for marginRatio AND for the displayed margin %.
  // Round 21: name-based filter removed (see todayProfitGross). CC fee added
  // to denominator to match the numerator so ratio stays consistent.
  const todayProfitableSubtotal = useMemo(
    () => todaySales.reduce((sum, s) => {
      const lineTotal = (s.items || []).reduce((p, item) => {
        return p + (item.price || 0) * (item.qty || (item as any).quantity || 1);
      }, 0);
      return sum + lineTotal + (s.creditCardFee || 0);
    }, 0), [todaySales],
  );

  // R-DASHBOARD-PROFIT-PARITY Fix 2: standalone repairs completed today,
  // not already counted via POS sale items (mirrors Reports' isRepairCompleted
  // + repairsAlreadyInSales filter for true parity with totalProfitCents).
  const todayRepairProfit = useMemo(() => {
    const inSales = new Set<string>();
    for (const sale of todaySales) {
      for (const item of (sale.items || [])) {
        if ((item as any).repairId) inSales.add((item as any).repairId);
      }
    }
    return repairs.reduce((sum, r) => {
      const status = String(r.status || '').toLowerCase();
      const completedStatuses = ['complete', 'completed', 'picked_up', 'pickedup'];
      if (!completedStatuses.includes(status)) return sum;
      if ((r.balance ?? 0) !== 0) return sum;
      if (!isToday(r.completedAt)) return sum;
      if (inSales.has(r.id)) return sum;

      const rev = r.total ?? r.estimatedCost ?? 0;
      const partsCost = (r.parts || []).reduce(
        (p, part) => p + ((part.cost || 0) * (part.qty || 1)),
        0,
      );
      const labor = r.laborCost || 0;
      // 0.35 fallback ratio matches REPAIR_COST_FALLBACK in ReportsModule.tsx.
      const cost = (partsCost + labor) > 0
        ? (partsCost + labor)
        : Math.round(rev * 0.35);
      return sum + (rev - cost);
    }, 0);
  }, [repairs, todaySales]);

  // R-DASHBOARD-PROFIT-PARITY Fix 3: standalone unlocks completed today,
  // not already counted via POS sale items (mirrors Reports' isUnlockCompleted
  // + unlocksAlreadyInSales filter — note unlocks check both item.unlockId
  // and item.meta?.unlockId per Reports L444-455).
  const todayUnlockProfit = useMemo(() => {
    const inSales = new Set<string>();
    for (const sale of todaySales) {
      for (const item of (sale.items || [])) {
        if ((item as any).unlockId) inSales.add((item as any).unlockId);
        const metaUnlockId = (item as unknown as { meta?: { unlockId?: string } }).meta?.unlockId;
        if (metaUnlockId) inSales.add(metaUnlockId);
      }
    }
    return unlocks.reduce((sum, u) => {
      const status = String(u.status || '').toLowerCase();
      if (status !== 'completed' && status !== 'complete') return sum;
      if (!isToday(u.completedAt)) return sum;
      if (inSales.has(u.id)) return sum;
      return sum + ((u.price || 0) - (u.cost || 0));
    }, 0);
  }, [unlocks, todaySales]);

  // Subtract today's refunds from profit proportionally.
  // ALL values in cents — no unit mismatch. No outer Math.round (formatCurrency handles display).
  // Round 21: marginRatio clamped to [0, 1]. Without the clamp, a day where
  // Jorge sells loss-leaders (cost > price, negative margin) + has a refund
  // causes profit to INCREASE when a loss-item is refunded — double negative
  // produces a positive. Clamping floors the ratio at 0 in loss scenarios.
  const rawRatio = todayProfitableSubtotal > 0 ? (todayProfitGross / todayProfitableSubtotal) : 0;
  const marginRatio = Math.max(0, Math.min(1, rawRatio));
  // R-DASHBOARD-PROFIT-PARITY Fix 4: include standalone repair + unlock profit.
  const todayProfit = todayProfitGross + todayRepairProfit + todayUnlockProfit
    - Math.round(todayReturnsCents * marginRatio);

  // Profit margin on PROFITABLE subtotal (apples-to-apples with profit calc).
  const profitMargin = todayProfitableSubtotal > 0 ? ((todayProfit / todayProfitableSubtotal) * 100).toFixed(1) : '0.0';

  const normStatus = (s: string) => s.toLowerCase().replace(/ /g, '_');
  // Round R2: canonical repair done-bucket (picked_up/cancelled); ready stays "active" here.
  // R-EDIT-AUDIT: 'refunded' is terminal; 'refund_pending' stays active until Mark Refunded.
  const DONE_REPAIRS: string[] = [REPAIR_STATUS.PICKED_UP, REPAIR_STATUS.CANCELLED, REPAIR_STATUS.REFUNDED];
  const DONE_UNLOCKS = ['completed', 'cancelled', 'failed', 'refunded'];

  const activeRepairs = useMemo(
    () => repairs.filter((r) => !DONE_REPAIRS.includes(normalizeRepairStatus(r.status))),
    [repairs],
  );
  const readyRepairs = useMemo(
    () => repairs.filter((r) => normalizeRepairStatus(r.status) === REPAIR_STATUS.READY),
    [repairs],
  );
  const activeUnlocks = useMemo(
    () => unlocks.filter((u) => !DONE_UNLOCKS.includes(normStatus(u.status))),
    [unlocks],
  );
  // Round 21: non-physical categories (phone_payment, activation, topup) also
  // excluded from low-stock alerts — they're virtual products without real
  // stock. Without this, every phone_payment "product" showed up as low stock
  // because qty=0 by design.
  const NON_STOCKED_CATEGORIES = new Set([
    'service', 'services', 'servicio', 'servicios',
    'phone_payment', 'activation',
    'top_up', 'topup', 'top-up',
  ]);
  const lowStockItems = useMemo(
    () => inventory.filter((i) => {
      const threshold = settings.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
      const cat = (i.category || '').toLowerCase();
      if (NON_STOCKED_CATEGORIES.has(cat)) return false;
      // Exclude negative qty (data corruption from oversells) — those are a different problem
      return i.qty >= 0 && i.qty <= threshold;
    }),
    [inventory, settings.lowStockThreshold],
  );
  // Round 21: minuteTick in deps for day-boundary refresh (see todaySales comment)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const newCustomersToday = useMemo(
    () => customers.filter((c) => isToday(c.createdAt)), [customers, minuteTick],
  );

  // ── Follow-up alerts ────────────────────────────────────
  const DAYS_30 = 30 * 24 * 60 * 60 * 1000;
  // `now` is fresh on every render. Re-renders are triggered by `minuteTick`
  // (60s setInterval), so date-based alerts advance even on idle dashboards.
  // The downstream useMemos depend on `minuteTick` directly.
  const now = Date.now();

  // Customers who haven't visited in 30+ days
  const lapsedCustomers = useMemo(() => customers.filter((c) => {
    const last = c.updatedAt
      ? new Date(c.updatedAt as string).getTime()
      : new Date(c.createdAt as string).getTime();
    return (now - last) > DAYS_30;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [customers, minuteTick]);

  // Layaways past due date with balance still owed
  const overdueLayaways = useMemo(() => layaways.filter((l) => {
    if (l.status !== 'active' || (l.balance || 0) <= 0) return false;
    if (!l.dueDate) return false;
    return new Date(l.dueDate).getTime() < now;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [layaways, minuteTick]);

  // Special orders where customer hasn't picked up (status=ready for 7+ days)
  const unpickedOrders = useMemo(() => specialOrders.filter((o) => {
    if (normStatus(o.status || '') !== 'ready') return false;
    const updated = o.updatedAt
      ? new Date(o.updatedAt as string).getTime()
      : new Date(o.createdAt as string).getTime();
    return (now - updated) > 7 * 24 * 60 * 60 * 1000;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [specialOrders, minuteTick]);

  // Repairs ready but not picked up for 3+ days
  const abandonedRepairs = useMemo(() => repairs.filter((r) => {
    // Round R2: canonical comparison — 'complete' folds into PICKED_UP via normalizer.
    const st = normalizeRepairStatus(r.status || '');
    if (st !== REPAIR_STATUS.PICKED_UP && st !== REPAIR_STATUS.READY) return false;
    const updated = r.updatedAt
      ? new Date(r.updatedAt as string).getTime()
      : new Date(r.createdAt as string).getTime();
    return (now - updated) > 3 * 24 * 60 * 60 * 1000;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [repairs, minuteTick]);

  // Recent activity
  const recentRepairs = useMemo(
    () => [...repairs]
      .filter((r) => normalizeRepairStatus(r.status || '') !== REPAIR_STATUS.CANCELLED)
      .sort((a, b) => toDate(b.createdAt).getTime() - toDate(a.createdAt).getTime()).slice(0, 5),
    [repairs],
  );
  const recentSales = useMemo(
    () => [...sales].filter((s) => isSaleCountable(s))
      .sort((a, b) => toDate(b.createdAt).getTime() - toDate(a.createdAt).getTime()).slice(0, 5),
    [sales],
  );

  // Inventory stats
  // Retail value = what you'd earn if you sold everything at sticker price.
  // Cost value = what you paid for it (for tax/accounting).
  const totalInventoryRetail = useMemo(
    () => inventory.reduce((sum, i) => sum + i.price * i.qty, 0), [inventory],
  );
  const totalInventoryCost = useMemo(
    () => inventory.reduce((sum, i) => sum + ((i as any).cost || 0) * i.qty, 0), [inventory],
  );
  const totalItemsInStock = useMemo(
    () => inventory.reduce((sum, i) => sum + i.qty, 0), [inventory],
  );
  const avgSaleValue = todaySales.length > 0 ? todayRevenue / todaySales.length : 0;

  // r-global-search: 7 match useMemos (customerMatches, inventoryMatches,
  // repairMatches, unlockMatches, saleMatches, specialOrderMatches,
  // layawayMatches), totalResults, and the goTo navigator were all extracted
  // to GlobalSearchBar.tsx. The component now adds an 8th: expenseMatches.

  return (
    <div>
      {/* ── Header Row ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
        <div>
          <h2 style={{ fontSize: '1.875rem', fontWeight: 700, marginBottom: '0.25rem' }}>
            {t('dashboard')}
          </h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            {new Date().toLocaleDateString(lang === 'es' ? 'es-MX' : lang === 'pt' ? 'pt-BR' : 'en-US', {
              weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
            })}
          </p>
        </div>

        {/* Search — top-right with + button */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
          <button
            className="btn btn-primary"
            style={{
              width: '42px', height: '42px', padding: 0, borderRadius: '50%',
              fontSize: '1.25rem', display: 'flex', alignItems: 'center',
              justifyContent: 'center', flexShrink: 0,
            }}
            onClick={() => setActiveTab('pos')}
            title={t('dashboard.newSale')}
          >
            +
          </button>
          {/* r-global-search: replaced 100+ lines of inline SearchInput +
              dropdown JSX with the shared GlobalSearchBar component.
              Standalone mode (no localValue/onLocalChange) — Dashboard
              doesn't have its own list to filter. */}
          <GlobalSearchBar showTip width="320px" />
        </div>
      </div>

      {/* ── Stat Cards — 6 cards with icons ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '1rem', marginBottom: '1rem' }}>
        <div className="stat-card" data-kpi="green" style={{ cursor: 'pointer' }} onClick={() => setActiveTab('reports')}>
          <StatIcon icon="💲" color="rgba(34, 197, 94, 0.2)" />
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', letterSpacing: '0.02em' }}>
            {t('todaysSales')}
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.5rem' }}>
            {formatCurrency(todayRevenue)}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            {todaySales.length} {t('transactions')}
          </div>
        </div>

        <div className="stat-card" data-kpi="teal" title={todayReturnsCents > 0
          ? t('dashboard.refundsTooltip', formatCurrency(todayReturnsCents))
          : undefined}>
          <StatIcon icon="📈" color="rgba(34, 197, 94, 0.2)" />
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', letterSpacing: '0.02em' }}>
            {t('estimatedGrossProfit')}
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: todayProfit >= 0 ? '#34d399' : '#f87171', marginTop: '0.5rem' }}>
            {formatCurrency(todayProfit)}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            {/* Clamp visual margin display: showing -1500% is meaningless when refunds dwarf today's sales */}
            {Math.abs(parseFloat(profitMargin)) > 999 ? '—' : `${profitMargin}%`} {t('dashboard.margin')}
            {todayReturnsCents > 0 && (
              <span style={{ marginLeft: '0.4rem', color: '#fbbf24', fontSize: '0.7rem' }}>
                ⚠ {t('dashboard.includesRefunds')}
              </span>
            )}
          </div>
        </div>

        <div className="stat-card" data-kpi="orange" style={{ cursor: 'pointer' }} onClick={() => setActiveTab('repairs')}>
          <StatIcon icon="🔧" color="rgba(249, 115, 22, 0.2)" />
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', letterSpacing: '0.02em' }}>
            {t('activeRepairs')}
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#f97316', marginTop: '0.5rem' }}>
            {activeRepairs.length}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            {readyRepairs.length} {t('readyForPickup')}
          </div>
        </div>

        <div className="stat-card" data-kpi="red" style={{ cursor: 'pointer' }} onClick={() => setActiveTab('inventory')}>
          <StatIcon icon="⚠️" color="rgba(239, 68, 68, 0.2)" />
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', letterSpacing: '0.02em' }}>
            {t('lowStock')}
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: lowStockItems.length > 0 ? '#ef4444' : '#34d399', marginTop: '0.5rem' }}>
            {lowStockItems.length}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            {t('needRestock')}
          </div>
        </div>

        <div className="stat-card" data-kpi="pink" style={{ cursor: 'pointer' }} onClick={() => setActiveTab('customers')}>
          <StatIcon icon="👥" color="rgba(236, 72, 153, 0.2)" />
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', letterSpacing: '0.02em' }}>
            {t('totalCustomers')}
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.5rem' }}>
            {customers.length}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            {newCustomersToday.length} {t('newToday')}
          </div>
        </div>

        <div className="stat-card" data-kpi="violet" style={{ cursor: 'pointer' }} onClick={() => setActiveTab('unlocks')}>
          <StatIcon icon="🔓" color="rgba(139, 92, 246, 0.2)" />
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', letterSpacing: '0.02em' }}>
            {t('activeUnlocks')}
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#a78bfa', marginTop: '0.5rem' }}>
            {activeUnlocks.length}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            {unlocks.filter((u) => normStatus(u.status || '') === 'code_received').length} {t('codesReceived')}
          </div>
        </div>
      </div>

      {/* ── Low Stock Alert Banner ── */}
      {lowStockItems.length > 0 && (
        <div
          onClick={() => setActiveTab('inventory')}
          style={{
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: '0.75rem',
            padding: '0.875rem 1rem',
            marginBottom: '1rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '1rem',
            cursor: 'pointer',
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.12)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.08)'; }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f87171', marginBottom: '0.4rem' }}>
              ⚠️ {t('dashboard.lowStockBannerTitle')}
              {' — '}
              {lowStockItems.length}{' '}
              {t('dashboard.lowStockItemsPlural', lowStockItems.length)}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
              {lowStockItems.slice(0, 5).map((i) => (
                <span key={i.id} style={{
                  fontSize: '0.72rem',
                  padding: '0.2rem 0.5rem',
                  background: 'rgba(239,68,68,0.12)',
                  border: '1px solid rgba(239,68,68,0.2)',
                  borderRadius: '0.375rem',
                  color: '#fca5a5',
                }}>
                  {i.name} <span style={{ color: 'var(--text-secondary)' }}>· {i.qty}</span>
                </span>
              ))}
              {lowStockItems.length > 5 && (
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  +{lowStockItems.length - 5} {t('dashboard.more')}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); setActiveTab('inventory'); }}
            style={{
              fontSize: '0.72rem',
              padding: '0.35rem 0.75rem',
              background: 'rgba(239,68,68,0.15)',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: '0.375rem',
              color: '#f87171',
              cursor: 'pointer',
              flexShrink: 0,
              fontWeight: 600,
            }}
          >
            {t('dashboard.viewInventory')}
          </button>
        </div>
      )}

      {/* ── Follow-up Alerts ── */}
      {(lapsedCustomers.length > 0 || overdueLayaways.length > 0 || unpickedOrders.length > 0 || abandonedRepairs.length > 0) && (
        <div style={{ marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>

          {/* Abandoned repairs — ready 3+ days */}
          {abandonedRepairs.length > 0 && (
            <div style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '0.75rem', padding: '0.875rem 1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f87171', marginBottom: '0.4rem' }}>
                    🔧 {t('dashboard.abandonedRepairs', abandonedRepairs.length)}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                    {abandonedRepairs.slice(0, 5).map((r) => (
                      <span key={r.id} style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '0.375rem', color: '#fca5a5' }}>
                        {r.customerName} — {r.device}
                      </span>
                    ))}
                    {abandonedRepairs.length > 5 && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>+{abandonedRepairs.length - 5} {t('dashboard.more')}</span>}
                  </div>
                </div>
                <button onClick={() => setActiveTab('repairs')} style={{ fontSize: '0.72rem', padding: '0.35rem 0.75rem', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '0.375rem', color: '#f87171', cursor: 'pointer', flexShrink: 0, fontWeight: 600 }}>
                  {t('dashboard.viewTickets')}
                </button>
              </div>
            </div>
          )}

          {/* Overdue layaways */}
          {overdueLayaways.length > 0 && (
            <div style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: '0.75rem', padding: '0.875rem 1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#fbbf24', marginBottom: '0.4rem' }}>
                    📅 {t('dashboard.overdueLayaways', overdueLayaways.length)}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                    {overdueLayaways.slice(0, 5).map((l) => (
                      <span key={l.id} style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '0.375rem', color: '#fcd34d' }}>
                        {l.customerName} — {formatCurrency(l.balance)}
                      </span>
                    ))}
                    {overdueLayaways.length > 5 && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>+{overdueLayaways.length - 5} {t('dashboard.more')}</span>}
                  </div>
                </div>
                <button onClick={() => setActiveTab('layaways')} style={{ fontSize: '0.72rem', padding: '0.35rem 0.75rem', background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '0.375rem', color: '#fbbf24', cursor: 'pointer', flexShrink: 0, fontWeight: 600 }}>
                  {t('dashboard.viewLayaways')}
                </button>
              </div>
            </div>
          )}

          {/* Special orders not picked up 7+ days */}
          {unpickedOrders.length > 0 && (
            <div style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: '0.75rem', padding: '0.875rem 1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#fbbf24', marginBottom: '0.4rem' }}>
                    📋 {t('dashboard.unpickedOrders', unpickedOrders.length)}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                    {unpickedOrders.slice(0, 5).map((o) => (
                      <span key={o.id} style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '0.375rem', color: '#fcd34d' }}>
                        {o.customerName} — {formatCurrency(o.balance)}
                      </span>
                    ))}
                    {unpickedOrders.length > 5 && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>+{unpickedOrders.length - 5} {t('dashboard.more')}</span>}
                  </div>
                </div>
                <button onClick={() => setActiveTab('specialOrders')} style={{ fontSize: '0.72rem', padding: '0.35rem 0.75rem', background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '0.375rem', color: '#fbbf24', cursor: 'pointer', flexShrink: 0, fontWeight: 600 }}>
                  {t('dashboard.viewOrders')}
                </button>
              </div>
            </div>
          )}

          {/* Lapsed customers */}
          {lapsedCustomers.length > 0 && (
            <div style={{ background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: '0.75rem', padding: '0.875rem 1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#a5b4fc', marginBottom: '0.4rem' }}>
                    👤 {t('dashboard.lapsedCustomers', lapsedCustomers.length)}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                    {lapsedCustomers.slice(0, 6).map((c) => (
                      <span key={c.id} style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem', background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: '0.375rem', color: '#c7d2fe' }}>
                        {c.name}
                      </span>
                    ))}
                    {lapsedCustomers.length > 6 && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>+{lapsedCustomers.length - 6} {t('dashboard.more')}</span>}
                  </div>
                </div>
                <button onClick={() => setActiveTab('customers')} style={{ fontSize: '0.72rem', padding: '0.35rem 0.75rem', background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: '0.375rem', color: '#a5b4fc', cursor: 'pointer', flexShrink: 0, fontWeight: 600 }}>
                  {t('dashboard.viewCustomers')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Recent Activity — 2 columns ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
        <div className="card" style={{ padding: '1.5rem' }}>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1rem' }}>
            {t('recentRepairTickets')}
          </h3>
          {recentRepairs.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {recentRepairs.map((repair) => (
                <div key={repair.id} style={{
                  padding: '1rem', background: 'var(--bg-input)',
                  borderRadius: '12px', border: '1px solid var(--border-default)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-accent-soft)' }}>
                      {(repair as any).ticketNumber || repair.id.slice(-8).toUpperCase()}
                    </div>
                    {/* Round R2: canonical badge classification. */}
                    <span className={`badge ${(() => {
                      const s = normalizeRepairStatus(repair.status);
                      if (s === REPAIR_STATUS.PICKED_UP || s === REPAIR_STATUS.READY) return 'badge-success';
                      if (s === REPAIR_STATUS.IN_PROGRESS) return 'badge-warning';
                      return 'badge-info';
                    })()}`}>
                      {statusLabels[normalizeRepairStatus(repair.status) as keyof typeof statusLabels] ?? repair.status}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                    {repair.customerName} • {repair.deviceModel || repair.device || ''}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{formatDate(repair.createdAt)}</div>
                    <div style={{ fontWeight: 700, color: '#34d399' }}>{formatCurrency(repair.total || 0)}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
              {t('noRepairTicketsYet')}
            </div>
          )}
        </div>

        <div className="card" style={{ padding: '1.5rem' }}>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1rem' }}>
            {t('recentSales')}
          </h3>
          {recentSales.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {recentSales.map((sale) => (
                <div key={sale.id} style={{
                  padding: '1rem', background: 'var(--bg-input)',
                  borderRadius: '12px', border: '1px solid var(--border-default)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-accent-soft)' }}>
                      {sale.invoiceNumber}
                    </div>
                    <span className="badge badge-info"
                      style={sale.paymentMethod?.toUpperCase() === 'CASH' ? {
                        background: 'rgba(34,197,94,0.2)', color: '#4ade80',
                      } : undefined}
                    >
                      {paymentLabels[(sale.paymentMethod ?? '').toLowerCase() as keyof typeof paymentLabels] ?? sale.paymentMethod?.toUpperCase()}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                    {sale.customerName || t('dashboard.walkIn')} • {sale.items.length} {t('dashboard.itemsCount', sale.items.length)}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{formatDate(sale.createdAt)}</div>
                    <div style={{ fontWeight: 700, color: '#34d399' }}>{formatCurrency(sale.total)}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
              {t('noSalesYet')}
            </div>
          )}
        </div>
      </div>

      {/* ── Quick Stats — 3 equal columns ── */}
      <div className="card" style={{ padding: '1.5rem' }}>
        <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1rem' }}>
          {t('quickStats')}
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0' }}>
          <div style={{ padding: '0.75rem 1rem' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', letterSpacing: '0.05em', marginBottom: '0.35rem', fontWeight: 600 }}>
              {t('dashboard.inventoryValueRetail')}
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {formatCurrency(totalInventoryRetail)}
            </div>
            {totalInventoryCost > 0 && (
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                {t('dashboard.cost')}: {formatCurrency(totalInventoryCost)}
              </div>
            )}
          </div>
          <div style={{ padding: '0.75rem 1rem', borderLeft: '1px solid var(--border-default)', borderRight: '1px solid var(--border-default)' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', letterSpacing: '0.05em', marginBottom: '0.35rem', fontWeight: 600 }}>
              {t('avgSaleValue').toUpperCase()}
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {formatCurrency(avgSaleValue)}
            </div>
          </div>
          <div style={{ padding: '0.75rem 1rem' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', letterSpacing: '0.05em', marginBottom: '0.35rem', fontWeight: 600 }}>
              {t('totalItemsInStock').toUpperCase()}
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {totalItemsInStock}
            </div>
          </div>
        </div>
      </div>

      {/* Status indicators removed — were hardcoded "active" without any real
          verification, giving false confidence. Real status should come from
          actual backup/sync state, not fake green dots. */}
    </div>
  );
}
