// Analyze topup category profit mismatch between Dashboard and Reports.
// Dashboard:  profit = (price - (cost || 0)) * qty
// Reports:    profit = round(revenue * 0.10)   (TOPUP_PROFIT_RATE)
//             cost   = round(revenue * 0.90)   (TOPUP_COST_RATE)
// Delta per item = dashProfit - reportsProfit

const fs = require('fs');

const path = process.argv[2] || 'C:/Users/gabyc/Downloads/CELLHUB 5-1-26.json';
const raw = fs.readFileSync(path, 'utf8');
const data = JSON.parse(raw);
const sales = data.sales || [];

function ymd(ms) {
  if (!ms) return null;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function saleDateMs(s) {
  return s.completedAt || s.createdAt || s.date || 0;
}

function isCountable(s) {
  const st = String(s.status || '').toLowerCase();
  return st !== 'voided' && st !== 'cancelled' && st !== 'refunded';
}

const TOPUP_KEYS = new Set(['topup', 'top_up', 'top-up']);

const topupItems = [];
for (const s of sales) {
  if (!isCountable(s)) continue;
  for (const it of (s.items || [])) {
    const cat = String(it.category || '').toLowerCase();
    if (!TOPUP_KEYS.has(cat)) continue;
    const qty = it.qty || it.quantity || 1;
    const price = it.price || 0;
    const cost = it.cost;
    const revenue = price * qty;
    const dashProfit = revenue - (cost || 0) * qty;
    const reportsProfit = Math.round(revenue * 0.10);
    topupItems.push({
      ymd: ymd(saleDateMs(s)),
      saleId: s.id,
      saleStatus: s.status,
      name: it.name,
      category: it.category,
      priceCents: price,
      costRaw: cost,
      costMissing: cost === undefined || cost === null,
      qty,
      revenueCents: revenue,
      dashProfitCents: dashProfit,
      reportsProfitCents: reportsProfit,
      deltaCents: dashProfit - reportsProfit,
    });
  }
}

console.log('TOTAL topup items in countable sales:', topupItems.length);
console.log('Items with cost MISSING (undefined/null):',
  topupItems.filter(i => i.costMissing).length);
console.log('Items with cost === 0:',
  topupItems.filter(i => i.costRaw === 0).length);
console.log('Items with cost > 0:',
  topupItems.filter(i => typeof i.costRaw === 'number' && i.costRaw > 0).length);

// Group by date
const byDate = {};
for (const it of topupItems) {
  if (!byDate[it.ymd]) byDate[it.ymd] = { count: 0, revenue: 0, dashProfit: 0, reportsProfit: 0, delta: 0, items: [] };
  byDate[it.ymd].count++;
  byDate[it.ymd].revenue += it.revenueCents;
  byDate[it.ymd].dashProfit += it.dashProfitCents;
  byDate[it.ymd].reportsProfit += it.reportsProfitCents;
  byDate[it.ymd].delta += it.deltaCents;
  byDate[it.ymd].items.push(it);
}

const dates = Object.keys(byDate).sort().slice(-10);
console.log('\nLast 10 days topup activity (cents → $):');
console.log('date       | count | revenue | dashProfit | reportsProfit | delta');
console.log('-----------|-------|---------|------------|---------------|------');
for (const d of dates) {
  const b = byDate[d];
  console.log(
    `${d} | ${String(b.count).padStart(5)} | ${(b.revenue/100).toFixed(2).padStart(7)} | ${(b.dashProfit/100).toFixed(2).padStart(10)} | ${(b.reportsProfit/100).toFixed(2).padStart(13)} | ${(b.delta/100).toFixed(2).padStart(6)}`
  );
}

// Detail for May 1 and May 2 (the days that matter)
for (const target of ['2026-05-01', '2026-05-02']) {
  const b = byDate[target];
  if (!b) {
    console.log(`\n=== ${target}: NO topup items ===`);
    continue;
  }
  console.log(`\n=== ${target} per-item detail ===`);
  for (const it of b.items) {
    console.log(`  ${it.name} | price=${(it.priceCents/100).toFixed(2)} qty=${it.qty} cost=${it.costRaw === undefined ? 'UNDEFINED' : (it.costRaw/100).toFixed(2)} | dash=${(it.dashProfitCents/100).toFixed(2)} reports=${(it.reportsProfitCents/100).toFixed(2)} delta=${(it.deltaCents/100).toFixed(2)}`);
  }
  console.log(`  TOTAL DELTA ${target}: $${(b.delta/100).toFixed(2)}`);
}
