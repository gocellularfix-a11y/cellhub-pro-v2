// ============================================================
// SPECIAL-ORDERS-FRESH-PIN — admin PIN authorization contract tests.
//
// Proves the destructive-action authorization can NEVER be bypassed by role,
// session, cached state or an empty PIN. authorizeAdminPin is pure and takes
// ONLY (entered, configured) — there is structurally no role/session input to
// bypass with. An unconfigured (blank) admin PIN never authorizes.
// ============================================================

import { describe, it, expect } from 'vitest';
import { authorizeAdminPin, adminPinNotConfiguredMessage, adminPinInvalidMessage } from './adminPinAuth';
import { hashPin } from '@/utils/pinHash';

describe('authorizeAdminPin — no bypass, ever', () => {
  it('1/2. requires a matching PIN regardless of who is logged in (no role/session input exists)', () => {
    // The function has no role/session parameter — an admin (or a previously
    // unlocked session) cannot be represented, let alone bypass. A wrong entry
    // is always invalid.
    expect(authorizeAdminPin('9999', '4321')).toBe('invalid');
    expect(authorizeAdminPin('4321', '4321')).toBe('ok');
  });

  it('3. no cached/session reuse — decision depends only on the entry vs configured', () => {
    // Same configured PIN, two entries: only the correct one passes; there is
    // no state carried between calls.
    expect(authorizeAdminPin('4321', '4321')).toBe('ok');
    expect(authorizeAdminPin('', '4321')).toBe('invalid');   // empty entry != a valid session
  });

  it('4. empty / unconfigured admin PIN blocks (never approves, even for an empty entry)', () => {
    expect(authorizeAdminPin('', '')).toBe('not_configured');
    expect(authorizeAdminPin('1234', '')).toBe('not_configured');
    expect(authorizeAdminPin('', '   ')).toBe('not_configured');
    expect(authorizeAdminPin('anything', undefined)).toBe('not_configured');
    expect(authorizeAdminPin('anything', null)).toBe('not_configured');
  });

  it('5. wrong PIN → invalid (never ok)', () => {
    expect(authorizeAdminPin('0000', '4321')).toBe('invalid');
    expect(authorizeAdminPin('432', '4321')).toBe('invalid');
  });

  it('6. correct PIN → ok (plaintext and hashed)', async () => {
    expect(authorizeAdminPin('4321', '4321')).toBe('ok');
    const hashed = await hashPin('4321');
    expect(authorizeAdminPin('4321', hashed)).toBe('ok');
    expect(authorizeAdminPin('9999', hashed)).toBe('invalid');
  });

  it('messages are localized EN/ES/PT', () => {
    expect(adminPinNotConfiguredMessage('en')).toMatch(/administrator PIN must be configured/);
    expect(adminPinNotConfiguredMessage('es')).toMatch(/PIN de administrador/);
    expect(adminPinNotConfiguredMessage('pt')).toMatch(/PIN de administrador/);
    expect(adminPinInvalidMessage('es')).toMatch(/PIN incorrecto/);
    expect(adminPinInvalidMessage('pt')).toMatch(/PIN incorreto/);
  });
});
