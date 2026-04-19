// ============================================================
// CellHub Pro — Tax Expenses Tab (editable)
// Adapted from GOCELLULARAPP.html lines 1042-1085 (Expenses tab)
// + lines 4161-4205 (expense modal)
// Storage now in settings.taxData.byYear[year].expenses
// ============================================================

import { useState } from 'react';
import { useApp } from '@/store/AppProvider';
import { useToast } from '@/components/ui/Toast';
import { formatCurrency } from '@/utils/currency';
import { useTaxYear, EXPENSE_CATEGORIES, dollarsToCents, centsToDollars, todayISO } from './taxData';
import {
  inputStyle, labelStyle, thStyle, tdStyle, iconBtnStyle,
  modalOverlay, modalCard, btnSecondaryStyle, btnPrimaryStyle, btnAddStyle,
} from './taxStyles';
import type { TaxExpense, TaxExpenseCategory } from '@/store/types';

interface Props {
  year: number;
}

export default function TaxExpensesTab({ year }: Props) {
  const { state: { lang } } = useApp();
  const { toast } = useToast();
  const es = lang === 'es';
  const tax = useTaxYear(year);

  const [editing, setEditing] = useState<TaxExpense | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Form state for modal
  const [form, setForm] = useState({
    date: todayISO(),
    vendor: '',
    category: '' as TaxExpenseCategory | '',
    amount: '',
    notes: '',
  });

  const openAdd = () => {
    setEditing(null);
    setForm({ date: todayISO(), vendor: '', category: '', amount: '', notes: '' });
    setShowModal(true);
  };

  const openEdit = (e: TaxExpense) => {
    setEditing(e);
    setForm({
      date: e.date.slice(0, 10),
      vendor: e.vendor,
      category: e.category,
      amount: centsToDollars(e.amount),
      notes: e.notes ?? '',
    });
    setShowModal(true);
  };

  const handleSave = () => {
    if (!form.vendor.trim() || !form.category || !form.amount) return;

    // r29c-1 — F-ZERO-AMOUNT
    const amountCents = dollarsToCents(form.amount);
    if (amountCents <= 0) {
      toast(es ? 'El monto debe ser mayor a $0' : 'Amount must be greater than $0', 'error');
      return;
    }

    // r29c-1 — F-DATE-OUTSIDE-YEAR
    const formYear = new Date(form.date).getFullYear();
    if (formYear !== year) {
      toast(
        es
          ? `La fecha debe estar dentro del año fiscal ${year} (1 ene – 31 dic, ${year})`
          : `Date must be within fiscal year ${year} (Jan 1 – Dec 31, ${year})`,
        'error',
      );
      return;
    }

    const payload = {
      date: form.date,
      vendor: form.vendor.trim(),
      category: form.category as TaxExpenseCategory,
      amount: amountCents,
      notes: form.notes.trim() || undefined,
    };
    if (editing) {
      tax.updateExpense(editing.id, payload);
    } else {
      tax.addExpense(payload);
    }
    setShowModal(false);
    setEditing(null);
  };

  const handleDelete = (id: string) => {
    tax.deleteExpense(id);
    setConfirmDelete(null);
  };

  // Sort newest first
  const sortedExpenses = [...tax.data.expenses].sort((a, b) => b.date.localeCompare(a.date));

  // Group by category for the summary
  const byCategory = tax.data.expenses.reduce<Record<string, number>>((acc, e) => {
    acc[e.category] = (acc[e.category] || 0) + e.amount;
    return acc;
  }, {});

  const catLabel = (val: TaxExpenseCategory) =>
    EXPENSE_CATEGORIES.find((c) => c.value === val)?.[es ? 'es' : 'en'] ?? val;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#e2e8f0' }}>
            {es ? 'Gastos del Negocio' : 'Business Expenses'} — {year}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.15rem' }}>
            {es ? 'Editables manualmente. Se sincronizan a Firebase.' : 'Manually editable. Syncs to Firebase.'}
          </div>
        </div>
        <button onClick={openAdd} style={btnAddStyle}>
          + {es ? 'Agregar Gasto' : 'Add Expense'}
        </button>
      </div>

      {/* Totals strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', marginBottom: '1rem' }}>
        <div style={{
          background: 'rgba(239,68,68,0.08)',
          border: '1px solid rgba(239,68,68,0.25)',
          borderRadius: '0.625rem',
          padding: '0.875rem 1rem',
        }}>
          <div style={{ fontSize: '0.65rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
            {es ? 'Gastos Deducibles' : 'Deductible Expenses'}
          </div>
          <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#fca5a5', marginTop: '0.2rem' }}>
            {formatCurrency(tax.totalExpensesDeductible)}
          </div>
        </div>
        <div style={{
          background: 'rgba(168,85,247,0.08)',
          border: '1px solid rgba(168,85,247,0.25)',
          borderRadius: '0.625rem',
          padding: '0.875rem 1rem',
        }}>
          <div style={{ fontSize: '0.65rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
            Pass-through {es ? '(excluido)' : '(excluded)'}
          </div>
          <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#c4b5fd', marginTop: '0.2rem' }}>
            {formatCurrency(tax.totalPassThrough)}
          </div>
        </div>
        <div style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '0.625rem',
          padding: '0.875rem 1rem',
        }}>
          <div style={{ fontSize: '0.65rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
            {es ? 'Total Capturado' : 'Total Entries'}
          </div>
          <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#cbd5e1', marginTop: '0.2rem' }}>
            {tax.data.expenses.length}
          </div>
        </div>
      </div>

      {/* Pass-through info banner */}
      <div style={{
        background: 'rgba(168,85,247,0.06)',
        border: '1px solid rgba(168,85,247,0.2)',
        borderRadius: '0.625rem',
        padding: '0.75rem 1rem',
        marginBottom: '1rem',
        fontSize: '0.75rem',
        color: '#c4b5fd',
        lineHeight: 1.5,
      }}>
        <strong>💡 Pass-through:</strong> {es
          ? 'Dinero recibido de clientes que se debe pasar a un tercero (carrier, etc.). NO es ingreso ni gasto — solo está de paso. Se excluye de los totales del 1065.'
          : "Money collected from customers that must be forwarded to a third party (carrier, etc.). NOT income, NOT expense — just transit. Excluded from 1065 totals."}
      </div>

      {/* Table or empty state */}
      {sortedExpenses.length === 0 ? (
        <div style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px dashed rgba(255,255,255,0.15)',
          borderRadius: '0.75rem',
          padding: '2.5rem 1rem',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>💸</div>
          <div style={{ fontSize: '0.9rem', color: '#cbd5e1', fontWeight: 600, marginBottom: '0.25rem' }}>
            {es ? 'No hay gastos capturados' : 'No expenses recorded yet'}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
            {es ? `Agrega gastos del año ${year} para llenar el 1065 y CDTFA.` : `Add ${year} expenses to populate Form 1065 and CDTFA.`}
          </div>
        </div>
      ) : (
        <div style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '0.75rem',
          overflow: 'hidden',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                <th style={thStyle}>{es ? 'Fecha' : 'Date'}</th>
                <th style={thStyle}>{es ? 'Vendedor' : 'Vendor'}</th>
                <th style={thStyle}>{es ? 'Categoría' : 'Category'}</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>{es ? 'Monto' : 'Amount'}</th>
                <th style={{ ...thStyle, textAlign: 'center', width: '90px' }}>{es ? 'Acciones' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody>
              {sortedExpenses.map((exp) => {
                const isPassThrough = exp.category === 'Pass-through';
                return (
                  <tr key={exp.id} style={{
                    background: isPassThrough ? 'rgba(168,85,247,0.04)' : 'transparent',
                    borderTop: '1px solid rgba(255,255,255,0.05)',
                  }}>
                    <td style={tdStyle}>{new Date(exp.date).toLocaleDateString(es ? 'es-MX' : 'en-US')}</td>
                    <td style={{ ...tdStyle, fontWeight: 600, color: '#e2e8f0' }}>
                      {exp.vendor}
                      {exp.notes && <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '0.15rem' }}>{exp.notes}</div>}
                    </td>
                    <td style={tdStyle}>
                      {catLabel(exp.category)}
                      {isPassThrough && <span style={{ marginLeft: '0.4rem', fontSize: '0.68rem', color: '#a78bfa' }}>⊘</span>}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: isPassThrough ? '#a78bfa' : '#fca5a5' }}>
                      {formatCurrency(exp.amount)}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: '0.3rem', justifyContent: 'center' }}>
                        <button onClick={() => openEdit(exp)} style={iconBtnStyle('blue')} title={es ? 'Editar' : 'Edit'}>✏️</button>
                        <button onClick={() => setConfirmDelete(exp.id)} style={iconBtnStyle('red')} title={es ? 'Borrar' : 'Delete'}>🗑</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Category breakdown */}
      {Object.keys(byCategory).length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
            {es ? 'Por Categoría' : 'By Category'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.5rem' }}>
            {Object.entries(byCategory)
              .sort(([, a], [, b]) => b - a)
              .map(([cat, amt]) => (
                <div key={cat} style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  borderRadius: '0.5rem',
                  padding: '0.6rem 0.875rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}>
                  <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{catLabel(cat as TaxExpenseCategory)}</span>
                  <span style={{ fontSize: '0.82rem', fontWeight: 700, color: cat === 'Pass-through' ? '#a78bfa' : '#fca5a5', fontFamily: 'ui-monospace, monospace' }}>
                    {formatCurrency(amt)}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* ════════════ EDIT MODAL ════════════ */}
      {showModal && (
        <div onClick={() => setShowModal(false)} style={modalOverlay}>
          <div onClick={(e) => e.stopPropagation()} style={modalCard}>
            <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '1rem' }}>
              {editing ? (es ? '✏️ Editar Gasto' : '✏️ Edit Expense') : (es ? '+ Agregar Gasto' : '+ Add Expense')}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.875rem' }}>
              <div>
                <label style={labelStyle}>{es ? 'Fecha' : 'Date'} *</label>
                <input
                  type="date"
                  style={inputStyle}
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                />
              </div>
              <div>
                <label style={labelStyle}>{es ? 'Monto' : 'Amount'} ($) *</label>
                <input
                  type="text"
                  inputMode="decimal"
                  style={inputStyle}
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  placeholder="0.00"
                />
              </div>
            </div>

            <div style={{ marginBottom: '0.875rem' }}>
              <label style={labelStyle}>{es ? 'Vendedor / Proveedor' : 'Vendor'} *</label>
              <input
                style={inputStyle}
                value={form.vendor}
                onChange={(e) => setForm({ ...form, vendor: e.target.value })}
                placeholder={es ? 'PG&E, Costco, etc.' : 'PG&E, Costco, etc.'}
                autoFocus
              />
            </div>

            <div style={{ marginBottom: '0.875rem' }}>
              <label style={labelStyle}>{es ? 'Categoría' : 'Category'} *</label>
              <select
                style={inputStyle}
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value as TaxExpenseCategory })}
              >
                <option value="">{es ? 'Seleccionar...' : 'Select...'}</option>
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{es ? c.es : c.en}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              <label style={labelStyle}>{es ? 'Notas' : 'Notes'}</label>
              <textarea
                style={{ ...inputStyle, minHeight: '60px', resize: 'vertical', fontFamily: 'inherit' }}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>

            {form.category === 'Pass-through' && (
              <div style={{
                background: 'rgba(168,85,247,0.08)',
                border: '1px solid rgba(168,85,247,0.3)',
                borderRadius: '0.5rem',
                padding: '0.6rem 0.875rem',
                marginBottom: '1rem',
                fontSize: '0.72rem',
                color: '#c4b5fd',
              }}>
                ⊘ {es ? 'Marcado como Pass-through. NO se descontará del 1065.' : 'Marked as Pass-through. Will NOT be deducted on 1065.'}
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowModal(false)} style={btnSecondaryStyle}>
                {es ? 'Cancelar' : 'Cancel'}
              </button>
              <button
                onClick={handleSave}
                disabled={!form.vendor.trim() || !form.category || !form.amount}
                style={{
                  ...btnPrimaryStyle,
                  opacity: (!form.vendor.trim() || !form.category || !form.amount) ? 0.5 : 1,
                  cursor: (!form.vendor.trim() || !form.category || !form.amount) ? 'not-allowed' : 'pointer',
                }}
              >
                {es ? '💾 Guardar' : '💾 Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════ DELETE CONFIRM ════════════ */}
      {confirmDelete && (
        <div onClick={() => setConfirmDelete(null)} style={{ ...modalOverlay, zIndex: 210 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...modalCard, maxWidth: '420px', textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⚠️</div>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '0.5rem' }}>
              {es ? '¿Borrar este gasto?' : 'Delete this expense?'}
            </div>
            <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '1.25rem' }}>
              {es ? 'Esta acción no se puede deshacer.' : "This can't be undone."}
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
              <button onClick={() => setConfirmDelete(null)} style={btnSecondaryStyle}>
                {es ? 'Cancelar' : 'Cancel'}
              </button>
              <button onClick={() => handleDelete(confirmDelete)} style={{ ...btnPrimaryStyle, background: '#dc2626', color: 'white' }}>
                🗑 {es ? 'Borrar' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── End of TaxExpensesTab ────────────────────────────────

