// P0-C1c (F-C) — behavioral tests for the safe external-open contract.
// Node env: openExternalPortal takes an injectable `win`/`electron`/`online`
// so the browser vs Electron opener contract is exercised without a real DOM.

import { describe, it, expect, vi } from 'vitest';
import { openExternalPortal, toSafeExternalUrl } from './phonePaymentPortal';

const onlineTrue = () => true;
const onlineFalse = () => false;

describe('toSafeExternalUrl — scheme validation (F-C)', () => {
  it('accepts http and https as-is', () => {
    expect(toSafeExternalUrl('https://portal.att.com/pay')).toBe('https://portal.att.com/pay');
    expect(toSafeExternalUrl('http://10.0.0.5/x')).toBe('http://10.0.0.5/x');
  });
  it('normalizes a schemeless bare domain to https (preserves configured portals)', () => {
    expect(toSafeExternalUrl('portal.att.com/pay')).toBe('https://portal.att.com/pay');
  });
  it('rejects javascript:, data:, file:, and empty/whitespace', () => {
    expect(toSafeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(toSafeExternalUrl('data:text/html,<b>x</b>')).toBeNull();
    expect(toSafeExternalUrl('file:///etc/passwd')).toBeNull();
    expect(toSafeExternalUrl('')).toBeNull();
    expect(toSafeExternalUrl('   ')).toBeNull();
  });
});

describe('openExternalPortal — BROWSER/PWA opener contract (F-C)', () => {
  const deps = (win: unknown) => ({ win: win as never, electron: false, online: onlineTrue });

  it('null window.open handle → popup_blocked (blank-open makes null unambiguous)', () => {
    const open = vi.fn(() => null);
    const res = openExternalPortal('https://pay.example.com', 'w', 'noopener', deps({ open }));
    expect(res).toEqual({ ok: false, reason: 'popup_blocked' });
    // Blank-open first: called with '' (no noopener) so a real success returns a handle.
    expect(open).toHaveBeenCalledWith('', 'w');
  });

  it('successful open severs opener BEFORE navigating, then location.replace(url)', () => {
    const replace = vi.fn();
    const handle: { opener: unknown; location: { replace: typeof replace } } = { opener: {}, location: { replace } };
    const open = vi.fn(() => handle);
    const res = openExternalPortal('https://pay.example.com/x', 'w', 'noopener', deps({ open }));
    expect(res.ok).toBe(true);
    expect(handle.opener).toBeNull();                         // reverse-tabnabbing mitigated
    expect(replace).toHaveBeenCalledWith('https://pay.example.com/x');
  });

  it('navigation throw → open_exception (window closed, NOT reported success → no workflow)', () => {
    const close = vi.fn();
    const handle = { opener: {}, location: { replace: () => { throw new Error('nav'); } }, close };
    const res = openExternalPortal('https://pay.example.com', 'w', undefined, deps({ open: () => handle }));
    expect(res).toEqual({ ok: false, reason: 'open_exception' });
    expect(close).toHaveBeenCalled();
  });

  it('dangerous schemes are rejected BEFORE any window is opened', () => {
    const open = vi.fn();
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'file:///x']) {
      expect(openExternalPortal(bad, 'w', undefined, deps({ open }))).toEqual({ ok: false, reason: 'invalid_url' });
    }
    expect(open).not.toHaveBeenCalled();
  });

  it('offline → offline, nothing opened', () => {
    const open = vi.fn();
    const res = openExternalPortal('https://x.com', 'w', undefined, { win: { open } as never, electron: false, online: onlineFalse });
    expect(res).toEqual({ ok: false, reason: 'offline' });
    expect(open).not.toHaveBeenCalled();
  });

  it('missing url → missing_url', () => {
    expect(openExternalPortal('', 'w', undefined, deps({ open: vi.fn() }))).toEqual({ ok: false, reason: 'missing_url' });
  });
});

describe('openExternalPortal — ELECTRON opener contract (F-C)', () => {
  it('null return is NOT a popup block — it is success (never false-block the desktop app)', () => {
    const open = vi.fn(() => null);
    const res = openExternalPortal('https://pay.example.com', 'w', 'noopener,noreferrer', { win: { open } as never, electron: true, online: onlineTrue });
    expect(res).toEqual({ ok: true, handle: null });
    expect(open).toHaveBeenCalledWith('https://pay.example.com', 'w', 'noopener,noreferrer');
  });

  it('a thrown error is still a failure (open_exception)', () => {
    const open = vi.fn(() => { throw new Error('boom'); });
    const res = openExternalPortal('https://pay.example.com', 'w', undefined, { win: { open } as never, electron: true, online: onlineTrue });
    expect(res).toEqual({ ok: false, reason: 'open_exception' });
  });

  it('offline is a failure even in Electron', () => {
    const open = vi.fn();
    const res = openExternalPortal('https://x.com', 'w', undefined, { win: { open } as never, electron: true, online: onlineFalse });
    expect(res).toEqual({ ok: false, reason: 'offline' });
    expect(open).not.toHaveBeenCalled();
  });

  it('a dangerous scheme is rejected in Electron too', () => {
    const open = vi.fn();
    const res = openExternalPortal('javascript:alert(1)', 'w', undefined, { win: { open } as never, electron: true, online: onlineTrue });
    expect(res).toEqual({ ok: false, reason: 'invalid_url' });
    expect(open).not.toHaveBeenCalled();
  });
});
