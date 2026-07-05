// Item-by-item profit reconciliation: Dashboard vs Reports vs intended business rule.
// Run against today's full backup JSON.

const fs = require('fs');

const path = process.argv[2] || 'C:/Users/gabyc/Downloads/cellhub-backup-2026-05-02.json';
const data = JSON.parse(fs.readFileSync(path, 'utf8'));
const sales = data.sales || [];
const repairs = data.repairs || [];
const unlocks = data.unlocks || [];
const settings = data.settings || {};
const inventory = data.inventory || [];
const layaways = data.layaways || [];
const specialOrders = data.special_orders || [];

const TODAY_MS_START = (() => { const d = new Date('2026-05-02T00:00:00'); return d.getTime(); })();
const TODAY_MS_END = TODAY_MS_START + 86400_000;

function inToday(ms) { return ms >= TODAY_MS_START && ms < TODAY_MS_END; }
function saleDateMs(s) {
  const v = s.completedAt || s.createdAt || s.date || 0;
  if (typeof v === 'number') return v;
  const t = new Date(v).getTime();
  return isNaN(t) ? 0 : t;
}

// REPORTS isCountableSale rule
function isCountableReports(s) { return s.status !== 'voided' && s.status !== 'refunded'; }
// DASHBOARD's filter is more permissive — let me re-read. From Dashboard.tsx context:
//   const todaySales = useMemo(() => sales.filter((s) => isToday(saleDate(s))), ...)
// No status filter in Dashboard! That's a divergence in itself.
// Actually let me default to: Dashboard's todaySales is everything dated today (no status filter).
function isCountableDashboard(s) { return true; }  // Dashboard does NOT filter by status

// Pseudo-item rule (Reports)
const PSEUDO_PREFIXES = [
  'layaway balance','layaway deposit',
  'repair balance','repair deposit',
  'so balance','so deposit',
  'unlock balance','unlock deposit',
];
function isPseudoItem(item) {
  const n = String(item?.name || '').toLowerCase().trim();
  if (!n) return false;
  return PSEUDO_PREFIXES.some(p => n.startsWith(p));
}

// classifyItem from ReportsModule
function classifyItem(item) {
  const cat = String(item.category || '').toLowerCase();
  const type = String(item.type || '').toLowerCase();
  if (type === 'phone_payment' || cat === 'phone_payment') return 'phone_payment';
  if (type === 'topup' || cat === 'topup' || cat === 'top_up' || cat === 'top-up') return 'topup';
  if (type === 'repair' || item.repairId) return 'repair';
  if (type === 'unlock' || item.unlockId) return 'unlock';
  if (type === 'special_order' || item.specialOrderId) return 'special_order';
  if (type === 'cc_fee') return 'cc_fee';
  if (type === 'service' || cat === 'service' || cat === 'services') {
    const n = (item.name || '').toLowerCase();
    if (n.includes('repair') || n.includes('reparación')) return 'repair';
    if (n.includes('unlock') || n.includes('desbloqueo')) return 'unlock';
    return 'service';
  }
  return 'product';
}

function normalizeCarrier(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const lower = s.toLowerCase().replace(/\s+/g, '');
  if (lower === 'tmobile' || lower === 't-mobile') return 'T-Mobile';
  if (lower === 'verizon' || lower === 'vzw') return 'Verizon';
  if (lower === 'at&t' || lower === 'att') return 'AT&T';
  if (lower.includes('h2o')) return 'H2O';
  if (lower.includes('pageplus')) return 'Page Plus';
  if (lower.includes('cricket')) return 'Cricket';
  if (lower.includes('telcel')) return 'Telcel';
  if (lower.includes('ultra')) return 'Ultra Mobile';
  if (lower.includes('tracfone')) return 'Tracfone';
  if (lower.includes('simplemobile') || lower.includes('simple mobile')) return 'Simple Mobile';
  return s;
}

function resolvePhonePaymentRate(item) {
  let commRate = item.commissionRate;
  if (commRate == null || commRate === 0) {
    let raw = (item.carrier || item.carrierName || item.provider || '').trim();
    if (!raw && item.name) {
      const m = String(item.name).match(/^([A-Za-z0-9\s&]+?)(?:\s*[-–]\s*|\s+Bill Payment)/i);
      if (m) raw = m[1].trim();
    }
    if (!raw && item.name) {
      const km = String(item.name).match(/\b(h2o|t-?mobile|verizon|at&?t|cricket|tracfone|page\s*plus|simple\s*mobile|ultra(?:\s+mobile)?|telcel|boost|metro(?:\s*pcs)?|mint\s*mobile|visible)\b/i);
      if (km) raw = km[1].trim();
    }
    const norm = normalizeCarrier(raw);
    const carrierRate = norm ? settings.carrierCommissions?.[norm] : undefined;
    commRate = carrierRate ?? settings.defaultCommissionRate ?? 0;
  }
  return commRate || 0;
}

