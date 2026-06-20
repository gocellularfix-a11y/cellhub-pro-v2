// ============================================================
// R-FINANCIAL-PRIVACY-POLICY-C (C1) — helper unit tests.
//
// Locks resolveOwnerFinancialAccess() behavior and proves the existing
// low-level canViewOwnerFinancials() is unchanged. C1 adds no call sites,
// so there is no behavior change in the app yet.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  canViewOwnerFinancials,
  resolveOwnerFinancialAccess,
} from './financialPrivacy';

// Financial Privacy flag states.
const PRIVACY_ON = { hideOwnerFinancialsFromEmployees: true } as const;
const PRIVACY_OFF = { hideOwnerFinancialsFromEmployees: false } as const;
const PRIVACY_MISSING = {} as const;
// Manager opt-in ON (privacy also ON).
const PRIVACY_ON_MGR_ON = {
  hideOwnerFinancialsFromEmployees: true,
  managersCanViewFinancials: true,
} as const;

describe('resolveOwnerFinancialAccess — Policy C role-aware visibility', () => {
  it('settings null/undefined → true (legacy fallback)', () => {
    expect(resolveOwnerFinancialAccess({ settings: null })).toBe(true);
    expect(resolveOwnerFinancialAccess({ settings: undefined })).toBe(true);
  });

  it('privacy flag OFF/missing → true (legacy behavior), regardless of role', () => {
    expect(resolveOwnerFinancialAccess({ settings: PRIVACY_OFF, currentEmployee: { role: 'technician' } })).toBe(true);
    expect(resolveOwnerFinancialAccess({ settings: PRIVACY_MISSING, currentEmployee: { role: 'cashier' } })).toBe(true);
  });

  it('owner + privacy ON → true', () => {
    expect(resolveOwnerFinancialAccess({ settings: PRIVACY_ON, currentEmployee: { role: 'owner' } })).toBe(true);
  });

  it('null/undefined employee + privacy ON → true (solo-owner fallback)', () => {
    expect(resolveOwnerFinancialAccess({ settings: PRIVACY_ON, currentEmployee: null })).toBe(true);
    expect(resolveOwnerFinancialAccess({ settings: PRIVACY_ON })).toBe(true);
    expect(resolveOwnerFinancialAccess({ settings: PRIVACY_ON, currentEmployee: { role: null } })).toBe(true);
  });

  it('manager + privacy ON + managersCanViewFinancials false/missing → false', () => {
    expect(resolveOwnerFinancialAccess({ settings: PRIVACY_ON, currentEmployee: { role: 'manager' } })).toBe(false);
    expect(resolveOwnerFinancialAccess({
      settings: { hideOwnerFinancialsFromEmployees: true, managersCanViewFinancials: false },
      currentEmployee: { role: 'manager' },
    })).toBe(false);
  });

  it('manager + privacy ON + managersCanViewFinancials true → true', () => {
    expect(resolveOwnerFinancialAccess({ settings: PRIVACY_ON_MGR_ON, currentEmployee: { role: 'manager' } })).toBe(true);
  });

  it('employee/cashier/technician/sales + privacy ON → false', () => {
    for (const role of ['employee', 'cashier', 'technician', 'sales']) {
      expect(resolveOwnerFinancialAccess({ settings: PRIVACY_ON, currentEmployee: { role } })).toBe(false);
    }
  });

  it('isAdminMode does NOT override manager restriction', () => {
    expect(resolveOwnerFinancialAccess({
      settings: PRIVACY_ON, currentEmployee: { role: 'manager' }, isAdminMode: true,
    })).toBe(false);
  });

  it('isAdminMode does NOT override employee restriction', () => {
    expect(resolveOwnerFinancialAccess({
      settings: PRIVACY_ON, currentEmployee: { role: 'technician' }, isAdminMode: true,
    })).toBe(false);
  });

  it('manager opt-in ON still respects isAdminMode-independence (true via setting, not admin)', () => {
    expect(resolveOwnerFinancialAccess({
      settings: PRIVACY_ON_MGR_ON, currentEmployee: { role: 'manager' }, isAdminMode: false,
    })).toBe(true);
  });
});

describe('canViewOwnerFinancials — unchanged low-level helper', () => {
  it('null settings → true', () => {
    expect(canViewOwnerFinancials(null, false)).toBe(true);
    expect(canViewOwnerFinancials(undefined, false)).toBe(true);
  });
  it('privacy OFF/missing → true regardless of admin flag', () => {
    expect(canViewOwnerFinancials(PRIVACY_OFF, false)).toBe(true);
    expect(canViewOwnerFinancials(PRIVACY_MISSING, false)).toBe(true);
  });
  it('privacy ON → mirrors isAdminOrOwner arg', () => {
    expect(canViewOwnerFinancials(PRIVACY_ON, true)).toBe(true);
    expect(canViewOwnerFinancials(PRIVACY_ON, false)).toBe(false);
  });
});
