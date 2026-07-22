// P0-INV-1 — behavioral tests for the scan-ownership guard (isScanExemptElement).
// This is the exact decision the global scanner (useBarcodeScanner) consults at
// BOTH flush paths to decide whether to route a scan. The Inventory New Item
// modal claims scan ownership by wrapping its content in [data-scanner-exempt];
// these tests prove the guard honors that claim (and does NOT over-suppress a
// normal inventory-search field). Pure — no DOM environment required.

import { describe, it, expect } from 'vitest';
import { isScanExemptElement } from './useBarcodeScanner';

type El = { tagName?: string; type?: string; closest?: (sel: string) => unknown };
const el = (over: El = {}): El => ({ tagName: 'INPUT', type: 'text', closest: () => null, ...over });

describe('isScanExemptElement (P0-INV-1 scan ownership)', () => {
  it('null / undefined → NOT exempt', () => {
    expect(isScanExemptElement(null)).toBe(false);
    expect(isScanExemptElement(undefined)).toBe(false);
  });

  it('password input → exempt (Admin/approval PIN gates)', () => {
    expect(isScanExemptElement(el({ tagName: 'INPUT', type: 'password' }))).toBe(true);
  });

  it('a normal inventory-search text input (NOT inside an exempt modal) → NOT exempt', () => {
    // closest → null means the global scanner still processes it, so scanning to
    // find an existing item on the Inventory page keeps working (Section 8).
    expect(isScanExemptElement(el({ tagName: 'INPUT', type: 'text', closest: () => null }))).toBe(false);
  });

  it('a field INSIDE [data-scanner-exempt] (New Item modal) → exempt', () => {
    const modalRoot = { id: 'new-item-modal' };
    const field = el({
      tagName: 'INPUT',
      type: 'text',
      closest: (sel) => (sel === '[data-scanner-exempt]' ? modalRoot : null),
    });
    expect(isScanExemptElement(field)).toBe(true);
  });

  it('exemption is driven ONLY by the data-scanner-exempt selector', () => {
    const field = el({ closest: (sel) => (sel === '[data-scanner-exempt]' ? {} : null) });
    expect(isScanExemptElement(field)).toBe(true);
    // A field whose closest never matches that selector is not exempt.
    expect(isScanExemptElement(el({ closest: (sel) => (sel === '.something-else' ? {} : null) }))).toBe(false);
  });

  it('a non-input focus target inside the exempt modal (e.g. a focused button) → exempt', () => {
    expect(isScanExemptElement(el({ tagName: 'BUTTON', type: undefined, closest: () => ({}) }))).toBe(true);
  });

  it('an element with no closest() (defensive) → NOT exempt', () => {
    expect(isScanExemptElement({ tagName: 'DIV' })).toBe(false);
  });

  it('a text input is NOT treated as a password input', () => {
    expect(isScanExemptElement(el({ tagName: 'INPUT', type: 'text', closest: () => null }))).toBe(false);
  });
});
