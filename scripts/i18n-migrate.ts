import LABELS from '../src/config/i18n';
import fs from 'fs';

const L = LABELS as any;

if (!L?.en || !L?.es) {
  throw new Error('LABELS.en or LABELS.es not found');
}

fs.mkdirSync('src/i18n', { recursive: true });

const enKeys = new Set(Object.keys(L.en));
const esKeys = new Set(Object.keys(L.es));

const SKIP = new Set(
  [...enKeys].filter(k => typeof L.en[k] === 'object' && L.en[k] !== null)
);

const esc = (s: string) =>
  s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');

let lines: string[] = [];

lines.push(`import type { TranslationDictionary } from './types';`);
lines.push(``);
lines.push(`export const translations: TranslationDictionary = {`);

const allKeys = new Set([...enKeys, ...esKeys]);
const sorted = [...allKeys].filter(k => !SKIP.has(k)).sort();

let shared = 0;
let enOnly = 0;
let esOnly = 0;

for (const k of sorted) {
  const hasEn = enKeys.has(k) && typeof L.en[k] === 'string';
  const hasEs = esKeys.has(k) && typeof L.es[k] === 'string';

  let en: string;
  let es: string;
  let pt: string;
  let comment = '';

  if (hasEn && hasEs) {
    en = L.en[k];
    es = L.es[k];
    pt = en;
    shared++;
  } else if (hasEn && !hasEs) {
    en = L.en[k];
    es = en;
    pt = en;
    comment = ' // TODO: missing ES translation';
    enOnly++;
  } else if (!hasEn && hasEs) {
    es = L.es[k];
    en = es;
    pt = es;
    comment = ' // TODO: verify — ES-only key';
    esOnly++;
  } else {
    continue;
  }

  lines.push(`  '${esc(k)}': { en: '${esc(en)}', es: '${esc(es)}', pt: '${esc(pt)}' },${comment}`);
}

lines.push(`};`);
lines.push(``);

fs.writeFileSync('src/i18n/translations.ts', lines.join('\n'), 'utf8');

console.log(`Generated src/i18n/translations.ts`);
console.log(`  Shared: ${shared}`);
console.log(`  EN-only: ${enOnly}`);
console.log(`  ES-only: ${esOnly}`);
console.log(`  Skipped nested: ${SKIP.size}`);
console.log(`  Total keys: ${shared + enOnly + esOnly}`);
