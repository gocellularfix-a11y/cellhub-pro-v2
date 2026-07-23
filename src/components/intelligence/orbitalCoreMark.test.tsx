// ============================================================
// R-ORBITAL-CORE-IDENTITY-V1 — Orbital Core identity tests
//
// Structural assertions via react-dom/server (no RTL in this repo):
// variant rendering, severity mapping, accessibility contract,
// reduced-motion CSS, naming cleanup and prohibited-identity removal.
// Intentionally NOT tied to animation frame timing.
// ============================================================
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import OrbitalCoreMark, {
  ORBITAL_STATE_COLORS,
  ORBITAL_CORE_CSS,
  satelliteVisible,
  type OrbitalCoreState,
} from './OrbitalCoreMark';
import { NAV_TABS, ASSIGNABLE_MODULES } from '@/config/constants';
// Leaf import — the i18n index pulls React providers that need a DOM.
import { translations } from '@/i18n/translations';

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe('OrbitalCoreMark — canonical variants', () => {
  it('seal renders core + ring but NEVER a satellite (≤16px rule)', () => {
    const html = render(<OrbitalCoreMark variant="seal" size={15} state="watch" />);
    expect(html).toContain('data-orbital-core="seal"');
    expect(html).toContain('<path');                              // orbital ring halves
    expect(html).not.toContain(ORBITAL_STATE_COLORS.watch);       // no satellite dot
  });

  it('mark renders the satellite only for severity states, not for idle', () => {
    const idle = render(<OrbitalCoreMark variant="mark" size={22} state="idle" />);
    expect(idle).not.toContain(ORBITAL_STATE_COLORS.idle);        // no satellite at rest
    const watch = render(<OrbitalCoreMark variant="mark" size={22} state="watch" />);
    expect(watch).toContain(ORBITAL_STATE_COLORS.watch);          // emerald satellite
  });

  it('living variant always carries the satellite and, when animated, the spin class', () => {
    const still = render(<OrbitalCoreMark variant="living" size={56} state="idle" />);
    expect(still).toContain(ORBITAL_STATE_COLORS.idle);
    expect(still).not.toContain('ch-orbital-spin');
    const idleLive = render(<OrbitalCoreMark variant="living" size={56} state="idle" animated />);
    expect(idleLive).toContain('ch-orbital-spin-idle');
    expect(idleLive).toContain('ch-orbital-breath');
    const processing = render(<OrbitalCoreMark variant="living" size={56} state="processing" animated />);
    expect(processing).toContain('ch-orbital-spin-processing');
  });

  it('the ring passes behind AND in front of the core (two path halves around the circle)', () => {
    const html = render(<OrbitalCoreMark variant="mark" size={22} />);
    const firstPath = html.indexOf('<path');
    const core = html.indexOf('<circle');
    const secondPath = html.indexOf('<path', firstPath + 1);
    expect(firstPath).toBeGreaterThan(-1);
    expect(core).toBeGreaterThan(firstPath);       // back half → core
    expect(secondPath).toBeGreaterThan(core);      // core → front half
  });
});

describe('OrbitalCoreMark — severity mapping (canonical model, no second model)', () => {
  it('maps the four canonical severities to the existing CellHub tones', () => {
    expect(ORBITAL_STATE_COLORS.info).toBe('#94a3b8');       // neutral slate
    expect(ORBITAL_STATE_COLORS.watch).toBe('#10b981');      // emerald opportunity
    expect(ORBITAL_STATE_COLORS.important).toBe('#f59e0b');  // amber
    expect(ORBITAL_STATE_COLORS.critical).toBe('#ef4444');   // red, persistent not flashing
  });

  it('idle and processing are UI states, kept separate from severities', () => {
    const severities: OrbitalCoreState[] = ['info', 'watch', 'important', 'critical'];
    expect(severities).not.toContain('idle');
    expect(severities).not.toContain('processing');
    // satellite policy: severities surface on the static mark; UI states do not.
    for (const s of severities) expect(satelliteVisible('mark', s)).toBe(true);
    expect(satelliteVisible('mark', 'idle')).toBe(false);
    expect(satelliteVisible('mark', 'processing')).toBe(false);
    expect(satelliteVisible('seal', 'critical')).toBe(false);  // never on the seal
    expect(satelliteVisible('living', 'idle')).toBe(true);     // always on the orb
  });

  it('the critical state renders satellite + badge (never color alone)', () => {
    const html = render(<OrbitalCoreMark variant="mark" size={22} state="critical" badge={3} />);
    expect(html).toContain(ORBITAL_STATE_COLORS.critical);
    expect(html).toContain('>3<');                              // numeric badge
  });
});

