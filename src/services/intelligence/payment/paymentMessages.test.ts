// ============================================================
// PAYMENT DATE FINDER — F2 message builder tests.
// Exercises tone × language × clause-composition + BMP sanitizing so the
// outreach copy is verified, not just reasoned about.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  buildPaymentMessage,
  MESSAGE_TONES,
  TONE_LABELS,
  type MessageTone,
  type MsgLang,
} from './paymentMessages';

const base = {
  customerName: 'Ana García',
  storeName: 'Go Cellular',
  dueDate: '07/07/2026',
  closureStart: '07/05/2026',
  closureEnd: '07/10/2026',
};

describe('buildPaymentMessage — structure', () => {
  it('greets with the first name only', () => {
    const msg = buildPaymentMessage(base, 'en', 'friendly');
    expect(msg.startsWith('Hi Ana!')).toBe(true);
    expect(msg).not.toContain('García');
  });

  it('includes due date, closure window, ask and store sign-off', () => {
    const msg = buildPaymentMessage(base, 'en', 'friendly');
    expect(msg).toContain('07/07/2026');
    expect(msg).toContain('07/05/2026');
    expect(msg).toContain('07/10/2026');
    expect(msg).toContain('Go Cellular');
  });

  it('is deterministic (same inputs → same output)', () => {
    expect(buildPaymentMessage(base, 'es', 'professional')).toBe(
      buildPaymentMessage(base, 'es', 'professional'),
    );
  });
});

describe('buildPaymentMessage — estimated vs exact due date', () => {
  it('EN: estimated → "around", exact → "on"', () => {
    const est = buildPaymentMessage({ ...base, isEstimated: true }, 'en', 'friendly');
    const exact = buildPaymentMessage({ ...base, isEstimated: false }, 'en', 'friendly');
    expect(est).toContain('due around 07/07/2026');
    expect(exact).toContain('due on 07/07/2026');
  });

  it('ES: estimated → "aproximadamente el"', () => {
    const est = buildPaymentMessage({ ...base, isEstimated: true }, 'es', 'friendly');
    expect(est).toContain('aproximadamente el 07/07/2026');
  });

  it('PT: estimated → "aproximadamente em"', () => {
    const est = buildPaymentMessage({ ...base, isEstimated: true }, 'pt', 'friendly');
    expect(est).toContain('aproximadamente em 07/07/2026');
  });
});

describe('buildPaymentMessage — clause dropping', () => {
  it('omits the closure sentence when no window is given', () => {
    const msg = buildPaymentMessage(
      { customerName: 'Bob', storeName: 'Go Cellular', dueDate: '07/07/2026' },
      'en',
      'friendly',
    );
    expect(msg).toContain('07/07/2026');
    expect(msg).not.toContain('out of the office');
    expect(msg).not.toContain('undefined');
  });

  it('omits the due sentence when no due date is given', () => {
    const msg = buildPaymentMessage(
      { customerName: 'Bob', storeName: 'Go Cellular', closureStart: '07/05/2026', closureEnd: '07/10/2026' },
      'en',
      'friendly',
    );
    expect(msg).toContain('out of the office');
    expect(msg).not.toContain('phone payment is due');
    expect(msg).not.toContain('undefined');
  });

  it('requires BOTH closure endpoints to render the closure clause', () => {
    const msg = buildPaymentMessage(
      { customerName: 'Bob', storeName: 'Go Cellular', dueDate: '07/07/2026', closureStart: '07/05/2026' },
      'en',
      'friendly',
    );
    expect(msg).not.toContain('out of the office');
  });
});

describe('buildPaymentMessage — every tone × lang produces clean output', () => {
  const langs: MsgLang[] = ['en', 'es', 'pt'];
  for (const lang of langs) {
    for (const tone of MESSAGE_TONES) {
      it(`${lang}/${tone} has greeting, body and store, no placeholder leaks`, () => {
        const msg = buildPaymentMessage(base, lang, tone);
        expect(msg.length).toBeGreaterThan(20);
        expect(msg).toContain('Go Cellular');
        expect(msg).not.toContain('undefined');
        expect(msg).not.toMatch(/\{\w+\}/); // no leftover {placeholder}
      });
    }
  }
});