const REPAIR_COST_FALLBACK = 0.35;
const TOPUP_COST_RATE = 0.90;

// ─────── Per-item Dashboard formula ───────
function dashboardItemProfit(item) {
  const qty = item.qty || item.quantity || 1;
  const revenue = (item.price || 0) * qty;
  const cat = String(item.category || '').toLowerCase();
  if (cat === 'phone_payment') {
    const rate = resolvePhonePaymentRate(item);
    if (!rate) return 0;
    const cost = Math.round(revenue * (1 - rate));
    return revenue - cost;
  }
  return revenue - (item.cost || 0) * qty;
}

// ─────── Per-item Reports formula ───────
function reportsItemProfit(item) {
  const qty = item.qty || item.quantity || 1;
  const revenue = (item.price || 0) * qty;
  const kind = classifyItem(item);

  if (isPseudoItem(item)) {
    // Pseudo-item: try linked entity proportional cost; else excluded from margin
    let realCost = 0;
    if (item.layawayId) {
      const linked = layaways.find(l => l.id === item.layawayId);
      if (linked) {
        const denom = linked.totalPrice || 0;
        let total = 0;
        for (const li of (linked.items || [])) {
          if (!li.inventoryId) continue;
          const inv = inventory.find(i => i.id === li.inventoryId);
          if (inv) total += (inv.cost || 0) * (li.qty || 1);
        }
        if (total > 0 && denom > 0) realCost = Math.round(total * (revenue / denom));
      }
    } else if (item.specialOrderId) {
      const linked = specialOrders.find(o => o.id === item.specialOrderId);
      if (linked) {
        const total = linked.cost || 0;
        const denom = linked.price || 0;
        if (total > 0 && denom > 0) realCost = Math.round(total * (revenue / denom));
      }
    } else if (item.repairId) {
      const linked = repairs.find(r => r.id === item.repairId);
      if (linked) {
        const parts = (linked.parts || []).reduce((s, p) => s + (p.cost || 0) * (p.qty || p.quantity || 1), 0);
        const labor = linked.laborCost || 0;
        const total = parts + labor;
        const denom = linked.total ?? linked.estimatedCost ?? 0;
        if (total > 0 && denom > 0) realCost = Math.round(total * (revenue / denom));
      }
    } else if (item.unlockId) {
      const linked = unlocks.find(u => u.id === item.unlockId);
      if (linked) {
        const cost = linked.cost || 0;
        const denom = linked.price || 0;
        if (cost > 0 && denom > 0) realCost = Math.round(cost * (revenue / denom));
      }
    }
    if (realCost > 0) return revenue - realCost;
    return 0;  // pseudo-item with no linked cost → excluded
  }

  if (kind === 'phone_payment') {
    const rate = resolvePhonePaymentRate(item);
    const cost = Math.round(revenue * (1 - (rate || (settings.defaultCommissionRate ?? 0.07))));
    return revenue - cost;
  }
  if (kind === 'topup') {
    const cost = Math.round(revenue * TOPUP_COST_RATE);
    return revenue - cost;
  }
  if (kind === 'repair') {
    if (item.repairId) {
      const linked = repairs.find(r => r.id === item.repairId);
      if (linked) {
        const parts = (linked.parts || []).reduce((s, p) => s + (p.cost || 0) * (p.qty || p.quantity || 1), 0);
        const cost = parts + (linked.laborCost || 0);
        return revenue - cost;
      }
    }
    return revenue - Math.round(revenue * REPAIR_COST_FALLBACK);
  }
  if (kind === 'unlock') {
    let cost = 0;
    if (item.unlockId) {
      const linked = unlocks.find(u => u.id === item.unlockId);
      cost = linked?.cost || 0;
    }
    return revenue - cost;
  }
  if (kind === 'special_order') return revenue - (item.cost || 0) * qty;
  if (kind === 'cc_fee') return revenue;
  if (kind === 'service') return revenue - (item.cost || 0) * qty;
  // product
  let unitCost = item.cost || 0;
  if (!unitCost && item.name) {
    const inv = inventory.find(i => i.name?.toLowerCase() === item.name.toLowerCase());
    if (inv) unitCost = inv.cost || 0;
  }
  return revenue - unitCost * qty;
}

