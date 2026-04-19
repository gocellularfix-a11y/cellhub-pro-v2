// ============================================================
// CellHub Pro — Tax Data Helpers
// Centralized access to settings.taxData.byYear[year] with
// CRUD helpers that auto-persist via setSettings (Firestore + LS).
// ============================================================

import { useEffect, useRef, useCallback } from 'react';
import { useApp } from '@/store/AppProvider';
import { persistSettings } from '@/services/persist';
import type {
  TaxYearData,
  TaxExpense,
  TaxIncomeEntry,
  TaxSupplierPurchase,
  TaxSupplierReturn,
  TaxInventoryData,
  TaxAdjustments,
  TaxCA540,
  TaxExpenseCategory,
  TaxIncomeCategory,
  TaxReturnStatus,
} from '@/store/types';

// ── Defaults ─────────────────────────────────────────────

export const DEFAULT_INVENTORY: TaxInventoryData = {
  beginningInventory: 0,
  endingInventory: 0,
};

export const DEFAULT_ADJUSTMENTS: TaxAdjustments = {
  otherIncome: 0,
  returnsRefunds: 0,
};

export const DEFAULT_CA540: TaxCA540 = {
  caWithholding: 0,
  caQ1: 0,
  caQ2: 0,
  caQ3: 0,
  caQ4: 0,
  selfEmployedHealthInsuranceCA: 0,
  otherCADeductions: 0,
  useStandardDeductionCA: true,
  itemizedDeductionsCA: 0,
};

export function emptyYearData(): TaxYearData {
  return {
    expenses: [],
    income: [],
    suppliers: [],
    returns: [],
    inventory: { ...DEFAULT_INVENTORY },
    adjustments: { ...DEFAULT_ADJUSTMENTS },
    ca540: { ...DEFAULT_CA540 },
  };
}

// ── Categories (bilingual) ───────────────────────────────

export const EXPENSE_CATEGORIES: { value: TaxExpenseCategory; en: string; es: string }[] = [
  { value: 'Inventory/COGS',  en: 'Inventory / COGS Purchases', es: 'Inventario / Compras COGS' },
  { value: 'Rent',            en: 'Rent',                       es: 'Renta' },
  { value: 'Utilities',       en: 'Utilities',                  es: 'Servicios (luz, agua)' },
  { value: 'Internet/Phone',  en: 'Internet / Phone',           es: 'Internet / Teléfono' },
  { value: 'Advertising',     en: 'Advertising / Marketing',    es: 'Publicidad / Marketing' },
  { value: 'Insurance',       en: 'Insurance',                  es: 'Seguro' },
  { value: 'Supplies',        en: 'Supplies',                   es: 'Suministros' },
  { value: 'Repairs',         en: 'Repairs & Maintenance',      es: 'Reparaciones y Mantenimiento' },
  { value: 'Fees',            en: 'Bank / Merchant Fees',       es: 'Fees Bancarios / Merchant' },
  { value: 'Software',        en: 'Software / Subscriptions',   es: 'Software / Suscripciones' },
  { value: 'Payroll',         en: 'Payroll (employees only)',   es: 'Nómina (solo empleados)' },
  { value: 'Licenses',        en: 'Licenses / Permits',         es: 'Licencias / Permisos' },
  { value: 'Taxes',           en: 'Taxes & Fees',               es: 'Impuestos y Fees' },
  { value: 'Meals',           en: 'Meals (business)',           es: 'Comidas (negocio)' },
  { value: 'Vehicle',         en: 'Vehicle / Mileage',          es: 'Vehículo / Millaje' },
  { value: 'Pass-through',    en: 'Pass-through (Non-Income)',  es: 'Pass-through (No-Ingreso)' },
  { value: 'Misc',            en: 'Miscellaneous',              es: 'Misceláneo' },
];

