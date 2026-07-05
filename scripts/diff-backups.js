// Compare two backup snapshots to detect Firebase sync mutations.
// Focus: cellhub_sales — count, IDs added/removed, content drift, source/updatedAt patterns.

const fs = require('fs');

const A_PATH = process.argv[2];
const B_PATH = process.argv[3];
if (!A_PATH || !B_PATH) {
  console.error('Usage: node diff-backups.js <earlier.json> <later.json>');
  process.exit(1);
}

const A_RAW = JSON.parse(fs.readFileSync(A_PATH, 'utf8'));
const B_RAW = JSON.parse(fs.readFileSync(B_PATH, 'utf8'));

// Two schemas exist:
//  - manual export: { sales: [...], _exportedAt, _version, ... }
//  - auto-backup:   { version, exportDate, data: { sales: [...], ... } }
function normalize(raw) {
  if (Array.isArray(raw.sales)) return raw;
  if (raw.data && Array.isArray(raw.data.sales)) {
    return { ...raw.data, _exportedAt: raw.exportDate, _version: raw.version };
  }
  return raw;
}
const A = normalize(A_RAW);
const B = normalize(B_RAW);

const aSales = A.sales || [];
const bSales = B.sales || [];

console.log('═══════════════════════════════════════════════');
console.log('SNAPSHOT META');
console.log('═══════════════════════════════════════════════');
console.log('A:', A_PATH);
console.log('   exportedAt:', A._exportedAt, '| version:', A._version, '| sales count:', aSales.length);
console.log('B:', B_PATH);
console.log('   exportedAt:', B._exportedAt, '| version:', B._version, '| sales count:', bSales.length);
console.log('');

// Build maps by ID
const aById = new Map(aSales.map(s => [s.id, s]));
const bById = new Map(bSales.map(s => [s.id, s]));

// Detect duplicate IDs within each snapshot
function findDups(list, label) {
  const seen = new Map();
  const dups = [];
  for (const s of list) {
    if (seen.has(s.id)) dups.push({ id: s.id, first: seen.get(s.id), second: s });
    else seen.set(s.id, s);
  }
  if (dups.length) {
    console.log(`!! ${label} has ${dups.length} duplicate ID(s):`);
    for (const d of dups) console.log('   ', d.id);
  } else {
    console.log(`✓ ${label} no duplicate sale IDs`);
  }
}
console.log('═══════════════════════════════════════════════');
console.log('DUPLICATE ID CHECK');
console.log('═══════════════════════════════════════════════');
findDups(aSales, 'A');
findDups(bSales, 'B');
console.log('');

// IDs added in B vs A
const addedInB = [];
const removedInB = [];
const modifiedInB = [];

for (const [id, b] of bById) {
  const a = aById.get(id);
  if (!a) addedInB.push(b);
  else {
    // Compare critical fields
    const keys = ['status','total','subtotal','taxAmount','creditCardFee','updatedAt','employeeName','paymentMethod'];
    const diffs = {};
    for (const k of keys) {
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) diffs[k] = { a: a[k], b: b[k] };
    }
    // Items length / content
    if ((a.items||[]).length !== (b.items||[]).length) {
      diffs._itemsCount = { a: (a.items||[]).length, b: (b.items||[]).length };
    } else {
      // Compare items shallow
      const itemsDiff = [];
      for (let i = 0; i < (a.items||[]).length; i++) {
        const ai = a.items[i], bi = b.items[i];
        for (const ik of ['price','cost','qty','category','commissionRate','carrier','name']) {
          if (JSON.stringify(ai?.[ik]) !== JSON.stringify(bi?.[ik])) {
            itemsDiff.push({ idx: i, key: ik, a: ai?.[ik], b: bi?.[ik] });
          }
        }
      }
      if (itemsDiff.length) diffs._items = itemsDiff;
    }
    if (Object.keys(diffs).length) modifiedInB.push({ id, diffs });
  }
}
for (const [id, a] of aById) {
  if (!bById.has(id)) removedInB.push(a);
}

console.log('═══════════════════════════════════════════════');
console.log('SALES DRIFT BETWEEN A → B');
console.log('═══════════════════════════════════════════════');
console.log('Added in B (new sales):', addedInB.length);
console.log('Removed in B (vanished):', removedInB.length);
console.log('Modified between A and B:', modifiedInB.length);
console.log('');

if (addedInB.length) {
  console.log('--- New sales in B ---');
  for (const s of addedInB.slice(0, 20)) {
    console.log(`  id=${s.id} status=${s.status} total=$${((s.total||0)/100).toFixed(2)} createdAt=${s.createdAt} completedAt=${s.completedAt}`);
  }
}
if (removedInB.length) {
  console.log('--- Sales vanished from A ---');
  for (const s of removedInB.slice(0, 20)) {
    console.log(`  id=${s.id} status=${s.status} total=$${((s.total||0)/100).toFixed(2)} createdAt=${s.createdAt}`);
  }
}
if (modifiedInB.length) {
  console.log('--- Modified sales (A → B) ---');
  for (const m of modifiedInB.slice(0, 30)) {
    console.log(`  id=${m.id}:`);
    console.log('    diffs:', JSON.stringify(m.diffs, null, 2).split('\n').map(l => '    ' + l).join('\n'));
  }
}

// Today's sales focus
const TODAY_MS = new Date('2026-05-02T00:00:00').getTime();
const inToday = ms => {
  const v = typeof ms === 'string' ? new Date(ms).getTime() : ms;
  return v >= TODAY_MS && v < TODAY_MS + 86400000;
};
const aTodaySales = aSales.filter(s => inToday(s.completedAt || s.createdAt));
const bTodaySales = bSales.filter(s => inToday(s.completedAt || s.createdAt));
console.log('');
console.log('═══════════════════════════════════════════════');
console.log('TODAY (2026-05-02) FOCUS');
console.log('═══════════════════════════════════════════════');
console.log(`A today sales: ${aTodaySales.length}`);
console.log(`B today sales: ${bTodaySales.length}`);
console.log('');

// Look for source/syncSource/_synced/firebaseId fields anywhere
function scanForSyncFields(sale) {
  const out = [];
  const sus = ['source','syncSource','_synced','firebaseId','_source','syncedAt','firestore','syncStatus'];
  for (const k of sus) if (k in sale) out.push({ key: k, val: sale[k] });
  if (sale.updatedAt) out.push({ key: 'updatedAt', val: sale.updatedAt });
  return out;
}
console.log('--- Sync-related fields on TODAY sales ---');
console.log('A today sales sample fields:');
for (const s of aTodaySales) {
  const fields = scanForSyncFields(s);
  console.log(`  ${s.id}:`, fields.length ? JSON.stringify(fields) : '(none)');
}
console.log('B today sales sample fields:');
for (const s of bTodaySales) {
  const fields = scanForSyncFields(s);
  console.log(`  ${s.id}:`, fields.length ? JSON.stringify(fields) : '(none)');
}

// Compare item list per today sale
console.log('');
console.log('--- Today sale list (A then B) ---');
for (const s of aTodaySales) {
  console.log(`A | ${s.completedAt} | ${s.id} | total=$${((s.total||0)/100).toFixed(2)} | status=${s.status} | items=${(s.items||[]).length}`);
}
for (const s of bTodaySales) {
  console.log(`B | ${s.completedAt} | ${s.id} | total=$${((s.total||0)/100).toFixed(2)} | status=${s.status} | items=${(s.items||[]).length}`);
}
