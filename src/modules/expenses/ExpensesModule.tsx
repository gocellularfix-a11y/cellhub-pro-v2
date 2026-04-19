// ============================================================
// CellHub Pro — Expense Tracking Module
// Full CRUD for business expenses.
// Persists to localStorage + Firestore. Admin-only.
// Feeds directly into TaxReportsModule for Form 1065.
// ============================================================

import { useState, useMemo, useCallback } from 'react';
import { useApp } from '@/store/AppProvider';
import { useToast } from '@/components/ui/Toast';
import { useHighlightRecord } from '@/hooks/useHighlightRecord';
import { Modal } from '@/components/ui';
import GlobalSearchBar from '@/components/shared/GlobalSearchBar';
import { getLabels } from '@/config/i18n';
import { formatCurrency } from '@/utils/currency';
import { matchesSearch } from '@/utils/fuzzyMatch';
import { generateId } from '@/utils/dates';
import { persist, remove } from '@/services/persist';
import type { Expense, ExpenseCategory, ExpensePaymentMethod } from '@/store/types';

// ── Constants ─────────────────────────────────────────────

const CATEGORIES: ExpenseCategory[] = [
  'rent', 'payroll', 'utilities', 'parts_supplies', 'marketing',
  'insurance', 'equipment', 'carrier_fees', 'software',
  'professional_fees', 'taxes_licenses', 'other',
];

const CATEGORY_ICONS: Record<ExpenseCategory, string> = {
  rent:             '🏢',
  payroll:          '👥',
  utilities:        '💡',
  parts_supplies:   '🔧',
  marketing:        '📣',
  insurance:        '🛡️',
  equipment:        '🖥️',
  carrier_fees:     '📡',
  software:         '💻',
  professional_fees:'⚖️',
  taxes_licenses:   '🏛️',
  other:            '📌',
};

const PAYMENT_METHODS: ExpensePaymentMethod[] = ['cash', 'card', 'check', 'transfer', 'other'];

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

function catLabel(cat: ExpenseCategory, L: Record<string, string>): string {
  return L[`cat_${cat}`] || cat;
}

function payLabel(method: string, es: boolean): string {
  const map: Record<string, [string, string]> = {
    cash:     ['Cash',     'Efectivo'],
    card:     ['Card',     'Tarjeta'],
    check:    ['Check',    'Cheque'],
    transfer: ['Transfer', 'Transferencia'],
    other:    ['Other',    'Otro'],
  };
  const pair = map[method];
  return pair ? pair[es ? 1 : 0] : method;
}

const blankForm = (): Partial<Expense> => ({
  date:          new Date().toISOString().split('T')[0],
  vendor:        '',
  description:   '',
  category:      'other',
  amount:        0,
  paymentMethod: 'card',
  notes:         '',
});

// ── Module ────────────────────────────────────────────────

