// ============================================================
// AUDIT FIX ROUND (H1/M1/M2/L1) — legacy branding cleanup locks
//
// Structural assertions over the audited customer-facing surfaces:
// Settings, Help manual and the operator daily brief. Source-scan
// checks are limited to the EXACT surfaces the independent audit
// flagged — they are regression locks, not a global emoji police.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
// Leaf imports only (no React providers needed in node).
import { translations } from '@/i18n/translations';
import { HELP_MODULES } from '@/modules/help/helpContent';

const src = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const resolve = (key: string, lang: 'en' | 'es' | 'pt'): string => {
  const entry = (translations as Record<string, Record<string, unknown>>)[key];
  expect(entry, `missing translation key ${key}`).toBeDefined();
  const v = entry[lang];
  return typeof v === 'function' ? (v as (...a: unknown[]) => string)(1) : String(v);
};

describe('AUDIT M1 — Settings surface', () => {
  it('SettingsModule renders no robot icon anywhere (nav + intelligence header)', () => {
    expect(src('src/modules/settings/SettingsModule.tsx')).not.toContain('🤖');
  });

  it('settings.nav.ai resolves to CellHub Intelligence naming in EN/ES/PT', () => {
    expect(resolve('settings.nav.ai', 'en')).toBe('CellHub Intelligence');
    expect(resolve('settings.nav.ai', 'es')).toBe('Inteligencia de CellHub');
    expect(resolve('settings.nav.ai', 'pt')).toBe('Inteligência CellHub');
  });

  it('the setup banner + status strings no longer reference the legacy AI Assistant name', () => {
    for (const key of ['ai.setupBannerPre', 'ai.configuredReady', 'ai.addKeyPrompt']) {
      for (const lang of ['en', 'es', 'pt'] as const) {
        const v = resolve(key, lang).toLowerCase();
        expect(v, `${key}/${lang}`).not.toContain('ai assistant');
        expect(v, `${key}/${lang}`).not.toContain('asistente ai');
        expect(v, `${key}/${lang}`).not.toContain('assistente ai');
        expect(v, `${key}/${lang}`).toContain('cellhub');
      }
    }
  });
});

describe('AUDIT M2 — Help manual', () => {
  const article = (HELP_MODULES as Array<{ id: string; icon: string; title: Record<string, string> }>)
    .find((s) => s.id === 'intelligence');

  it('the intelligence article exists and no longer uses the brain icon', () => {
    expect(article).toBeDefined();
    expect(article!.icon).not.toContain('🧠');
    expect(article!.icon).toBe('◉');
  });

  it('the help title is CellHub Intelligence in EN/ES/PT', () => {
    expect(article!.title.en).toBe('CellHub Intelligence');
    expect(article!.title.es).toBe('Inteligencia de CellHub');
    expect(article!.title.pt).toBe('Inteligência CellHub');
  });
});

describe('AUDIT L1 — daily brief output', () => {
  it('dailyBrief no longer embeds the brain emoji in generated lines', () => {
    // The only remaining reference may live in comments; the customer-facing
    // template literal must be emoji-free.
    const code = src('src/services/intelligence/chat/dailyBrief.ts');
    const templateLines = code.split('\n').filter((l) => l.includes('lines.push'));
    for (const l of templateLines) expect(l).not.toContain('🧠');
  });
});

describe('Navigation + Settings behavior intact', () => {
  it('the Settings ai section id and API-key keys are untouched', () => {
    const code = src('src/modules/settings/SettingsModule.tsx');
    expect(code).toContain(`id: 'ai'`);                 // section routing preserved
    expect(resolve('ai.settingsPath', 'en')).toBe('Settings → AI'); // config path wording untouched
  });
});
