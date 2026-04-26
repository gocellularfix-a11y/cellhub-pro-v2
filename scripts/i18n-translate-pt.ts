import fs from 'fs';

const DRY_RUN = process.argv.includes('--dry-run');

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!DRY_RUN && !API_KEY) throw new Error('Missing ANTHROPIC_API_KEY');

const file = 'src/i18n/translations.ts';

const esc = (s: string) =>
  s.replace(/\\/g, '\\\\')
   .replace(/'/g, "\\'")
   .replace(/\r/g, '\\r')
   .replace(/\n/g, '\\n');

const buildLineRegex = (key: string) => {
  const safeKey = esc(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `('${safeKey}':\\s*\\{\\s*en:\\s*'(?:\\\\'|[^'])*',\\s*es:\\s*'(?:\\\\'|[^'])*',\\s*pt:\\s*)'(?:\\\\'|[^'])*'`
  );
};

async function main() {
  const content = fs.readFileSync(file, 'utf8');

  const entries: { key: string; en: string }[] = [];
  const regex = /'((?:\\'|[^'])+)':\s*\{\s*en:\s*'((?:\\'|[^'])*)'/g;

  let match;
  while ((match = regex.exec(content)) !== null) {
    entries.push({
      key: match[1].replace(/\\'/g, "'"),
      en: match[2].replace(/\\'/g, "'"),
    });
  }

  const BATCH_SIZE = 50;
  const batchCount = Math.ceil(entries.length / BATCH_SIZE);

  if (DRY_RUN) {
    console.log('=== DRY RUN — no API calls, no file writes ===');
    console.log(`Entries detected: ${entries.length}`);
    console.log(`Batch count: ${batchCount}`);

    let replaceable = 0;
    const unmatchable: string[] = [];

    for (const entry of entries) {
      if (buildLineRegex(entry.key).test(content)) {
        replaceable++;
      } else {
        unmatchable.push(entry.key);
      }
    }

    console.log(`Replaceable PT entries: ${replaceable}`);
    console.log(`API calls: 0`);
    console.log(`File writes: 0`);

    if (unmatchable.length > 0) {
      console.log(`\nWARNING: ${unmatchable.length} entries could not be matched for replacement:`);
      unmatchable.slice(0, 10).forEach(k => console.log(`  - ${k}`));
      if (unmatchable.length > 10) console.log(`  ... and ${unmatchable.length - 10} more`);
      process.exit(1);
    }

    console.log('\nDry-run OK. Ready for live API translation.');
    return;
  }

  // ─── LIVE MODE ───
  fs.writeFileSync(`${file}.bak`, content, 'utf8');
  console.log(`Found ${entries.length} keys`);

  const ptMap: Record<string, string> = {};

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);

    const prompt = `Translate these UI labels from English to Brazilian Portuguese (pt-BR).
Return ONLY valid JSON. Keep concise. Do not translate brand names, IMEI, SKU, PIN, SMS, ID, API, URL.

${JSON.stringify(Object.fromEntries(batch.map(e => [e.key, e.en])))}`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      throw new Error(`Claude API error ${res.status}: ${await res.text()}`);
    }

    const data = await res.json() as any;
    const text = data.content?.[0]?.text?.trim() || '{}';
    const json = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();

    const translations = JSON.parse(json);
    Object.assign(ptMap, translations);

    console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${Object.keys(translations).length}`);
  }

  // Safety net: persist API output before attempting replacement.
  // If replace step breaks, we can re-apply without paying API again.
  fs.writeFileSync('scripts/.pt-cache.json', JSON.stringify(ptMap, null, 2), 'utf8');
  console.log(`API output cached: scripts/.pt-cache.json`);

  let updated = content;
  let replaced = 0;

  for (const [key, ptVal] of Object.entries(ptMap)) {
    const lineRegex = buildLineRegex(key);
    const safeVal = esc(String(ptVal));

    const before = updated;
    // Callback form: replacement string is NOT subject to $N backreference
    // interpretation, so PT values containing "$100", "$1", etc. survive intact.
    updated = updated.replace(lineRegex, (_full, prefix) => `${prefix}'${safeVal}'`);
    if (updated !== before) replaced++;
  }

  fs.writeFileSync(file, updated, 'utf8');

  console.log(`PT translations received: ${Object.keys(ptMap).length}`);
  console.log(`PT values replaced: ${replaced}`);
  console.log(`Backup created: ${file}.bak`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