export const INCOME_CATEGORIES: { value: TaxIncomeCategory; en: string; es: string }[] = [
  { value: 'Product Sales',       en: 'Product Sales',          es: 'Venta de Productos' },
  { value: 'Service Revenue',     en: 'Service Revenue',        es: 'Ingresos por Servicios' },
  { value: 'Payment Commissions', en: 'Payment Commissions',    es: 'Comisiones de Pagos' },
  { value: 'Repair Income',       en: 'Repair Income',          es: 'Ingresos por Reparación' },
  { value: 'Activation Fees',     en: 'Activation Fees',        es: 'Fees de Activación' },
  { value: 'Top-Up Commissions',  en: 'Top-Up Commissions',     es: 'Comisiones de Top-Up' },
  { value: 'Unlock Services',     en: 'Unlock Services',        es: 'Servicios de Unlock' },
  { value: 'Insurance Sales',     en: 'Insurance Sales',        es: 'Venta de Seguros' },
  { value: 'Gift Card Sales',     en: 'Gift Card Sales',        es: 'Venta de Gift Cards' },
  { value: 'Pass-Through Income', en: 'Pass-Through Income',    es: 'Ingreso Pass-Through' },
  { value: 'Other Income',        en: 'Other Income',           es: 'Otros Ingresos' },
];

export const RETURN_STATUSES: { value: TaxReturnStatus; en: string; es: string; color: string }[] = [
  { value: 'Pending',  en: 'Pending',  es: 'Pendiente', color: '#f87171' },
  { value: 'Shipped',  en: 'Shipped',  es: 'Enviado',   color: '#60a5fa' },
  { value: 'Refunded', en: 'Refunded', es: 'Reembolsado', color: '#22c55e' },
  { value: 'Rejected', en: 'Rejected', es: 'Rechazado', color: '#94a3b8' },
];

// ── Hook: useTaxYear(year) ───────────────────────────────
// Returns the year's data + CRUD helpers. Auto-persists.

