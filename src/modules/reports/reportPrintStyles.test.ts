// ============================================================
// CELLHUB-PRINT-REPORT-CONTRAST-REGRESSION — structural print-contrast lock.
//
// Guards the Reports print stylesheet against the regression class that
// produced the faded owner report: screen-ish light grays, sub-7.5pt text,
// alpha colors, invisible borders, transform/zoom rasterization tricks.
// (Visual acceptance is performed on a rendered fixture — these assertions
// only lock the structural contract so it cannot silently regress.)
// ============================================================
import { describe, it, expect } from 'vitest';
import { REPORT_PRINT_CSS } from './reportPrintStyles';

const css = REPORT_PRINT_CSS;

describe('report print CSS — contrast contract', () => {
  it('never uses opacity, alpha colors, transforms, zoom or filters', () => {
    expect(css).not.toMatch(/\bopacity\s*:/i);
    expect(css).not.toMatch(/rgba\(/i);
    expect(css).not.toMatch(/(?<!text-)\btransform\s*:/i); // text-transform (case styling) is fine
    expect(css).not.toMatch(/\bzoom\s*:/i);
    expect(css).not.toMatch(/\bfilter\s*:/i);
  });

  it('bans the faded-print grays the redesign shipped (#666/#888/#aaa/#555/#999/#ccc text)', () => {
    for (const banned of ['#666', '#888', '#aaa', '#555', '#999', '#ccc', '#bbb', '#ddd']) {
      expect(css.toLowerCase()).not.toContain(banned);
    }
    // Light slate tones may appear ONLY as backgrounds, never as text colors.
    expect(css).not.toMatch(/color:\s*#(f1f5f9|e2e8f0|cbd5e1|94a3b8)/i);
    // The old near-invisible row separator is gone entirely as a border.
    expect(css).not.toMatch(/border[^;]*#(f1f5f9|e2e8f0)/i);
  });

  it('primary text is near-black and secondary text is print-safe dark gray', () => {
    expect(css).toMatch(/body\s*{[^}]*color:\s*#111111/i);
    expect(css).toMatch(/\.report-meta\s*{[^}]*color:\s*#374151/i);
    expect(css).toMatch(/\.summary-card \.label\s*{[^}]*color:\s*#374151/i);
    expect(css).toMatch(/\.summary-card \.sub\s*{[^}]*color:\s*#374151/i);
    expect(css).toMatch(/\.pp-detail td\s*{[^}]*color:\s*#374151/i);
  });

  it('financial colors use dark print-safe tones at weight 700', () => {
    expect(css).toMatch(/\.text-green\s*{[^}]*color:\s*#15803d;[^}]*font-weight:\s*700/i);
    expect(css).toMatch(/\.text-red\s*{[^}]*color:\s*#b91c1c;[^}]*font-weight:\s*700/i);
    expect(css).toMatch(/\.value-green\s*{[^}]*#15803d/i);
    expect(css).toMatch(/\.value-red\s*{[^}]*#b91c1c/i);
  });

  it('no font below 7.5pt anywhere; table body at least 8.5pt weight 500', () => {
    const sizes = [...css.matchAll(/font-size:\s*([\d.]+)pt/gi)].map((m) => parseFloat(m[1]));
    expect(sizes.length).toBeGreaterThan(5);
    for (const s of sizes) expect(s, `font-size ${s}pt`).toBeGreaterThanOrEqual(7.5);
    expect(css).toMatch(/table\s*{[^}]*font-size:\s*8\.5pt/i);
    expect(css).toMatch(/(^|\n)td\s*{[^}]*font-weight:\s*500/i);
  });

  it('borders are grayscale-visible (#9ca3af rows, #64748b under headers, solid 1px)', () => {
    expect(css).toMatch(/(^|\n)td\s*{[^}]*border-bottom:\s*1px solid #9ca3af/i);
    expect(css).toMatch(/(^|\n)th\s*{[^}]*border-bottom:\s*1px solid #64748b/i);
    expect(css).toMatch(/\.summary-card\s*{[^}]*border:\s*1px solid #9ca3af/i);
  });

  it('dark section headers keep solid backgrounds that reliably print', () => {
    expect(css).toMatch(/\.section-header\s*{[^}]*background:\s*#1a1a2e;[^}]*color:\s*#ffffff;[^}]*font-weight:\s*700/i);
    expect(css).toMatch(/-webkit-print-color-adjust:\s*exact/i);
    expect(css).toMatch(/(^|[^-])print-color-adjust:\s*exact/i);
  });

  it('page-break safety: repeating table headers, sections keep their tables, totals stay attached', () => {
    expect(css).toMatch(/thead\s*{\s*display:\s*table-header-group/i);
    expect(css).toMatch(/\.section-header\s*{[^}]*page-break-after:\s*avoid/i);
    expect(css).toMatch(/tbody tr\s*{\s*page-break-inside:\s*avoid/i);
    expect(css).toMatch(/\.row-total\s*{[^}]*page-break-before:\s*avoid/i);
    expect(css).toMatch(/\.net-banner\s*{[^}]*page-break-inside:\s*avoid/i);
  });

  it('stays a letter-sized vector document (no raster substitution, no root scaling)', () => {
    expect(css).toMatch(/@page\s*{\s*size:\s*letter/i);
    expect(css).not.toMatch(/<img|canvas|data:image/i);
  });
});