describe('OrbitalCoreMark — accessibility', () => {
  it('decorative marks are aria-hidden; interactive marks expose an accessible name', () => {
    expect(render(<OrbitalCoreMark decorative />)).toContain('aria-hidden="true"');
    const named = render(<OrbitalCoreMark decorative={false} label="CellHub Intelligence — 2 opportunities" />);
    expect(named).toContain('role="img"');
    expect(named).toContain('aria-label="CellHub Intelligence — 2 opportunities"');
  });

  it('reduced motion: the injected stylesheet freezes orbit and breathing', () => {
    expect(ORBITAL_CORE_CSS).toContain('@media (prefers-reduced-motion: reduce)');
    expect(ORBITAL_CORE_CSS).toContain('animation: none !important');
    // Calm-motion contract: idle ≈40s, processing ≈12s, breath 6s.
    expect(ORBITAL_CORE_CSS).toContain('40s');
    expect(ORBITAL_CORE_CSS).toContain('12s');
    expect(ORBITAL_CORE_CSS).toContain('6s');
  });
});

describe('Identity cleanup — prohibited Brain/Robot removal', () => {
  it('no intelligence navigation entry carries the brain or robot emoji', () => {
    for (const tab of NAV_TABS) {
      expect(tab.icon).not.toContain('🧠');
      expect(tab.icon).not.toContain('🤖');
    }
    for (const m of ASSIGNABLE_MODULES) {
      expect(m.icon).not.toContain('🧠');
      expect(m.icon).not.toContain('🤖');
    }
  });

  it('intelligence navigation is preserved (same ids, same admin gating)', () => {
    const intel = NAV_TABS.find((t) => t.id === 'intelligence');
    expect(intel).toBeDefined();
    expect(intel!.adminOnly).toBe(true);
    expect(NAV_TABS.some((t) => t.id === 'manager')).toBe(true); // Business Insight route intact
  });
});

describe('Identity cleanup — CellHub Intelligence naming (EN/ES/PT)', () => {
  const resolve = (key: string, lang: 'en' | 'es' | 'pt'): string => {
    const entry = (translations as Record<string, Record<string, unknown>>)[key];
    expect(entry, `missing translation key ${key}`).toBeDefined();
    const v = entry[lang];
    return typeof v === 'function' ? (v as (...a: unknown[]) => string)(2) : String(v);
  };

  it('the chat surface label no longer says "AI Assistant" in any language', () => {
    for (const lang of ['en', 'es', 'pt'] as const) {
      const v = resolve('sidebar.aiAssistant', lang);
      expect(v.toLowerCase()).not.toContain('ai assistant');
      expect(v.toLowerCase()).not.toContain('asistente ia');
      expect(v.toLowerCase()).not.toContain('assistente ia');
      expect(v).not.toContain('🤖');
    }
  });

  it('the panel title is CellHub Intelligence in all three languages', () => {
    expect(resolve('ai.assistantTitle', 'en')).toBe('CellHub Intelligence');
    expect(resolve('ai.assistantTitle', 'es')).toBe('Inteligencia de CellHub');
    expect(resolve('ai.assistantTitle', 'pt')).toBe('Inteligência CellHub');
  });

  it('the dynamic bubble aria label resolves with a count in all three languages', () => {
    for (const lang of ['en', 'es', 'pt'] as const) {
      const v = resolve('intel.bubbleAria', lang);
      expect(v).toContain('2');
      expect(v.toLowerCase()).toContain(lang === 'en' ? 'cellhub intelligence' : 'cellhub');
    }
  });

  it('the intelligence tab label stays intact (navigation naming preserved)', () => {
    expect(resolve('nav.intelligence', 'en')).toBe('Intelligence');
    expect(resolve('nav.intelligence', 'es')).toBe('Inteligencia');
    expect(resolve('nav.intelligence', 'pt')).toBe('Inteligência');
  });
});
