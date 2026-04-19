// ============================================================
// CellHub Pro — Tax Income Tab (editable manual entries)
// Adapted from GOCELLULARAPP.html lines 886-1042 (Income tab)
// + lines 4209-4260 (income modal)
// ============================================================

import { useState } from 'react';
import { useApp } from '@/store/AppProvider';
import { useToast } from '@/components/ui/Toast';
import { formatCurrency } from '@/utils/currency';
import { useTaxYear, INCOME_CATEGORIES, dollarsToCents, centsToDollars, todayISO } from './taxData';
import {
  inputStyle, labelStyle, thStyle, tdStyle, iconBtnStyle,
  modalOverlay, modalCard, btnSecondaryStyle, btnPrimaryStyle, btnAddStyle, cardBox,
} from './taxStyles';
import type { TaxIncomeEntry, TaxIncomeCategory } from '@/store/types';

interface Props {
  year: number;
  posProfitCents: number;  // POS net profit auto-calculated by parent
}

export default function TaxIncomeTab({ year, posProfitCents }: Props) {
  const { state: { lang } } = useApp();
  const { toast } = useToast();
  const es = lang === 'es';
  const tax = useTaxYear(year);

  const [editing, setEditing] = useState<TaxIncomeEntry | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const [form, setForm] = useState({
    date: todayISO(),
    source: '',
    category: '' as TaxIncomeCategory | '',
    amount: '',
    notes: '',
  });

  const openAdd = () => {
    setEditing(null);
    setForm({ date: todayISO(), source: '', category: '', amount: '', notes: '' });
    setShowModal(true);
  };

  const openEdit = (i: TaxIncomeEntry) => {
    setEditing(i);
    setForm({
      date: i.date.slice(0, 10),
      source: i.source,
      category: i.category,
      amount: centsToDollars(i.amount),
      notes: i.notes ?? '',
    });
    setShowModal(true);
  };

  const handleSave = () => {
    if (!form.source.trim() || !form.category || !form.amount) return;

    // r29c-1 — F-ZERO-AMOUNT: reject save when amount is 0 or invalid.
    // Entries with $0 have no accounting meaning and would clutter the tax filing.
    const amountCents = dollarsToCents(form.amount);
    if (amountCents <= 0) {
      toast(es ? 'El monto debe ser mayor a $0' : 'Amount must be greater than $0', 'error');
      return;
    }

    // r29c-1 — F-DATE-OUTSIDE-YEAR: reject dates outside the selected fiscal year.
    // Otherwise the entry would silently disappear from view (year filter excludes it).
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
      source: form.source.trim(),
      category: form.category as TaxIncomeCategory,
      amount: amountCents,
      notes: form.notes.trim() || undefined,
    };
    if (editing) tax.updateIncome(editing.id, payload);
    else tax.addIncome(payload);
    setShowModal(false);
    setEditing(null);
  };

  const sortedIncome = [...tax.data.income].sort((a, b) => b.date.localeCompare(a.date));

  // Total Income summary (mirrors original logic at line 1027)
  const otherIncome = tax.data.adjustments.otherIncome;
  const returnsAdjustment = tax.data.adjustments.returnsRefunds;
  const totalNetIncome = posProfitCents + tax.totalManualIncome + otherIncome - returnsAdjustment;

  const catLabel = (val: TaxIncomeCategory) =>
    INCOME_CATEGORIES.find((c) => c.value === val)?.[es ? 'es' : 'en'] ?? val;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#e2e8f0' }}>
            {es ? 'Ingresos' : 'Income'} — {year}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.15rem' }}>
            {es ? 'POS automático + entradas manuales editables' : 'Auto POS + editable manual entries'}
          </div>
        </div>
        <button onClick={openAdd} style={btnAddStyle}>
          + {es ? 'Agregar Ingreso' : 'Add Income'}
        </button>
      </div>

      {/* POS auto-calculated card */}
      <div style={{ ...cardBox, background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#86efac' }}>
            🛒 {es ? 'Ingreso del POS (Auto-calculado)' : 'POS Income (Auto-Calculated)'}
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#22c55e', fontFamily: 'ui-monospace, monospace' }}>
            {formatCurrency(posProfitCents)}
          </div>
        </div>
        <div style={{ fontSize: '0.7rem', color: '#94a3b8', lineHeight: 1.5 }}>
          {es
            ? 'Esto se calcula automáticamente de las ventas del POS, repairs y unlocks. No es editable aquí — para modificarlo, edita las ventas individuales.'
            : 'Auto-calculated from POS sales, repairs and unlocks. Not editable here — to modify, edit individual sales.'}
        </div>
      </div>

      {/* Manual income table */}
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#cbd5e1', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {es ? 'Ingresos Manuales' : 'Manual Income Entries'}
        </div>
        {sortedIncome.length === 0 ? (
          <div style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px dashed rgba(255,255,255,0.15)',
            borderRadius: '0.75rem',
            padding: '2rem 1rem',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '1.6rem', marginBottom: '0.4rem' }}>💰</div>
            <div style={{ fontSize: '0.85rem', color: '#cbd5e1', fontWeight: 600, marginBottom: '0.25rem' }}>
              {es ? 'No hay ingresos manuales' : 'No manual income entries'}
            </div>
            <div style={{ fontSize: '0.72rem', color: '#64748b', lineHeight: 1.6 }}>
              {es ? 'Usa esto para:' : 'Use this for:'}<br/>
              • {es ? 'Comisiones de Pagos (AT&T, Verizon, T-Mobile)' : 'Payment Commissions (AT&T, Verizon, T-Mobile)'}<br/>
              • {es ? 'Ingresos en efectivo no capturados en POS' : 'Cash income not captured in POS'}<br/>
              • {es ? 'Otros ingresos del negocio' : 'Other business income'}
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
                  <th style={thStyle}>{es ? 'Fuente' : 'Source'}</th>
                  <th style={thStyle}>{es ? 'Categoría' : 'Category'}</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>{es ? 'Monto' : 'Amount'}</th>
                  <th style={{ ...thStyle, textAlign: 'center', width: '90px' }}>{es ? 'Acciones' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody>
                {sortedIncome.map((inc) => {
                  const isPassThrough = inc.category === 'Pass-Through Income';
                  return (
                    <tr key={inc.id} style={{
                      background: isPassThrough ? 'rgba(168,85,247,0.04)' : 'transparent',
                      borderTop: '1px solid rgba(255,255,255,0.05)',
                    }}>
                      <td style={tdStyle}>{new Date(inc.date).toLocaleDateString(es ? 'es-MX' : 'en-US')}</td>
                      <td style={{ ...tdStyle, fontWeight: 600, color: '#e2e8f0' }}>{inc.source}</td>
                      <td style={tdStyle}>
                        {catLabel(inc.category)}
                        {isPassThrough && <span style={{ marginLeft: '0.4rem', fontSize: '0.68rem', color: '#a78bfa' }}>⊘</span>}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: isPassThrough ? '#a78bfa' : '#22c55e' }}>
                        {formatCurrency(inc.amount)}
                        {isPassThrough && <div style={{ fontSize: '0.65rem', color: '#64748b' }}>{es ? '(excluido)' : '(excluded)'}</div>}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: '0.3rem', justifyContent: 'center' }}>
                          <button onClick={() => openEdit(inc)} style={iconBtnStyle('blue')}>✏️</button>
                          <button onClick={() => setConfirmDelete(inc.id)} style={iconBtnStyle('red')}>🗑</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ marginTop: '0.5rem', textAlign: 'right', fontSize: '0.85rem', color: '#cbd5e1' }}>
          {es ? 'Total Manual:' : 'Total Manual:'} <strong style={{ color: '#22c55e' }}>{formatCurrency(tax.totalManualIncome)}</strong>
        </div>
      </div>

      {/* Adjustments */}
      <div style={cardBox}>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#cbd5e1', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {es ? 'Ajustes' : 'Adjustments'}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div>
            <label style={labelStyle}>{es ? 'Otros Ingresos' : 'Other Income'} ($)</label>
            <input
              type="text"
              inputMode="decimal"
              style={inputStyle}
              value={centsToDollars(otherIncome)}
              onChange={(e) => tax.updateAdjustments({ otherIncome: dollarsToCents(e.target.value) })}
            />
          </div>
          <div>
            <label style={labelStyle}>{es ? 'Devoluciones / Reembolsos' : 'Returns / Refunds'} ($)</label>
            <input
              type="text"
              inputMode="decimal"
              style={inputStyle}
              value={centsToDollars(returnsAdjustment)}
              onChange={(e) => tax.updateAdjustments({ returnsRefunds: dollarsToCents(e.target.value) })}
            />
          </div>
        </div>
      </div>

      {/* Total income summary */}
      <div style={{
        ...cardBox,
        background: 'rgba(34,197,94,0.08)',
        border: '2px solid rgba(34,197,94,0.3)',
        marginBottom: 0,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '1rem', fontWeight: 700, color: '#cbd5e1' }}>
            {es ? 'Ingreso Total Neto' : 'Total Income (Net)'}
          </span>
          <span style={{ fontSize: '1.7rem', fontWeight: 800, color: '#22c55e', fontFamily: 'ui-monospace, monospace' }}>
            {formatCurrency(totalNetIncome)}
          </span>
        </div>
        <div style={{ marginTop: '0.5rem', fontSize: '0.7rem', color: '#94a3b8' }}>
          POS: {formatCurrency(posProfitCents)} + {es ? 'Manual' : 'Manual'}: {formatCurrency(tax.totalManualIncome)} + {es ? 'Otros' : 'Other'}: {formatCurrency(otherIncome)} − {es ? 'Devoluciones' : 'Returns'}: {formatCurrency(returnsAdjustment)}
        </div>
      </div>

      {/* ════════════ EDIT MODAL ════════════ */}
      {showModal && (
        <div onClick={() => setShowModal(false)} style={modalOverlay}>
          <div onClick={(e) => e.stopPropagation()} style={modalCard}>
            <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '1rem' }}>
              {editing ? (es ? '✏️ Editar Ingreso' : '✏️ Edit Income') : (es ? '+ Agregar Ingreso' : '+ Add Income')}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.875rem' }}>
              <div>
                <label style={labelStyle}>{es ? 'Fecha' : 'Date'} *</label>
                <input type="date" style={inputStyle} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle}>{es ? 'Monto' : 'Amount'} ($) *</label>
                <input type="text" inputMode="decimal" style={inputStyle} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" />
              </div>
            </div>

            <div style={{ marginBottom: '0.875rem' }}>
              <label style={labelStyle}>{es ? 'Fuente / Cliente' : 'Source / Customer'} *</label>
              <input style={inputStyle} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder={es ? 'AT&T, walk-in, etc.' : 'AT&T, walk-in, etc.'} autoFocus />
            </div>

            <div style={{ marginBottom: '0.875rem' }}>
              <label style={labelStyle}>{es ? 'Categoría' : 'Category'} *</label>
              <select style={inputStyle} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as TaxIncomeCategory })}>
                <option value="">{es ? 'Seleccionar...' : 'Select...'}</option>
                {INCOME_CATEGORIES.map((c) => (
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

            {form.category === 'Pass-Through Income' && (
              <div style={{
                background: 'rgba(168,85,247,0.08)',
                border: '1px solid rgba(168,85,247,0.3)',
                borderRadius: '0.5rem',
                padding: '0.6rem 0.875rem',
                marginBottom: '1rem',
                fontSize: '0.72rem',
                color: '#c4b5fd',
              }}>
                ⊘ {es ? 'Pass-through. NO se contará como ingreso del 1065.' : 'Pass-through. Will NOT count as 1065 income.'}
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowModal(false)} style={btnSecondaryStyle}>{es ? 'Cancelar' : 'Cancel'}</button>
              <button
                onClick={handleSave}
                disabled={!form.source.trim() || !form.category || !form.amount}
                style={{
                  ...btnPrimaryStyle,
                  opacity: (!form.source.trim() || !form.category || !form.amount) ? 0.5 : 1,
                  cursor: (!form.source.trim() || !form.category || !form.amount) ? 'not-allowed' : 'pointer',
                }}
              >💾 {es ? 'Guardar' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE CONFIRM */}
      {confirmDelete && (
        <div onClick={() => setConfirmDelete(null)} style={{ ...modalOverlay, zIndex: 210 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...modalCard, maxWidth: '420px', textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⚠️</div>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '0.5rem' }}>
              {es ? '¿Borrar este ingreso?' : 'Delete this income entry?'}
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', marginTop: '1rem' }}>
              <button onClick={() => setConfirmDelete(null)} style={btnSecondaryStyle}>{es ? 'Cancelar' : 'Cancel'}</button>
              <button onClick={() => { tax.deleteIncome(confirmDelete); setConfirmDelete(null); }} style={{ ...btnPrimaryStyle, background: '#dc2626', color: 'white' }}>
                🗑 {es ? 'Borrar' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
