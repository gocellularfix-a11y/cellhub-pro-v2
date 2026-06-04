// ============================================================
// R-INTELLIGENCE-RUNTIME-POLISH-V1 — markdown display sanitizer.
// Locks that raw markdown markers never leak into the operator UI text while
// the meaning (words, numbers, structure) is preserved.
// ============================================================

import { describe, it, expect } from 'vitest';
import { sanitizeMarkdown } from './ResponseCard';

describe('sanitizeMarkdown', () => {
  it('strips **bold** but keeps the inner text', () => {
    expect(sanitizeMarkdown('**Next best action**')).toBe('Next best action');
    expect(sanitizeMarkdown('Do this: **Call Maria now**')).toBe('Do this: Call Maria now');
  });

  it('strips __bold__ markers', () => {
    expect(sanitizeMarkdown('__Suggested next steps__')).toBe('Suggested next steps');
  });

  it('removes stray/unmatched ** markers', () => {
    expect(sanitizeMarkdown('Header** with leftover')).toBe('Header with leftover');
  });

  it('strips leading markdown headings at line start', () => {
    expect(sanitizeMarkdown('## Recommended Focus')).toBe('Recommended Focus');
    expect(sanitizeMarkdown('line one\n### Heading two')).toBe('line one\nHeading two');
  });

  it('converts leading markdown bullets to a clean bullet dot', () => {
    expect(sanitizeMarkdown('- first\n- second')).toBe('• first\n• second');
    expect(sanitizeMarkdown('* alpha\n* beta')).toBe('• alpha\n• beta');
  });

  it('preserves meaning: money, names, and existing • bullets untouched', () => {
    expect(sanitizeMarkdown('Balance $320.00 for T-Mobile')).toBe('Balance $320.00 for T-Mobile');
    expect(sanitizeMarkdown('• already clean')).toBe('• already clean');
    // a lone dash mid-word (e.g. carrier name) is NOT a bullet → untouched
    expect(sanitizeMarkdown('Wi-Fi setup')).toBe('Wi-Fi setup');
  });

  it('handles empty / falsy input safely', () => {
    expect(sanitizeMarkdown('')).toBe('');
  });
});
