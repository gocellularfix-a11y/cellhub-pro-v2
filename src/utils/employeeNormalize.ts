// ============================================================
// CellHub Pro — Employee Normalizer
// Round 24: migrates legacy role values from the old Employees
// modal (Staff/Manager/Admin — broken, never matched canAccessTab)
// to the canonical EmployeeRole type ('owner'|'manager'|'sales'|
// 'technician'|'cashier'). Applied by SET_EMPLOYEES reducer on
// every load so legacy records are auto-fixed on boot.
// ============================================================

import type { Employee, EmployeeRole } from '@/store/types';

const VALID_ROLES: EmployeeRole[] = ['owner', 'manager', 'sales', 'technician', 'cashier'];

/**
 * Map a legacy / free-form role string to a canonical EmployeeRole.
 * Unknown values fall back to 'sales' (safest default — POS access,
 * no admin, no inventory edit).
 */
export function normalizeRole(raw: unknown): EmployeeRole {
  if (typeof raw !== 'string') return 'sales';
  const lower = raw.trim().toLowerCase();
  if ((VALID_ROLES as string[]).includes(lower)) return lower as EmployeeRole;

  // Legacy label migration from the pre-r24 modal
  switch (lower) {
    case 'admin':         return 'owner';
    case 'staff':         return 'sales';
    case 'associate':     return 'sales';
    case 'sales associate': return 'sales';
    case 'tech':          return 'technician';
    case 'repair tech':   return 'technician';
    case 'cash':          return 'cashier';
    default:              return 'sales';
  }
}

/**
 * Normalize a single Employee record. Defensive — tolerates partial
 * input from legacy records / Firestore docs with missing fields.
 */
export function normalizeEmployee(raw: unknown): Employee {
  const e = (raw || {}) as Partial<Employee> & Record<string, unknown>;

  // Commission: the old modal wrote `commission` as a whole-number
  // percentage (e.g. 7). The canonical field is `commissionRate` as
  // a ratio (0.07). If commissionRate exists, trust it; else migrate
  // from legacy `commission` by dividing by 100.
  let commissionRate = typeof e.commissionRate === 'number' ? e.commissionRate : NaN;
  if (!Number.isFinite(commissionRate)) {
    const legacyCommission = (e as any).commission;
    commissionRate = typeof legacyCommission === 'number'
      ? legacyCommission / 100
      : 0;
  }

  return {
    // Preserve all legacy fields (personal info, docs, notes, skills, etc.)
    // — this normalizer only fixes role + commissionRate + ensures required fields.
    ...(e as object),
    id: String(e.id || ''),
    name: typeof e.name === 'string' ? e.name : '',
    role: normalizeRole(e.role),
    pin: typeof e.pin === 'string' ? e.pin : '',
    commissionRate,
    active: typeof e.active === 'boolean' ? e.active : true,
    clockLog: Array.isArray(e.clockLog) ? e.clockLog : [],
    onboardingSigned: typeof e.onboardingSigned === 'boolean' ? e.onboardingSigned : false,
    startDate: typeof e.startDate === 'string' ? e.startDate : '',
    createdAt: (e.createdAt as Employee['createdAt']) || new Date().toISOString(),
  } as Employee;
}

export function normalizeEmployees(raw: unknown): Employee[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeEmployee);
}