// ─────── Intended business rule (per item facts) ───────
function intendedItemProfit(item) {
  const qty = item.qty || item.quantity || 1;
  const revenue = (item.price || 0) * qty;
  const kind = classifyItem(item);

  if (isPseudoItem(item)) {
    return reportsItemProfit(item);  // pseudo-items intended rule = Reports' proportional inheritance
  }

  if (kind === 'phone_payment') {
    // Stamped commission rate is the source of truth (transaction-time).
    const rate = item.commissionRate ?? resolvePhonePaymentRate(item);
    return Math.round(revenue * rate);
  }
  if (kind === 'topup') {
    // If cost was explicitly stamped (>0), trust it (stamped at sale time).
    // If cost is 0 or missing, fall back to Reports' 10% default.
    if (item.cost > 0) return revenue - (item.cost * qty);
    return Math.round(revenue * (1 - TOPUP_COST_RATE));
  }
  if (kind === 'repair') {
    // Source of truth = linked repair's real parts + labor
    if (item.repairId) {
      const linked = repairs.find(r => r.id === item.repairId);
      if (linked) {
        const parts = (linked.parts || []).reduce((s, p) => s + (p.cost || 0) * (p.qty || p.quantity || 1), 0);
        const cost = parts + (linked.laborCost || 0);
        if (cost > 0) return revenue - cost;
      }
    }
    if (item.cost > 0) return revenue - item.cost * qty;
    return revenue - Math.round(revenue * REPAIR_COST_FALLBACK);
  }
  if (kind === 'unlock') {
    if (item.unlockId) {
      const linked = unlocks.find(u => u.id === item.unlockId);
      if (linked && linked.cost > 0) return revenue - linked.cost;
    }
    if (item.cost > 0) return revenue - item.cost * qty;
    return revenue;  // no cost data anywhere
  }
  if (kind === 'cc_fee') return revenue;
  // service / special_order / product → real stamped cost
  let unitCost = item.cost || 0;
  if (!unitCost && item.name) {
    const inv = inventory.find(i => i.name?.toLowerCase() === item.name.toLowerCase());
    if (inv) unitCost = inv.cost || 0;
  }
  return revenue - unitCost * qty;
}

// ──────────────────────────────────────
// Run analysis
// ──────────────────────────────────────

const todaySalesRaw = sales.filter(s => inToday(saleDateMs(s)));
const todaySalesReports = todaySalesRaw.filter(isCountableReports);
const todaySalesDashboard = todaySalesRaw.filter(isCountableDashboard);

console.log(`Today total sales (raw):     ${todaySalesRaw.length}`);
console.log(`Today sales for Dashboard:   ${todaySalesDashboard.length} (no status filter)`);
console.log(`Today sales for Reports:     ${todaySalesReports.length} (excludes voided/refunded)`);
console.log('');

// Status breakdown
const statusCount = {};
for (const s of todaySalesRaw) {
  const st = s.status || '(none)';
  statusCount[st] = (statusCount[st] || 0) + 1;
}
console.log('Sale status breakdown today:', statusCount);
console.log('');

// Per-item table
const rows = [];
let dashTotalItems = 0, reportsTotalItems = 0, intendedTotalItems = 0;
let dashCcFeeSum = 0;

for (const s of todaySalesDashboard) {
  for (const item of (s.items || [])) {
    const dash = dashboardItemProfit(item);
    const rep = todaySalesReports.includes(s) ? reportsItemProfit(item) : 0;
    const intended = todaySalesReports.includes(s) ? intendedItemProfit(item) : 0;
    dashTotalItems += dash;
    reportsTotalItems += rep;
    intendedTotalItems += intended;
    rows.push({
      saleId: s.id,
      saleStatus: s.status,
      countableReports: todaySalesReports.includes(s),
      itemName: item.name,
      category: item.category,
      kind: classifyItem(item),
      pseudo: isPseudoItem(item),
      priceCents: item.price,
      qty: item.qty || 1,
      costRaw: item.cost === undefined ? 'undef' : item.cost,
      revenueCents: (item.price || 0) * (item.qty || 1),
      dashCents: dash,
      reportsCents: rep,
      intendedCents: intended,
      deltaDR: dash - rep,
      deltaDI: dash - intended,
    });
  }
  // Dashboard adds s.creditCardFee to its sum as 100% margin
  dashCcFeeSum += s.creditCardFee || 0;
}