export function useTaxYear(year: number) {
  const { state: { settings }, setSettings } = useApp();
  const yearKey = String(year);

  const allYears = settings.taxData?.byYear ?? {};
  const yearData: TaxYearData = allYears[yearKey] ?? emptyYearData();

  // Merge partial defaults so older saved data still has all fields
  const safeYearData: TaxYearData = {
    expenses: yearData.expenses ?? [],
    income: yearData.income ?? [],
    suppliers: yearData.suppliers ?? [],
    returns: yearData.returns ?? [],
    inventory: { ...DEFAULT_INVENTORY, ...(yearData.inventory ?? {}) },
    adjustments: { ...DEFAULT_ADJUSTMENTS, ...(yearData.adjustments ?? {}) },
    ca540: { ...DEFAULT_CA540, ...(yearData.ca540 ?? {}) },
  };

  // r29a — anti-stale ref pattern (canonical, established in r23/r24).
  // Without these refs, every CRUD helper would capture safeYearData/allYears
  // from the closure of the render that DEFINED the helper, not the render that
  // CALLED it. With multi-station Firestore sync, that means writes from another
  // station in flight at the moment of click are silently clobbered.
  const safeYearDataRef = useRef(safeYearData);
  const allYearsRef = useRef(allYears);
  useEffect(() => {
    safeYearDataRef.current = safeYearData;
    allYearsRef.current = allYears;
  });

  // r29a — generic patch function. CRITICAL: reads from refs (latest state),
  // NOT from the closure-captured variables. Also persists to Firestore +
  // localStorage via persistSettings — previously the hook only updated the
  // React reducer state, so all tax data was lost on every app reload.
  const patchYear = useCallback((patch: Partial<TaxYearData>) => {
    const currentSafe = safeYearDataRef.current;
    const currentAllYears = allYearsRef.current;
    const next: TaxYearData = { ...currentSafe, ...patch };
    const nextTaxData = {
      byYear: {
        ...currentAllYears,
        [yearKey]: next,
      },
    };
    // Update the in-memory reducer state (so the UI re-renders immediately)
    setSettings({ taxData: nextTaxData });
    // Persist to localStorage + Firestore (so the data survives reload AND
    // syncs to other stations). Fire-and-forget — optimistic update already
    // applied. persistSettings does shallow merge under the hood (r26 fix).
    persistSettings({ taxData: nextTaxData });
    // Refresh the refs immediately so a rapid second click in the same render
    // cycle sees the updated state without waiting for the next render.
    safeYearDataRef.current = next;
    allYearsRef.current = nextTaxData.byYear;
  }, [yearKey, setSettings]);

  // ── Expenses CRUD — read from ref, not closure ──────────
  const addExpense = useCallback((exp: Omit<TaxExpense, 'id'>) => {
    const id = `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    patchYear({ expenses: [...safeYearDataRef.current.expenses, { ...exp, id }] });
  }, [patchYear]);
  const updateExpense = useCallback((id: string, patch: Partial<TaxExpense>) => {
    patchYear({
      expenses: safeYearDataRef.current.expenses.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    });
  }, [patchYear]);
  const deleteExpense = useCallback((id: string) => {
    patchYear({ expenses: safeYearDataRef.current.expenses.filter((e) => e.id !== id) });
  }, [patchYear]);

  // ── Income CRUD — read from ref, not closure ────────────
  const addIncome = useCallback((inc: Omit<TaxIncomeEntry, 'id'>) => {
    const id = `inc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    patchYear({ income: [...safeYearDataRef.current.income, { ...inc, id }] });
  }, [patchYear]);
  const updateIncome = useCallback((id: string, patch: Partial<TaxIncomeEntry>) => {
    patchYear({
      income: safeYearDataRef.current.income.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    });
  }, [patchYear]);
  const deleteIncome = useCallback((id: string) => {
    patchYear({ income: safeYearDataRef.current.income.filter((e) => e.id !== id) });
  }, [patchYear]);

  // ── Supplier purchases CRUD — read from ref, not closure ─
  const addSupplier = useCallback((s: Omit<TaxSupplierPurchase, 'id'>) => {
    const id = `sup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    patchYear({ suppliers: [...safeYearDataRef.current.suppliers, { ...s, id }] });
  }, [patchYear]);
  const updateSupplier = useCallback((id: string, patch: Partial<TaxSupplierPurchase>) => {
    patchYear({
      suppliers: safeYearDataRef.current.suppliers.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    });
  }, [patchYear]);
  const deleteSupplier = useCallback((id: string) => {
    patchYear({ suppliers: safeYearDataRef.current.suppliers.filter((e) => e.id !== id) });
  }, [patchYear]);

  // ── Returns/RMA CRUD — read from ref, not closure ───────
  const addReturn = useCallback((r: Omit<TaxSupplierReturn, 'id'>) => {
    const id = `ret_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    patchYear({ returns: [...safeYearDataRef.current.returns, { ...r, id }] });
  }, [patchYear]);
  const updateReturn = useCallback((id: string, patch: Partial<TaxSupplierReturn>) => {
    patchYear({
      returns: safeYearDataRef.current.returns.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    });
  }, [patchYear]);
  const deleteReturn = useCallback((id: string) => {
    patchYear({ returns: safeYearDataRef.current.returns.filter((e) => e.id !== id) });
  }, [patchYear]);

  // ── Inventory / adjustments / CA 540 setters — read from ref ──
  const updateInventory = useCallback((patch: Partial<TaxInventoryData>) => {
    patchYear({ inventory: { ...safeYearDataRef.current.inventory, ...patch } });
  }, [patchYear]);
  const updateAdjustments = useCallback((patch: Partial<TaxAdjustments>) => {
    patchYear({ adjustments: { ...safeYearDataRef.current.adjustments, ...patch } });
  }, [patchYear]);
  const updateCA540 = useCallback((patch: Partial<TaxCA540>) => {
    patchYear({ ca540: { ...safeYearDataRef.current.ca540, ...patch } });
  }, [patchYear]);

  // ── Derived totals (in cents) ────────────────────────

  const totalExpensesAll = safeYearData.expenses.reduce((s, e) => s + e.amount, 0);
  const totalExpensesDeductible = safeYearData.expenses
    .filter((e) => e.category !== 'Pass-through')
    .reduce((s, e) => s + e.amount, 0);
  const totalPassThrough = safeYearData.expenses
    .filter((e) => e.category === 'Pass-through')
    .reduce((s, e) => s + e.amount, 0);

  const totalManualIncome = safeYearData.income
    .filter((i) => i.category !== 'Pass-Through Income')
    .reduce((s, i) => s + i.amount, 0);

  const totalSupplierPurchases = safeYearData.suppliers.reduce((s, x) => s + x.amount, 0);
  const totalSupplierReturns = safeYearData.returns
    .filter((r) => r.status === 'Refunded')
    .reduce((s, r) => s + r.amount, 0);

  // COGS = Beginning + Purchases - Returns - Ending
  const cogs =
    safeYearData.inventory.beginningInventory +
    totalSupplierPurchases -
    totalSupplierReturns -
    safeYearData.inventory.endingInventory;

  return {
    // raw data
    data: safeYearData,
    yearKey,
    // CRUD
    addExpense, updateExpense, deleteExpense,
    addIncome, updateIncome, deleteIncome,
    addSupplier, updateSupplier, deleteSupplier,
    addReturn, updateReturn, deleteReturn,
    updateInventory, updateAdjustments, updateCA540,
    // totals
    totalExpensesAll,
    totalExpensesDeductible,
    totalPassThrough,
    totalManualIncome,
    totalSupplierPurchases,
    totalSupplierReturns,
    cogs,
  };
}

