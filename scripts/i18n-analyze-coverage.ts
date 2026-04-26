import fs from 'fs';

const cache: Record<string, string> = JSON.parse(
  fs.readFileSync('scripts/.pt-cache.json', 'utf8')
);
const content = fs.readFileSync('src/i18n/translations.ts', 'utf8');

const enRegex = /'((?:\\'|[^'])+)':\s*\{\s*en:\s*'((?:\\'|[^'])*)'/g;
const enMap: Record<string, string> = {};
let m;
while ((m = enRegex.exec(content)) !== null) {
  enMap[m[1].replace(/\\'/g, "'")] = m[2].replace(/\\'/g, "'");
}

let ptEqualsEn = 0;
const examples: { key: string; val: string }[] = [];
for (const [key, ptVal] of Object.entries(cache)) {
  if (enMap[key] === ptVal) {
    ptEqualsEn++;
    if (examples.length < 12) examples.push({ key, val: ptVal });
  }
}

console.log(`Cache entries: ${Object.keys(cache).length}`);
console.log(`Entries where PT == EN (no replace needed): ${ptEqualsEn}`);
console.log(`Examples (kept English intentionally):`);
examples.forEach(e => console.log(`  ${e.key}: "${e.val}"`));
console.log(`\nMath: 1144 received - ${ptEqualsEn} (PT==EN, no diff) = ${1144 - ptEqualsEn} replaced`);
console.log(`Reported: 1103 replaced`);
console.log(`Discrepancy: ${1144 - ptEqualsEn - 1103}`);