// Reports also adds CC fee — at sale level if no cc_fee line item
let reportsCcFeeSum = 0;
for (const s of todaySalesReports) {
  const ccFee = s.creditCardFee || 0;
  const hasCcFeeLineItem = (s.items || []).some(it => classifyItem(it) === 'cc_fee');
  if (ccFee > 0 && !hasCcFeeLineItem) reportsCcFeeSum += ccFee;
}

// Standalone repairs/unlocks today (Reports rule)
const repairsInSaleIds = new Set();
for (const s of todaySalesReports) for (const it of (s.items || [])) if (it.repairId) repairsInSaleIds.add(it.repairId);
const unlocksInSaleIds = new Set();
for (const s of todaySalesReports) for (const it of (s.items || [])) {
  if (it.unlockId) unlocksInSaleIds.add(it.unlockId);
  else if (it.meta?.unlockId) unlocksInSaleIds.add(it.meta.unlockId);
}

function repairCompletedToday(r) {
  const st = String(r.status || '').toLowerCase();
  if (!['complete','completed','picked_up','pickedup'].includes(st)) return false;
  if ((r.balance ?? 0) !== 0) return false;
  return inToday(new Date(r.completedAt || 0).getTime());
}
function unlockCompletedToday(u) {
  const st = String(u.status || '').toLowerCase();
  if (!['complete','completed'].includes(st)) return false;
  return inToday(new Date(u.completedAt || u.createdAt || 0).getTime());
}

let standaloneRepairProfit = 0, standaloneRepairList = [];
for (const r of repairs) {
  if (!repairCompletedToday(r)) continue;
  if (repairsInSaleIds.has(r.id)) continue;
  const rev = r.total ?? r.estimatedCost ?? 0;
  const parts = (r.parts || []).reduce((s, p) => s + (p.cost || 0) * (p.qty || p.quantity || 1), 0);
  const cost = (parts + (r.laborCost || 0)) || Math.round(rev * REPAIR_COST_FALLBACK);
  standaloneRepairProfit += rev - cost;
  standaloneRepairList.push({ id: r.id, status: r.status, rev, cost, profit: rev - cost });
}
let standaloneUnlockProfit = 0, standaloneUnlockList = [];
for (const u of unlocks) {
  if (!unlockCompletedToday(u)) continue;
  if (unlocksInSaleIds.has(u.id)) continue;
  const rev = u.price || 0;
  const cost = u.cost || 0;
  standaloneUnlockProfit += rev - cost;
  standaloneUnlockList.push({ id: u.id, status: u.status, rev, cost, profit: rev - cost });
}

// Refunds today (Dashboard subtracts proportionally, Reports does not in totalProfit)
const customerReturnsToday = (data.customer_returns || []).filter(r => {
  const ms = new Date(r.createdAt || 0).getTime();
  return inToday(ms);
});
const todayReturnsCents = customerReturnsToday.reduce((a, r) => a + Math.round((r.total || 0) * 100), 0);

// Dashboard's "todayProfitableSubtotal" for marginRatio
let dashProfitableSubtotal = 0;
for (const s of todaySalesDashboard) {
  for (const item of (s.items || [])) {
    dashProfitableSubtotal += (item.price || 0) * (item.qty || 1);
  }
  dashProfitableSubtotal += s.creditCardFee || 0;
}
const dashGrossProfit = dashTotalItems + dashCcFeeSum;
const rawRatio = dashProfitableSubtotal > 0 ? (dashGrossProfit / dashProfitableSubtotal) : 0;
const marginRatio = Math.max(0, Math.min(1, rawRatio));
const dashFinalProfit = dashGrossProfit + standaloneRepairProfit + standaloneUnlockProfit
  - Math.round(todayReturnsCents * marginRatio);

const reportsFinalProfit = reportsTotalItems + reportsCcFeeSum + standaloneRepairProfit + standaloneUnlockProfit;

