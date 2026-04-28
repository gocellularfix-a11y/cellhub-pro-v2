// ============================================================
// CellHub Pro — Tax Expenses Tab (editable)
// Adapted from GOCELLULARAPP.html lines 1042-1085 (Expenses tab)
// + lines 4161-4205 (expense modal)
// Storage now in settings.taxData.byYear[year].expenses
// ============================================================

import { useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import { formatCurrency } from '@/utils/currency';
import { useTranslation } from '@/i18n';
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
  const { toast } = useToast();
  const { t, locale } = useTranslation();
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
      toast(t('taxExpenses.errAmountGreaterZero'), 'error');
      return;
    }

    // r29c-1 — F-DATE-OUTSIDE-YEAR
    const formYear = new Date(form.date).getFullYear();
    if (formYear !== year) {
      toast(t('taxExpenses.errDateOutsideYear', year), 'error');
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
    EXPENSE_CATEGORIES.find((c) => c.value === val)?.[locale === 'es' ? 'es' : 'en'] ?? val;

  const dateLocale = locale === 'es' ? 'es-MX' : locale === 'pt' ? 'pt-BR' : 'en-US';

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#e2e8f0' }}>
            {t('taxExpenses.title', year)}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.15rem' }}>
            {t('taxExpenses.subtitle')}
          </div>
        </div>
        <button onClick={openAdd} style={btnAddStyle}>
          + {t('taxExpenses.addBtn')}
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
            {t('taxExpenses.deductibleHeader')}
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
            Pass-through {t('taxExpenses.passThroughExcluded')}
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
            {t('taxExpenses.totalEntries')}
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
        <strong>💡 Pass-through:</strong> {t('taxExpenses.passThroughBanner')}
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
            {t('taxExpenses.empty')}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
            {t('taxExpenses.emptyHint', year)}
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
                <th style={thStyle}>{t('taxExpenses.thDate')}</th>
                <th style={thStyle}>{t('taxExpenses.thVendor')}</th>
                <th style={thStyle}>{t('taxExpenses.thCategory')}</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>{t('taxExpenses.thAmount')}</th>
                <th style={{ ...thStyle, textAlign: 'center', width: '90px' }}>{t('taxExpenses.thActions')}</th>
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
                    <td style={tdStyle}>{new Date(exp.date).toLocaleDateString(dateLocale)}</td>
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
                        <button onClick={() => openEdit(exp)} style={iconBtnStyle('blue')} title={t('edit')}>✏️</button>
                        <button onClick={() => setConfirmDelete(exp.id)} style={iconBtnStyle('red')} title={t('delete')}>🗑</button>
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
            {t('taxExpenses.byCategoryHeader')}
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
              {editing ? t('taxExpenses.editTitle') : t('taxExpenses.addTitle')}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.875rem' }}>
              <div>
                <label style={labelStyle}>{t('taxExpenses.dateLabel')} *</label>
                <input
                  type="date"
                  style={inputStyle}
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                />
              </div>
              <div>
                <label style={labelStyle}>{t('taxExpenses.amountLabel')} ($) *</label>
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
              <label style={labelStyle}>{t('taxExpenses.vendorLabel')} *</label>
              <input
                style={inputStyle}
                value={form.vendor}
                onChange={(e) => setForm({ ...form, vendor: e.target.value })}
                placeholder={t('taxExpenses.vendorPlaceholder')}
                autoFocus
              />
            </div>

            <div style={{ marginBottom: '0.875rem' }}>
              <label style={labelStyle}>{t('taxExpenses.categoryLabel')} *</label>
              <select
                style={inputStyle}
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value as TaxExpenseCategory })}
              >
                <option value="">{t('taxExpenses.selectPlaceholder')}</option>
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{locale === 'es' ? c.es : c.en}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              <label style={labelStyle}>{t('taxExpenses.notesLabel')}</label>
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
                ⊘ {t('taxExpenses.passThroughHint')}
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowModal(false)} style={btnSecondaryStyle}>
                {t('cancel')}
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
                💾 {t('save')}
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
              {t('taxExpenses.deleteConfirmTitle')}
            </div>
            <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '1.25rem' }}>
              {t('taxExpenses.cantUndo')}
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
              <button onClick={() => setConfirmDelete(null)} style={btnSecondaryStyle}>
                {t('cancel')}
              </button>
              <button onClick={() => handleDelete(confirmDelete)} style={{ ...btnPrimaryStyle, background: '#dc2626', color: 'white' }}>
                🗑 {t('delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── End of TaxExpensesTab ────────────────────────────────

