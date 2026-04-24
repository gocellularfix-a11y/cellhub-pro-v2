// ============================================================
// CellHub Pro — Schedule M Tab (editable)
// Form 1065 Schedule M-1 — Reconciliation of Income per Books
// vs per Return. 6 book-to-tax adjustments. + Partner Draws
// array CRUD (K-1 Line 19 distributions + capital accounts).
// Persistence: settings.taxData.byYear[year].scheduleM + .draws
// ============================================================

import { useState, useMemo } from 'react';
import { useApp } from '@/store/AppProvider';
import { useToast } from '@/components/ui/Toast';
import { formatCurrency } from '@/utils/currency';
import { useTaxYear, emptyScheduleM, dollarsToCents, centsToDollars, todayISO } from './taxData';
import {
  inputStyle, labelStyle, thStyle, tdStyle, iconBtnStyle,
  modalOverlay, modalCard, btnSecondaryStyle, btnPrimaryStyle, btnAddStyle, cardBox,
} from './taxStyles';
import type { TaxDraw, TaxScheduleM } from '@/store/types';

interface Props {
  year: number;
}

// [key, EN, ES] — Schedule M-1 line items
const SCHED_M_FIELDS: Array<[keyof TaxScheduleM, string, string]> = [
  ['federalIncomeTax',     'Federal Income Tax',             'Impuesto Federal'],
  ['excessCapitalLosses',  'Excess Capital Losses',          'Pérdidas de Capital en Exceso'],
  ['incomeNotRecorded',    'Income Not Recorded on Books',   'Ingresos No Registrados'],
  ['expensesNotDeducted',  'Expenses Not Deducted',          'Gastos No Deducidos'],
  ['taxExemptInterest',    'Tax-Exempt Interest',            'Intereses Exentos'],
  ['deductionsNotCharged', 'Deductions Not Charged',         'Deducciones No Cargadas'],
];

