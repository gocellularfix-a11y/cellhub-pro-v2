import fs from 'fs';
import path from 'path';

const SRC = 'src';
const results: {
  file: string;
  getLabelsCount: number;
  esTernaryCount: number;
  hardcodedStrings: number;
  themeColors: number;
}[] = [];

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      files.push(...walk(full));
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

const files = walk(SRC);

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');

  const getLabelsCount = (content.match(/\bL[\.\[]/g) || []).length;
  const esTernaryCount = (content.match(/lang\s*===\s*['"]es['"]/g) || []).length;
  const hardcodedStrings = (content.match(/\|\|\s*['"][A-Z]/g) || []).length;
  const themeColors = (content.match(/'#[0-9a-fA-F]{6}'|'rgba\(\d/g) || []).length;

  if (getLabelsCount + esTernaryCount + hardcodedStrings + themeColors > 0) {
    results.push({ file, getLabelsCount, esTernaryCount, hardcodedStrings, themeColors });
  }
}

// Sort by total density
results.sort((a, b) =>
  (b.getLabelsCount + b.esTernaryCount + b.hardcodedStrings + b.themeColors) -
  (a.getLabelsCount + a.esTernaryCount + a.hardcodedStrings + a.themeColors)
);

console.log('=== i18n + Theming Audit Report ===\n');
console.log(`${'File'.padEnd(60)} L.x  es?  str  hex  TOTAL`);
console.log('-'.repeat(95));

let totalL = 0, totalEs = 0, totalStr = 0, totalHex = 0;

for (const r of results) {
  const total = r.getLabelsCount + r.esTernaryCount + r.hardcodedStrings + r.themeColors;
  console.log(
    `${r.file.padEnd(60)} ${String(r.getLabelsCount).padStart(4)} ${String(r.esTernaryCount).padStart(4)} ${String(r.hardcodedStrings).padStart(4)} ${String(r.themeColors).padStart(4)}  ${String(total).padStart(5)}`
  );
  totalL += r.getLabelsCount;
  totalEs += r.esTernaryCount;
  totalStr += r.hardcodedStrings;
  totalHex += r.themeColors;
}

console.log('-'.repeat(95));
console.log(
  `${'TOTAL'.padEnd(60)} ${String(totalL).padStart(4)} ${String(totalEs).padStart(4)} ${String(totalStr).padStart(4)} ${String(totalHex).padStart(4)}  ${String(totalL + totalEs + totalStr + totalHex).padStart(5)}`
);
console.log(`\nFiles with work: ${results.length}`);
console.log(`Already migrated: Dashboard.tsx, Sidebar.tsx (verify 0 counts)`);