export default function ExpensesModule() {
  const {
    state: { expenses, lang },
    setExpenses,
  } = useApp();

  const { toast } = useToast();
  const L = getLabels(lang);
  const es = lang === 'es';

  // r-global-search: useHighlightRecord wires up the flash+scroll behavior
  // when the user clicks an Expense result in the GlobalSearchBar dropdown
  // from another module. The dropdown dispatches SET_HIGHLIGHT_RECORD with
  // the expense id, this hook scrolls the matching row into view and the
  // isHighlighted() check below applies the outline.
  const { highlightRef, isHighlighted } = useHighlightRecord<HTMLDivElement>();

  // ── UI state ────────────────────────────────────────────
  const [search, setSearch]             = useState('');
  const [filterCat, setFilterCat]       = useState<string>('All');
  const [filterMonth, setFilterMonth]   = useState<string>('All');
  const [filterYear, setFilterYear]     = useState<number>(new Date().getFullYear());
  const [showModal, setShowModal]       = useState(false);
  const [editExpense, setEditExpense]   = useState<Expense | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [form, setForm]                 = useState<Partial<Expense>>(blankForm());
  const [amountStr, setAmountStr]       = useState('');

  // ── Derived / stats ─────────────────────────────────────
  const now   = new Date();
  const curMo = now.getMonth(); // 0-based
  const curYr = now.getFullYear();

  const filtered = useMemo(() => {
    return expenses
      .filter((e) => {
        const d = new Date(e.date);
        if (d.getFullYear() !== filterYear) return false;
        if (filterMonth !== 'All' && d.getMonth() !== parseInt(filterMonth, 10)) return false;
        if (filterCat !== 'All' && e.category !== filterCat) return false;
        return matchesSearch(search, e.vendor, e.description, e.category, e.notes);
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [expenses, filterYear, filterMonth, filterCat, search]);

  const stats = useMemo(() => {
    const thisMonth = expenses.filter((e) => {
      const d = new Date(e.date);
      return d.getFullYear() === curYr && d.getMonth() === curMo;
    });
    const thisYear = expenses.filter((e) => new Date(e.date).getFullYear() === curYr);

    const monthTotal = thisMonth.reduce((s, e) => s + e.amount, 0);
    const yearTotal  = thisYear.reduce((s, e) => s + e.amount, 0);

    // Top category this year
    const byCat: Record<string, number> = {};
    for (const e of thisYear) {
      byCat[e.category] = (byCat[e.category] || 0) + e.amount;
    }
    const topCat = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];

    // By category for chart
    const catBreakdown = CATEGORIES.map((cat) => ({
      cat,
      total: thisYear.filter((e) => e.category === cat).reduce((s, e) => s + e.amount, 0),
    })).filter((c) => c.total > 0).sort((a, b) => b.total - a.total);

    return { monthTotal, yearTotal, topCat, catBreakdown };
  }, [expenses, curYr, curMo]);

  // ── Available years for filter ───────────────────────────
  const years = useMemo(() => {
    const ys = new Set(expenses.map((e) => new Date(e.date).getFullYear()));
    ys.add(curYr);
    return Array.from(ys).sort((a, b) => b - a);
  }, [expenses, curYr]);

  // ── CRUD ────────────────────────────────────────────────
  const openNew = () => {
    setEditExpense(null);
    setForm(blankForm());
    setAmountStr('');
    setShowModal(true);
  };

  const openEdit = (exp: Expense) => {
    setEditExpense(exp);
    setForm({ ...exp });
    setAmountStr(exp.amount > 0 ? (exp.amount / 100).toFixed(2) : '');
    setShowModal(true);
  };

  const handleSave = useCallback(() => {
    if (!form.vendor?.trim()) {
      toast(es ? 'Ingresa el proveedor' : 'Enter vendor name', 'error');
      return;
    }
    if (!form.date) {
      toast(es ? 'Selecciona la fecha' : 'Select a date', 'error');
      return;
    }
    const amount = Math.round(parseFloat(amountStr || '0') * 100);
    if (amount <= 0) {
      toast(es ? 'Ingresa un monto válido' : 'Enter a valid amount', 'error');
      return;
    }

    if (editExpense) {
      const updated: Expense = {
        ...editExpense,
        ...form,
        amount,
        updatedAt: new Date().toISOString(),
      } as Expense;
      setExpenses(expenses.map((e) => e.id === editExpense.id ? updated : e));
      persist.expense(updated.id, updated as unknown as Record<string, unknown>);
    } else {
      const newExp: Expense = {
        id:            generateId(),
        date:          form.date!,
        vendor:        form.vendor!,
        description:   form.description || '',
        category:      (form.category as ExpenseCategory) || 'other',
        amount,
        paymentMethod: (form.paymentMethod as ExpensePaymentMethod) || 'card',
        notes:         form.notes || '',
        createdAt:     new Date().toISOString(),
      };
      setExpenses([...expenses, newExp]);
      persist.expense(newExp.id, newExp as unknown as Record<string, unknown>);
    }

    toast(L.expenseSaved || 'Expense saved', 'success');
    setShowModal(false);
    setEditExpense(null);
  }, [form, amountStr, editExpense, expenses, setExpenses, toast, L, es]);

  const handleDelete = useCallback((id: string) => {
    setExpenses(expenses.filter((e) => e.id !== id));
    remove.expense(id);
    setDeleteConfirm(null);
    toast(L.expenseDeleted || 'Expense deleted', 'info');
  }, [expenses, setExpenses, remove, toast, L]);

  // ─────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">
            💸 {L.expenses || 'Expenses'}
          </h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {es
              ? 'Registra y categoriza los gastos del negocio para impuestos y reportes'
              : 'Track and categorize business expenses for taxes and reporting'}
          </p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>
          + {L.newExpense || 'New Expense'}
        </button>
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="stat-card">
          <div className="text-2xl mb-1">📅</div>
          <div className="text-xl font-bold text-white">{formatCurrency(stats.monthTotal)}</div>
          <div className="text-slate-400 text-xs mt-0.5">{L.thisMonth || 'This Month'}</div>
        </div>
        <div className="stat-card">
          <div className="text-2xl mb-1">📊</div>
          <div className="text-xl font-bold text-white">{formatCurrency(stats.yearTotal)}</div>
          <div className="text-slate-400 text-xs mt-0.5">{L.thisYear || 'This Year'} {filterYear}</div>
        </div>
        <div className="stat-card">
          <div className="text-2xl mb-1">🧾</div>
          <div className="text-xl font-bold text-white">{filtered.length}</div>
          <div className="text-slate-400 text-xs mt-0.5">{es ? 'Registros' : 'Records'}</div>
        </div>
        <div className="stat-card">
          <div className="text-2xl mb-1">
            {stats.topCat ? CATEGORY_ICONS[stats.topCat[0] as ExpenseCategory] : '📌'}
          </div>
          <div className="text-sm font-bold text-white truncate">
            {stats.topCat ? catLabel(stats.topCat[0] as ExpenseCategory, L) : '—'}
          </div>
          <div className="text-slate-400 text-xs mt-0.5">{L.topCategory || 'Top Category'}</div>
        </div>
      </div>

      {/* ── Category breakdown bar ── */}
      {stats.catBreakdown.length > 0 && (
        <div className="glass-card p-4">
          <div className="text-sm font-semibold text-slate-300 mb-3">
            {es ? `Gastos por categoría — ${filterYear}` : `Expenses by category — ${filterYear}`}
          </div>
          <div className="space-y-2">
            {stats.catBreakdown.slice(0, 6).map(({ cat, total }) => {
              const pct = stats.yearTotal > 0 ? (total / stats.yearTotal) * 100 : 0;
              return (
                <div key={cat} className="flex items-center gap-3">
                  <div className="w-6 text-center text-sm">{CATEGORY_ICONS[cat as ExpenseCategory]}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-300 truncate">{catLabel(cat as ExpenseCategory, L)}</span>
                      <span className="text-slate-400 ml-2 shrink-0">{formatCurrency(total)}</span>
                    </div>
                    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-indigo-500 rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <div className="text-xs text-slate-500 w-10 text-right shrink-0">
                    {pct.toFixed(0)}%
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Filters ── */}
      <div className="flex flex-wrap gap-3 items-center">
        {/* r-global-search: GlobalSearchBar replaces the plain text input.
            Synced mode — local `search` state still drives the filtered list. */}
        <div className="flex-1 min-w-[200px]">
          <GlobalSearchBar
            localValue={search}
            onLocalChange={setSearch}
            excludeCollection="expenses"
            placeholder={es ? 'Buscar proveedor, descripción…' : 'Search vendor, description…'}
          />
        </div>

        {/* Year */}
        <select
          className="select w-28"
          value={filterYear}
          onChange={(e) => setFilterYear(parseInt(e.target.value, 10))}
        >
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>

        {/* Month */}
        <select
          className="select w-36"
          value={filterMonth}
          onChange={(e) => setFilterMonth(e.target.value)}
        >
          <option value="All">{es ? 'Todos los meses' : 'All months'}</option>
          {MONTHS.map((m, i) => (
            <option key={i} value={String(i)}>{m}</option>
          ))}
        </select>

        {/* Category */}
        <select
          className="select w-44"
          value={filterCat}
          onChange={(e) => setFilterCat(e.target.value)}
        >
          <option value="All">{es ? 'Todas las categorías' : 'All categories'}</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{CATEGORY_ICONS[c]} {catLabel(c, L)}</option>
          ))}
        </select>
      </div>

      {/* ── Expense list ── */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <div className="text-5xl mb-4">💸</div>
          <div className="text-lg font-medium">
            {es ? 'Sin gastos registrados' : 'No expenses recorded'}
          </div>
          <div className="text-sm mt-1">
            {es ? 'Agrega tu primer gasto arriba' : 'Add your first expense above'}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Table header */}
          <div className="hidden md:grid grid-cols-[90px_1fr_140px_100px_100px_80px] gap-3 px-4 text-xs text-slate-500 font-semibold uppercase tracking-wider">
            <span>{L.expenseDate || 'Date'}</span>
            <span>{L.expenseVendor || 'Vendor'}</span>
            <span>{L.expenseCategory || 'Category'}</span>
            <span>{L.expensePayment || 'Payment'}</span>
            <span className="text-right">{L.expenseAmount || 'Amount'}</span>
            <span></span>
          </div>

          {filtered.map((exp) => (
            <div
              key={exp.id}
              ref={isHighlighted(exp.id) ? highlightRef : null}
              className="glass-card px-4 py-3 hover:bg-white/10 transition-colors cursor-pointer grid grid-cols-1 md:grid-cols-[90px_1fr_140px_100px_100px_80px] gap-2 md:gap-3 items-center"
              style={isHighlighted(exp.id) ? { outline: '2px solid #667eea', background: 'rgba(102,126,234,0.08)' } : undefined}
              onClick={() => openEdit(exp)}
            >
              {/* Date */}
              <div className="text-xs text-slate-400 font-mono">
                {new Date(exp.date + 'T12:00:00').toLocaleDateString(es ? 'es-MX' : 'en-US', { month: 'short', day: 'numeric' })}
              </div>

              {/* Vendor + description */}
              <div className="min-w-0">
                <div className="font-semibold text-white truncate">{exp.vendor}</div>
                {exp.description && (
                  <div className="text-xs text-slate-400 truncate">{exp.description}</div>
                )}
              </div>

              {/* Category */}
              <div className="flex items-center gap-1.5 text-sm text-slate-300">
                <span>{CATEGORY_ICONS[exp.category]}</span>
                <span className="truncate text-xs">{catLabel(exp.category, L)}</span>
              </div>

              {/* Payment */}
              <div className="text-xs text-slate-400">
                {payLabel(exp.paymentMethod, es)}
              </div>

              {/* Amount */}
              <div className="text-right font-bold text-red-400">
                {formatCurrency(exp.amount)}
              </div>

              {/* Actions */}
              <div className="flex gap-2 justify-end" onClick={(e) => e.stopPropagation()}>
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => openEdit(exp)}
                  title={L.edit}
                >
                  ✏️
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => setDeleteConfirm(exp.id)}
                  title={L.delete}
                >
                  🗑️
                </button>
              </div>
            </div>
          ))}

          {/* Footer total */}
          <div className="flex justify-end pt-2 pr-4">
            <div className="text-sm text-slate-400">
              {es ? 'Total filtrado:' : 'Filtered total:'}
              <span className="text-red-400 font-bold ml-2">
                {formatCurrency(filtered.reduce((s, e) => s + e.amount, 0))}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirm ── */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="modal-content max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-2">
              🗑️ {es ? 'Eliminar gasto' : 'Delete expense'}
            </h3>
            <p className="text-slate-300 text-sm mb-4">
              {es ? '¿Estás seguro? Esta acción no se puede deshacer.' : 'Are you sure? This cannot be undone.'}
            </p>
            <div className="flex gap-3 justify-end">
              <button className="btn btn-secondary" onClick={() => setDeleteConfirm(null)}>
                {L.cancel}
              </button>
              <button className="btn btn-danger" onClick={() => handleDelete(deleteConfirm)}>
                {L.delete}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Form Modal ── */}
      {showModal && (
        <Modal
          open
          title={editExpense
            ? `✏️ ${es ? 'Editar gasto' : 'Edit expense'}`
            : `+ ${L.newExpense || 'New Expense'}`}
          onClose={() => { setShowModal(false); setEditExpense(null); }}
          size="max-w-md"
        >
          <div className="space-y-4">

            <div className="grid grid-cols-2 gap-4">
              {/* Date */}
              <div>
                <label className="label">{L.expenseDate || 'Date'} *</label>
                <input
                  type="date"
                  className="input"
                  value={form.date || ''}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                />
              </div>

              {/* Amount */}
              <div>
                <label className="label">{L.expenseAmount || 'Amount'} * ($)</label>
                <input
                  type="number"
                  className="input"
                  min={0}
                  step={0.01}
                  placeholder="0.00"
                  value={amountStr}
                  onChange={(e) => setAmountStr(e.target.value)}
                />
              </div>
            </div>

            {/* Vendor */}
            <div>
              <label className="label">{L.expenseVendor || 'Vendor / Payee'} *</label>
              <input
                className="input"
                placeholder={es ? 'Ej. AT&T, Home Depot, Renta…' : 'e.g. AT&T, Home Depot, Landlord…'}
                value={form.vendor || ''}
                onChange={(e) => setForm((f) => ({ ...f, vendor: e.target.value }))}
              />
            </div>

            {/* Description */}
            <div>
              <label className="label">{L.expenseDescription || 'Description'}</label>
              <input
                className="input"
                placeholder={es ? 'Descripción opcional' : 'Optional details'}
                value={form.description || ''}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Category */}
              <div>
                <label className="label">{L.expenseCategory || 'Category'}</label>
                <select
                  className="select"
                  value={form.category || 'other'}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as ExpenseCategory }))}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_ICONS[c]} {catLabel(c, L)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Payment method */}
              <div>
                <label className="label">{L.expensePayment || 'Payment Method'}</label>
                <select
                  className="select"
                  value={form.paymentMethod || 'card'}
                  onChange={(e) => setForm((f) => ({ ...f, paymentMethod: e.target.value as ExpensePaymentMethod }))}
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>{payLabel(m, es)}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="label">{L.expenseNotes || 'Notes'}</label>
              <textarea
                className="input"
                rows={2}
                placeholder={es ? 'Notas opcionales…' : 'Optional notes…'}
                value={form.notes || ''}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>

            {/* Actions */}
            <div className="flex gap-3 justify-end pt-2">
              <button
                className="btn btn-secondary"
                onClick={() => { setShowModal(false); setEditExpense(null); }}
              >
                {L.cancel}
              </button>
              <button className="btn btn-primary" onClick={handleSave}>
                💾 {L.save}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