export default function TaxScheduleMTab({ year }: Props) {
  const { state: { lang, settings } } = useApp();
  const { toast } = useToast();
  const es = lang === 'es';
  const tax = useTaxYear(year);
  const sm = tax.data.scheduleM ?? emptyScheduleM();
  const draws = tax.data.draws ?? [];
  const members = settings.partnership?.members ?? [];

  const nonNeg = (cents: number) => Math.max(0, cents);

  // ── Draw CRUD state ──
  const [editing, setEditing] = useState<TaxDraw | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [form, setForm] = useState({
    memberId: '',
    amount: '',
    date: todayISO(),
    notes: '',
  });

  const memberName = (id: string) => members.find((m) => m.id === id)?.name ?? '(unknown)';

  const openAdd = () => {
    setEditing(null);
    setForm({ memberId: members[0]?.id ?? '', amount: '', date: todayISO(), notes: '' });
    setShowModal(true);
  };

  const openEdit = (d: TaxDraw) => {
    setEditing(d);
    setForm({
      memberId: d.memberId,
      amount: centsToDollars(d.amount),
      date: d.date.slice(0, 10),
      notes: d.notes ?? '',
    });
    setShowModal(true);
  };

  const handleSave = () => {
    if (!form.memberId || !form.amount || !form.date) return;
    const amountCents = dollarsToCents(form.amount);
    if (amountCents <= 0) {
      toast(es ? 'El monto debe ser mayor a $0' : 'Amount must be greater than $0', 'error');
      return;
    }
    const formYear = new Date(form.date).getFullYear();
    if (formYear !== year) {
      toast(
        es
          ? `La fecha debe estar dentro del año fiscal ${year}`
          : `Date must be within fiscal year ${year}`,
        'error',
      );
      return;
    }
    const payload = {
      memberId: form.memberId,
      amount: amountCents,
      date: form.date,
      notes: form.notes.trim() || undefined,
    };
    if (editing) {
      tax.updateDraw(editing.id, payload);
    } else {
      tax.addDraw(payload);
    }
    setShowModal(false);
    setEditing(null);
  };

  const handleDelete = (id: string) => {
    tax.deleteDraw(id);
    setConfirmDelete(null);
  };

  const totalDraws = useMemo(
    () => draws.reduce((s, d) => s + d.amount, 0),
    [draws],
  );

  const sortedDraws = useMemo(
    () => [...draws].sort((a, b) => b.date.localeCompare(a.date)),
    [draws],
  );

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#e2e8f0' }}>
          {es ? 'Schedule M-1 + Retiros de Socios' : 'Schedule M-1 + Partner Draws'} — {year}
        </div>
        <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.15rem' }}>
          {es
            ? 'Reconciliación de ingresos contable vs fiscal. Retiros de socios para K-1 Línea 19.'
            : 'Book-to-tax income reconciliation. Partner draws for K-1 Line 19.'}
        </div>
      </div>

      {/* ── Schedule M-1 ── */}
      <div style={cardBox}>
        <div style={{
          fontSize: '0.78rem',
          fontWeight: 700,
          color: '#cbd5e1',
          marginBottom: '0.75rem',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}>
          {es ? 'Reconciliación Schedule M-1' : 'Schedule M-1 Reconciliation'}
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: '0.75rem',
        }}>
          {SCHED_M_FIELDS.map(([key, en, esLabel]) => (
            <div key={key}>
              <label style={labelStyle}>{es ? esLabel : en} ($)</label>
              <input
                type="text"
                inputMode="decimal"
                style={inputStyle}
                value={centsToDollars(sm[key])}
                onChange={(e) => tax.updateScheduleM({ [key]: nonNeg(dollarsToCents(e.target.value)) } as Partial<TaxScheduleM>)}
                placeholder="0.00"
              />
            </div>
          ))}
        </div>
      </div>

      {/* ── Partner Draws CRUD ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#e2e8f0' }}>
          {es ? 'Retiros de Socios' : 'Partner Draws'}
        </div>
        <button
          onClick={openAdd}
          disabled={members.length === 0}
          style={{
            ...btnAddStyle,
            opacity: members.length === 0 ? 0.4 : 1,
            cursor: members.length === 0 ? 'not-allowed' : 'pointer',
          }}
          title={members.length === 0 ? (es ? 'Agrega socios primero' : 'Add members first') : ''}
        >
          + {es ? 'Agregar Retiro' : 'Add Draw'}
        </button>
      </div>

      {members.length === 0 && (
        <div style={{
          background: 'rgba(251,191,36,0.08)',
          border: '1px dashed rgba(251,191,36,0.35)',
          borderRadius: '0.75rem',
          padding: '1rem',
          marginBottom: '1rem',
          fontSize: '0.78rem',
          color: '#fcd34d',
        }}>
          👥 {es
            ? 'No hay socios configurados. Agrega socios en el tab Members antes de registrar retiros.'
            : 'No partnership members configured. Add members in the Members tab before recording draws.'}
        </div>
      )}

      {sortedDraws.length === 0 ? (
        <div style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px dashed rgba(255,255,255,0.15)',
          borderRadius: '0.75rem',
          padding: '2rem 1rem',
          textAlign: 'center',
          marginBottom: '0.875rem',
        }}>
          <div style={{ fontSize: '1.5rem', marginBottom: '0.4rem' }}>💰</div>
          <div style={{ fontSize: '0.85rem', color: '#cbd5e1', fontWeight: 600 }}>
            {es ? 'No hay retiros registrados' : 'No draws recorded yet'}
          </div>
        </div>
      ) : (
        <div style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '0.75rem',
          overflow: 'hidden',
          marginBottom: '0.875rem',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                <th style={thStyle}>{es ? 'Fecha' : 'Date'}</th>
                <th style={thStyle}>{es ? 'Socio' : 'Member'}</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>{es ? 'Monto' : 'Amount'}</th>
                <th style={thStyle}>{es ? 'Notas' : 'Notes'}</th>
                <th style={{ ...thStyle, textAlign: 'center', width: '90px' }}>{es ? 'Acciones' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody>
              {sortedDraws.map((d) => (
                <tr key={d.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={tdStyle}>{new Date(d.date).toLocaleDateString(es ? 'es-MX' : 'en-US')}</td>
                  <td style={{ ...tdStyle, fontWeight: 600, color: '#e2e8f0' }}>{memberName(d.memberId)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: '#fca5a5' }}>
                    {formatCurrency(d.amount)}
                  </td>
                  <td style={{ ...tdStyle, color: '#64748b' }}>{d.notes ?? '—'}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    <div style={{ display: 'flex', gap: '0.3rem', justifyContent: 'center' }}>
                      <button onClick={() => openEdit(d)} style={iconBtnStyle('blue')} title={es ? 'Editar' : 'Edit'}>✏️</button>
                      <button onClick={() => setConfirmDelete(d.id)} style={iconBtnStyle('red')} title={es ? 'Borrar' : 'Delete'}>🗑</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: 'rgba(239,68,68,0.08)', borderTop: '1px solid rgba(239,68,68,0.25)' }}>
                <td style={{ ...tdStyle, fontWeight: 700, color: '#cbd5e1' }} colSpan={2}>
                  {es ? 'Total Retiros' : 'Total Draws'}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 800, color: '#fca5a5' }}>
                  {formatCurrency(totalDraws)}
                </td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* ════════════ DRAW MODAL ════════════ */}
      {showModal && (
        <div onClick={() => setShowModal(false)} style={modalOverlay}>
          <div onClick={(e) => e.stopPropagation()} style={modalCard}>
            <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '1rem' }}>
              {editing ? (es ? '✏️ Editar Retiro' : '✏️ Edit Draw') : (es ? '+ Agregar Retiro' : '+ Add Draw')}
            </div>

            <div style={{ marginBottom: '0.875rem' }}>
              <label style={labelStyle}>{es ? 'Socio' : 'Member'} *</label>
              <select
                style={inputStyle}
                value={form.memberId}
                onChange={(e) => setForm({ ...form, memberId: e.target.value })}
              >
                <option value="">{es ? 'Seleccionar...' : 'Select...'}</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.name} ({m.ownershipPct.toFixed(1)}%)</option>
                ))}
              </select>
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

            <div style={{ marginBottom: '1.25rem' }}>
              <label style={labelStyle}>{es ? 'Notas' : 'Notes'}</label>
              <textarea
                style={{ ...inputStyle, minHeight: '60px', resize: 'vertical', fontFamily: 'inherit' }}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowModal(false)} style={btnSecondaryStyle}>
                {es ? 'Cancelar' : 'Cancel'}
              </button>
              <button
                onClick={handleSave}
                disabled={!form.memberId || !form.amount || !form.date}
                style={{
                  ...btnPrimaryStyle,
                  opacity: (!form.memberId || !form.amount || !form.date) ? 0.5 : 1,
                  cursor: (!form.memberId || !form.amount || !form.date) ? 'not-allowed' : 'pointer',
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
              {es ? '¿Borrar este retiro?' : 'Delete this draw?'}
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