console.log('═══════════════════════════════════════════');
console.log('PER-ITEM TABLE (countable for Reports / Dashboard)');
console.log('═══════════════════════════════════════════');
console.log('idx | kind          | name                           | price  | qty | cost   | dash   | rep    | intent | ΔD-R   | countable');
console.log('----|---------------|--------------------------------|--------|-----|--------|--------|--------|--------|--------|----------');
rows.forEach((r, i) => {
  console.log(
    `${String(i).padStart(3)} | ${r.kind.padEnd(13)} | ${(r.itemName||'').padEnd(30).slice(0,30)} | ${(r.priceCents/100).toFixed(2).padStart(6)} | ${String(r.qty).padStart(3)} | ${(typeof r.costRaw==='number'?(r.costRaw/100).toFixed(2):'undef').padStart(6)} | ${(r.dashCents/100).toFixed(2).padStart(6)} | ${(r.reportsCents/100).toFixed(2).padStart(6)} | ${(r.intendedCents/100).toFixed(2).padStart(6)} | ${(r.deltaDR/100).toFixed(2).padStart(6)} | ${r.countableReports?'Y':'N'}`
  );
});

console.log('');
console.log('═══════════════════════════════════════════');
console.log('CATEGORY SUMS (countable sales only — Reports basis)');
console.log('═══════════════════════════════════════════');
const byKind = {};
for (const r of rows) {
  if (!r.countableReports) continue;
  if (!byKind[r.kind]) byKind[r.kind] = { count:0, revenue:0, dash:0, reports:0, intended:0 };
  byKind[r.kind].count++;
  byKind[r.kind].revenue += r.revenueCents;
  byKind[r.kind].dash += r.dashCents;
  byKind[r.kind].reports += r.reportsCents;
  byKind[r.kind].intended += r.intendedCents;
}
console.log('kind          | count | revenue | dashProfit | reportsProfit | intentProfit | Δ(D-R)');
console.log('--------------|-------|---------|------------|---------------|--------------|-------');
for (const [k, v] of Object.entries(byKind).sort()) {
  console.log(
    `${k.padEnd(13)} | ${String(v.count).padStart(5)} | ${(v.revenue/100).toFixed(2).padStart(7)} | ${(v.dash/100).toFixed(2).padStart(10)} | ${(v.reports/100).toFixed(2).padStart(13)} | ${(v.intended/100).toFixed(2).padStart(12)} | ${((v.dash-v.reports)/100).toFixed(2).padStart(6)}`
  );
}

console.log('');
console.log('═══════════════════════════════════════════');
console.log('TOTALS');
console.log('═══════════════════════════════════════════');
console.log(`Items:               dash=$${(dashTotalItems/100).toFixed(2)}  reports=$${(reportsTotalItems/100).toFixed(2)}  intended=$${(intendedTotalItems/100).toFixed(2)}`);
console.log(`CC fees (sale-lvl):  dash=$${(dashCcFeeSum/100).toFixed(2)}  reports=$${(reportsCcFeeSum/100).toFixed(2)}`);
console.log(`Standalone repairs:  $${(standaloneRepairProfit/100).toFixed(2)} (${standaloneRepairList.length} ticket(s))`);
console.log(`Standalone unlocks:  $${(standaloneUnlockProfit/100).toFixed(2)} (${standaloneUnlockList.length} ticket(s))`);
console.log(`Refunds today:       $${(todayReturnsCents/100).toFixed(2)} (${customerReturnsToday.length} return(s))`);
console.log(`Dashboard marginRatio: ${marginRatio.toFixed(4)} (subtotal=$${(dashProfitableSubtotal/100).toFixed(2)})`);
console.log(`Refund deduction Dashboard: $${((todayReturnsCents*marginRatio)/100).toFixed(2)}`);
console.log('');
console.log(`==> Dashboard FINAL = $${(dashFinalProfit/100).toFixed(2)}`);
console.log(`==> Reports FINAL   = $${(reportsFinalProfit/100).toFixed(2)}`);
console.log(`==> Delta           = $${((dashFinalProfit - reportsFinalProfit)/100).toFixed(2)}`);

if (standaloneRepairList.length) {
  console.log('\nStandalone repairs detail:');
  standaloneRepairList.forEach(r => console.log(`  ${r.id} status=${r.status} rev=$${(r.rev/100).toFixed(2)} cost=$${(r.cost/100).toFixed(2)} profit=$${(r.profit/100).toFixed(2)}`));
}
if (standaloneUnlockList.length) {
  console.log('\nStandalone unlocks detail:');
  standaloneUnlockList.forEach(u => console.log(`  ${u.id} status=${u.status} rev=$${(u.rev/100).toFixed(2)} cost=$${(u.cost/100).toFixed(2)} profit=$${(u.profit/100).toFixed(2)}`));
}

if (customerReturnsToday.length) {
  console.log('\nReturns today detail:');
  customerReturnsToday.forEach(r => console.log(`  ${r.id} total=$${(r.total||0).toFixed(2)} reason=${r.reason}`));
}