// ── Format helpers ───────────────────────────────────────

/** Convert dollar string from input to cents integer */
export function dollarsToCents(s: string | number): number {
  if (typeof s === 'number') return Math.round(s * 100);
  const n = parseFloat(String(s).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : Math.round(n * 100);
}

/** Convert cents integer to dollars string for input fields */
export function centsToDollars(c: number): string {
  return (c / 100).toFixed(2);
}

/** Get today's date in YYYY-MM-DD format */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── K-1 Math (canonical) ─────────────────────────────────
//
// r29d-1: extracted from PartnershipMembersTab + TaxReportsModule (duplicated
// in 3 sites pre-r29d-1) to a single canonical function. Previously the value
// labeled "K-1 Box 14 SE earnings" was `ordinaryIncome + GP` (missing the
// × 0.9235 multiplier), which overreported Box 14 by 7.65%.
//
// IRS K-1 Box 14 Code A = Net Earnings from Self-Employment
//                       = (Ordinary Business Income + Guaranteed Payments) × 0.9235
//
// The factor 0.9235 (= 1 − 0.0765) represents that SE payers are exempt from
// the 7.65% employer-equivalent portion of FICA. It's part of the definition
// of "net earnings", not something applied later.
//
// SE Tax (Schedule SE line 12) = NetSE × 0.153
// Half-SE Deduction (line 13) = SE Tax × 0.5
//
// Capital Account Math (K-1 Item L) — uses tax basis convention:
//   Ending Capital = Beginning + Contributions + (Ordinary Income share) − Distributions
//   Note: Guaranteed payments are NOT added to capital because the partner already
//   received them as cash distributions (this is the standard tax-basis convention).

import type { PartnershipMember } from '@/store/types';

export interface MemberK1Result {
  /** Ownership share as fraction (0-1) */
  share: number;
  /** K-1 Box 1: Ordinary business income share */
  ordinaryIncome: number;
  /** K-1 Box 14 Code A: Net earnings from self-employment (NetSE = (ord+GP) × 0.9235) */
  netSEEarnings: number;
  /** Schedule SE line 12: SE tax = NetSE × 15.3% */
  seTax: number;
  /** Schedule SE line 13: Half-SE deduction = SE tax × 0.5 */
  halfSE: number;
  /** K-1 Item L: Ending capital account */
  endingCapital: number;
}

export function calcMemberK1(member: PartnershipMember, netProfitCents: number): MemberK1Result {
  const share = (member.ownershipPct || 0) / 100;
  const ordinaryIncome = netProfitCents * share;

  // r29d-1 — CRITICAL: this is the line that was wrong in 3 places before.
  // Net SE earnings is what goes on K-1 Box 14 Code A. The × 0.9235 must
  // be applied here, NOT compensated later in the SE tax calc.
  const grossSE = ordinaryIncome + (member.guaranteedPayments || 0);
  const netSEEarnings = grossSE * 0.9235;

  const seTax = netSEEarnings * 0.153;
  const halfSE = seTax * 0.5;

  // Tax-basis capital account (does NOT include guaranteed payments,
  // because the partner already received them as cash distributions).
  const endingCapital =
    (member.beginningCapital || 0) +
    (member.contributions || 0) +
    ordinaryIncome -
    (member.distributions || 0);

  return { share, ordinaryIncome, netSEEarnings, seTax, halfSE, endingCapital };
}
