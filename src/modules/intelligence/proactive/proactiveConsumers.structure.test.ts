// ============================================================
// I6-C2 — structural guardrails for visible intelligence consumers.
//
// Enforces the single-source-of-truth contract at the import level, so a
// future edit can't quietly reintroduce duplicated presentation logic:
//   • UI consumers read the presentation API, never detector modules;
//   • UI consumers never call raw getProactiveInsights() — only the canonical
//     engine.getPresentedInsights() service;
//   • AppShell mounts exactly ONE Recommendation Bubble;
//   • Business Manager renders the proactive section (additive wiring).
// Reads source text (node env) — no rendering required.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

const SECTION = 'src/modules/intelligence/proactive/ProactiveInsightsSection.tsx';
const BUBBLE = 'src/modules/intelligence/proactive/RecommendationBubble.tsx';
const HOOK = 'src/modules/intelligence/proactive/usePresentedProactiveInsights.ts';
const APPSHELL = 'src/components/layout/AppShell.tsx';
const BM = 'src/modules/intelligence/manager/BusinessManagerPage.tsx';

const UI_CONSUMERS = [SECTION, BUBBLE, HOOK, BM];

describe('consumer import discipline', () => {
  it('UI consumers never import proactive detector modules directly', () => {
    for (const f of UI_CONSUMERS) {
      expect(read(f)).not.toMatch(/proactiveInsights\/detectors/);
    }
  });

  it('UI consumers never call raw getProactiveInsights() — only the presented service', () => {
    for (const f of UI_CONSUMERS) {
      expect(read(f)).not.toContain('getProactiveInsights(');
    }
  });

  it('section, bubble and hook reference the canonical presentation API', () => {
    expect(read(SECTION)).toMatch(/@\/services\/intelligence\/presentation/);
    expect(read(BUBBLE)).toMatch(/@\/services\/intelligence\/presentation/);
    expect(read(HOOK)).toMatch(/@\/services\/intelligence\/presentation/);
  });

  it('the hook obtains data through engine.getPresentedInsights (the single service)', () => {
    expect(read(HOOK)).toContain('getPresentedInsights');
  });
});

describe('single mount + additive wiring', () => {
  it('AppShell mounts exactly one Recommendation Bubble', () => {
    const src = read(APPSHELL);
    const mounts = src.match(/<RecommendationBubble/g) ?? [];
    expect(mounts).toHaveLength(1);
    expect(src).toContain('modules/intelligence/proactive/RecommendationBubble');
  });

  it('Business Manager renders the proactive section additively', () => {
    const src = read(BM);
    expect(src).toContain('ProactiveInsightsSection');
    expect(src).toContain('getPresentedInsights');
  });
});