describe('buildPaymentMessage — tone differentiation & fallbacks', () => {
  it('professional and direct read differently', () => {
    const pro = buildPaymentMessage(base, 'en', 'professional');
    const direct = buildPaymentMessage(base, 'en', 'direct');
    expect(pro).not.toBe(direct);
    expect(pro).toContain('Hello Ana,');
    expect(direct).toContain('Hi Ana,');
  });

  it('urgent conveys urgency', () => {
    const urgent = buildPaymentMessage(base, 'en', 'urgent');
    expect(urgent.toLowerCase()).toContain('about to close');
  });

  it('falls back to en/friendly on unknown lang/tone', () => {
    const msg = buildPaymentMessage(base, 'xx' as MsgLang, 'zz' as MessageTone);
    expect(msg).toContain('Go Cellular');
    expect(msg.startsWith('Hi Ana!')).toBe(true);
  });
});

describe('buildPaymentMessage — multi-line grouping', () => {
  it('EN: 2 lines → single grouped note "covers all 2 of your lines"', () => {
    const msg = buildPaymentMessage({ ...base, lineCount: 2 }, 'en', 'friendly');
    expect(msg).toContain('covers all 2 of your lines');
  });

  it('ES: multi-line note is present and in Spanish (tuteo)', () => {
    const msg = buildPaymentMessage({ ...base, lineCount: 3 }, 'es', 'professional');
    expect(msg).toContain('Esto cubre tus 3 líneas');
    expect(msg).not.toMatch(/tenés|querés|podés/); // no voseo
  });

  it('PT: multi-line note is present and in Portuguese', () => {
    const msg = buildPaymentMessage({ ...base, lineCount: 2 }, 'pt', 'direct');
    expect(msg).toContain('Isto cobre todas as suas 2 linhas');
  });

  it('single line (lineCount 1 or undefined) stays silent — no grouping note', () => {
    const one = buildPaymentMessage({ ...base, lineCount: 1 }, 'en', 'friendly');
    const none = buildPaymentMessage(base, 'en', 'friendly');
    expect(one).not.toContain('covers all');
    expect(none).not.toContain('covers all');
  });

  it('multi-line works across all tones without leaks', () => {
    for (const tone of MESSAGE_TONES) {
      const msg = buildPaymentMessage({ ...base, lineCount: 2 }, 'en', tone);
      expect(msg).toContain('covers all 2 of your lines');
      expect(msg).not.toContain('undefined');
    }
  });

  it('multi-line + estimated due date both render together', () => {
    const msg = buildPaymentMessage({ ...base, lineCount: 2, isEstimated: true }, 'en', 'friendly');
    expect(msg).toContain('due around 07/07/2026');
    expect(msg).toContain('covers all 2 of your lines');
  });
});

describe('buildPaymentMessage — BMP sanitizing', () => {
  it('strips non-BMP emoji from interpolated store/name', () => {
    const msg = buildPaymentMessage(
      { ...base, storeName: 'Go Cellular 🎉', customerName: 'Ana 😀 García' },
      'en',
      'friendly',
    );
    expect(msg).not.toMatch(/[\u{10000}-\u{10FFFF}]/u);
    expect(msg).toContain('Go Cellular');
  });
});

describe('metadata exports', () => {
  it('MESSAGE_TONES lists all four tones', () => {
    expect(MESSAGE_TONES).toEqual(['friendly', 'professional', 'direct', 'urgent']);
  });

  it('TONE_LABELS is trilingual for every tone', () => {
    for (const tone of MESSAGE_TONES) {
      expect(TONE_LABELS[tone].en).toBeTruthy();
      expect(TONE_LABELS[tone].es).toBeTruthy();
      expect(TONE_LABELS[tone].pt).toBeTruthy();
    }
  });
});
