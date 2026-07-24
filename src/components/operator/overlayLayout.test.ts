// ============================================================
// R-OPERATOR-PANEL-TWO-COLUMN-V1 — overlay layout tests
// Pure geometry: column mode, width, viewport clamping and the
// height cap. No pixel-perfect or animation-frame assertions.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  computeOverlayLayout, clampOverlayLeft, capOverlayHeight,
  OVERLAY_WIDTH_NARROW, OVERLAY_WIDTH_WIDE, OVERLAY_TWO_COLUMN_MIN_VIEWPORT,
} from './overlayLayout';

const PAD = 16;

describe('computeOverlayLayout', () => {
  it('wide viewports get the two-column 560px panel', () => {
    for (const vw of [1920, 1366, 800, OVERLAY_TWO_COLUMN_MIN_VIEWPORT]) {
      const l = computeOverlayLayout(vw, PAD);
      expect(l.twoColumn).toBe(true);
      expect(l.width).toBe(OVERLAY_WIDTH_WIDE);
      expect(l.width).toBeGreaterThanOrEqual(520);
      expect(l.width).toBeLessThanOrEqual(580);          // mandated band
    }
  });

  it('narrow viewports fall back to the original single column', () => {
    for (const vw of [OVERLAY_TWO_COLUMN_MIN_VIEWPORT - 1, 700, 500, 380]) {
      const l = computeOverlayLayout(vw, PAD);
      expect(l.twoColumn).toBe(false);
      expect(l.width).toBeLessThanOrEqual(OVERLAY_WIDTH_NARROW);
    }
  });

  it('the panel never exceeds the viewport minus both edge margins (no horizontal overflow)', () => {
    for (const vw of [1920, 760, 600, 320, 200]) {
      const l = computeOverlayLayout(vw, PAD);
      expect(l.width).toBeLessThanOrEqual(Math.max(120, vw - PAD * 2));
    }
  });
});

describe('clampOverlayLeft', () => {
  it('clamps a saved position that would push the wider panel off the right edge', () => {
    const vw = 1366;
    const { width } = computeOverlayLayout(vw, PAD);
    const left = clampOverlayLeft(vw - 100, width, vw, PAD);   // bubble near right edge
    expect(left + width).toBeLessThanOrEqual(vw - PAD);
    expect(left).toBeGreaterThanOrEqual(PAD);
  });

  it('clamps a position off the left edge without erasing the intent', () => {
    const vw = 1920;
    const { width } = computeOverlayLayout(vw, PAD);
    expect(clampOverlayLeft(-500, width, vw, PAD)).toBe(PAD);
    // A valid centered position passes through untouched.
    const centered = Math.round((vw - width) / 2);
    expect(clampOverlayLeft(centered, width, vw, PAD)).toBe(centered);
  });
});

describe('capOverlayHeight', () => {
  it('caps at 84vh and respects the smaller available-space limit', () => {
    expect(capOverlayHeight(5000, 1080)).toBe(Math.round(1080 * 0.84));   // cap engages
    expect(capOverlayHeight(300, 1080)).toBe(300);                        // space limit wins
    expect(capOverlayHeight(700, 768)).toBe(Math.round(768 * 0.84));      // 1366x768 case
  });
});

describe('structural locks — panel composition', () => {
  it('the bubble consumes the shared layout helpers and keeps drag handlers intact', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync('src/components/operator/FloatingOperatorBubble.tsx', 'utf8');
    expect(src).toContain('computeOverlayLayout');           // single layout source
    expect(src).toContain('clampOverlayLeft');
    expect(src).toContain('handleMouseDown');                // drag preserved
    expect(src).toContain('resetPosition');                  // reset preserved
    expect(src).toContain('/* left column */');              // two-column structure
    expect(src).toContain('/* right column */');
    // Reviewing-sale/context region renders BEFORE the two-column region
    // (full width), and suggestions live in the bounded-scroll right column.
    const leftCol = src.indexOf('{/* left column */}');
    const rightCol = src.indexOf('{/* right column */}');
    const suggestionsJsx = src.indexOf('Live-context suggestions + executable actions');
    expect(leftCol).toBeGreaterThan(-1);
    expect(rightCol).toBeGreaterThan(leftCol);          // left column precedes right
    expect(suggestionsJsx).toBeGreaterThan(rightCol);   // suggestions live in the right column
    expect(src).toContain("maxHeight: overlayTwoCol ? '34vh' : '40vh'"); // bounded suggestions scroll
  });
});
