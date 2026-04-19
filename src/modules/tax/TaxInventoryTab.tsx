// ============================================================
// CellHub Pro — Tax Inventory Tab (editable)
// Adapted from GOCELLULARAPP.html lines 1087-1273 (Inventory tab)
// COGS = Beginning Inventory + Purchases - Returns - Ending Inventory
// ============================================================

import { useState } from 'react';
import { useApp } from '@/store/AppProvider';
import { useToast } from '@/components/ui/Toast';
import { formatCurrency } from '@/utils/currency';
import { useTaxYear, RETURN_STATUSES, dollarsToCents, centsToDollars, todayISO } from './taxData';
import {
  inputStyle, labelStyle, thStyle, tdStyle, iconBtnStyle,
  modalOverlay, modalCard, btnSecondaryStyle, btnPrimaryStyle, btnAddStyle, cardBox,
} from './taxStyles';
import type { TaxSupplierPurchase, TaxSupplierReturn, TaxReturnStatus } from '@/store/types';

interface Props {
  year: number;
}

type ModalKind = 'supplier' | 'return' | null;

export default function TaxInventoryTab({ year }: Props) {
  const { state: { lang } } = useApp();
  const { toast } = useToast();
  const es = lang === 'es';
  const tax = useTaxYear(year);

  const [modalKind, setModalKind] = useState<ModalKind>(null);
  const [editingSupplier, setEditingSupplier] = useState<TaxSupplierPurchase | null>(null);
  const [editingReturn, setEditingReturn] = useState<TaxSupplierReturn | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ kind: 'supplier' | 'return'; id: string } | null>(null);

  // Supplier form
  const [supForm, setSupForm] = useState({ date: todayISO(), name: '', items: '', amount: '', paymentMethod: '' });
  // Return form
  const [retForm, setRetForm] = useState({
    date: todayISO(),
    supplier: '',
    product: '',
    quantity: '1',
    amount: '',
    qrCode: '',
    trackingNumber: '',
    status: 'Pending' as TaxReturnStatus,
    notes: '',
  });

  // ── Supplier handlers ──
  const openAddSupplier = () => {
    setEditingSupplier(null);
    setSupForm({ date: todayISO(), name: '', items: '', amount: '', paymentMethod: '' });
    setModalKind('supplier');
  };
  const openEditSupplier = (s: TaxSupplierPurchase) => {
    setEditingSupplier(s);
    setSupForm({
      date: s.date.slice(0, 10),
      name: s.name,
      items: s.items,
      amount: centsToDollars(s.amount),
      paymentMethod: s.paymentMethod ?? '',
    });
    setModalKind('supplier');
  };
  const saveSupplier = () => {
    if (!supForm.name.trim() || !supForm.amount) return;

    // r29c-1 — F-ZERO-AMOUNT
    const amountCents = dollarsToCents(supForm.amount);
    if (amountCents <= 0) {
      toast(es ? 'El monto debe ser mayor a $0' : 'Amount must be greater than $0', 'error');
      return;
    }

    // r29c-1 — F-DATE-OUTSIDE-YEAR
    const formYear = new Date(supForm.date).getFullYear();
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
      date: supForm.date,
      name: supForm.name.trim(),
      items: supForm.items.trim(),
      amount: amountCents,
      paymentMethod: supForm.paymentMethod.trim() || undefined,
    };
    if (editingSupplier) tax.updateSupplier(editingSupplier.id, payload);
    else tax.addSupplier(payload);
    setModalKind(null);
    setEditingSupplier(null);
  };

  // ── Return handlers ──
  const openAddReturn = () => {
    setEditingReturn(null);
    setRetForm({
      date: todayISO(), supplier: '', product: '', quantity: '1', amount: '',
      qrCode: '', trackingNumber: '', status: 'Pending', notes: '',
    });
    setModalKind('return');
  };
  const openEditReturn = (r: TaxSupplierReturn) => {
    setEditingReturn(r);
    setRetForm({
      date: r.date.slice(0, 10),
      supplier: r.supplier,
      product: r.product,
      quantity: String(r.quantity),
      amount: centsToDollars(r.amount),
      qrCode: r.qrCode ?? '',
      trackingNumber: r.trackingNumber ?? '',
      status: r.status,
      notes: r.notes ?? '',
    });
    setModalKind('return');
  };
  const saveReturn = () => {
    if (!retForm.supplier.trim() || !retForm.product.trim() || !retForm.amount) return;

    // r29c-1 — F-ZERO-AMOUNT
    const amountCents = dollarsToCents(retForm.amount);
    if (amountCents <= 0) {
      toast(es ? 'El reembolso debe ser mayor a $0' : 'Refund must be greater than $0', 'error');
      return;
    }

    // r29c-1 — F-INVENTORYTAB-QUANTITY-PARSE: explicit validation rejects invalid quantity.
    // Previously `parseInt(retForm.quantity, 10) || 1` silently coerced empty string,
    // NaN, "0", and negative numbers to 1, modifying user data without warning.
    const quantity = parseInt(retForm.quantity, 10);
    if (!Number.isFinite(quantity) || quantity < 1) {
      toast(es ? 'La cantidad debe ser un número entero ≥ 1' : 'Quantity must be a whole number ≥ 1', 'error');
      return;
    }

    // r29c-1 — F-DATE-OUTSIDE-YEAR
    const formYear = new Date(retForm.date).getFullYear();
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
      date: retForm.date,
      supplier: retForm.supplier.trim(),
      product: retForm.product.trim(),
      quantity,
      amount: amountCents,
      qrCode: retForm.qrCode.trim() || undefined,
      trackingNumber: retForm.trackingNumber.trim() || undefined,
      status: retForm.status,
      notes: retForm.notes.trim() || undefined,
    };
    if (editingReturn) tax.updateReturn(editingReturn.id, payload);
    else tax.addReturn(payload);
    setModalKind(null);
    setEditingReturn(null);
  };

  const sortedSuppliers = [...tax.data.suppliers].sort((a, b) => b.date.localeCompare(a.date));
  const sortedReturns = [...tax.data.returns].sort((a, b) => b.date.localeCompare(a.date));

  const statusInfo = (s: TaxReturnStatus) => RETURN_STATUSES.find((x) => x.value === s)!;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#e2e8f0' }}>
          {es ? 'Inventario y COGS' : 'Inventory & COGS'} — {year}
        </div>
        <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.15rem' }}>
          {es ? 'Schedule A — Cost of Goods Sold' : 'Schedule A — Cost of Goods Sold'}
        </div>
      </div>

      {/* Beginning / Ending Inventory */}
      <div style={cardBox}>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#cbd5e1', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {es ? 'Inventario Inicial / Final' : 'Beginning / Ending Inventory'}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div>
            <label style={labelStyle}>{es ? `Inventario Inicial (1 enero ${year})` : `Beginning Inventory (Jan 1, ${year})`} ($)</label>
            <input
              type="text"
              inputMode="decimal"
              style={inputStyle}
              value={centsToDollars(tax.data.inventory.beginningInventory)}
              onChange={(e) => tax.updateInventory({ beginningInventory: dollarsToCents(e.target.value) })}
              placeholder="0.00"
            />
          </div>
          <div>
            <label style={labelStyle}>{es ? `Inventario Final (31 dic ${year})` : `Ending Inventory (Dec 31, ${year})`} ($)</label>
            <input
              type="text"
              inputMode="decimal"
              style={inputStyle}
              value={centsToDollars(tax.data.inventory.endingInventory)}
              onChange={(e) => tax.updateInventory({ endingInventory: dollarsToCents(e.target.value) })}
              placeholder="0.00"
            />
          </div>
        </div>
        <div style={{ marginTop: '0.5rem', fontSize: '0.7rem', color: '#64748b' }}>
          💡 {es
            ? 'Cuenta físico al inicio y fin del año fiscal. Si es tu primer año, usa $0 inicial.'
            : 'Physical count at start and end of fiscal year. First year? Use $0 beginning.'}
        </div>
      </div>

      {/* Supplier Purchases */}
      <div style={cardBox}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {es ? 'Compras a Proveedores' : 'Supplier Purchases'}
          </div>
          <button onClick={openAddSupplier} style={btnAddStyle}>
            + {es ? 'Agregar Compra' : 'Add Purchase'}
          </button>
        </div>
        {sortedSuppliers.length === 0 ? (
          <div style={{ padding: '1.5rem', textAlign: 'center', fontSize: '0.78rem', color: '#64748b' }}>
            {es ? 'Sin compras registradas. Click "Agregar Compra" para empezar.' : 'No supplier purchases yet. Click "Add Purchase" to start.'}
          </div>
        ) : (
          <div style={{ background: 'rgba(0,0,0,0.15)', borderRadius: '0.5rem', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                  <th style={thStyle}>{es ? 'Fecha' : 'Date'}</th>
                  <th style={thStyle}>{es ? 'Proveedor' : 'Supplier'}</th>
                  <th style={thStyle}>{es ? 'Items' : 'Items'}</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>{es ? 'Monto' : 'Amount'}</th>
                  <th style={{ ...thStyle, textAlign: 'center', width: '90px' }}>{es ? 'Acciones' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody>
                {sortedSuppliers.map((s) => (
                  <tr key={s.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={tdStyle}>{new Date(s.date).toLocaleDateString(es ? 'es-MX' : 'en-US')}</td>
                    <td style={{ ...tdStyle, fontWeight: 600, color: '#e2e8f0' }}>
                      {s.name}
                      {s.paymentMethod && <div style={{ fontSize: '0.65rem', color: '#64748b' }}>{s.paymentMethod}</div>}
                    </td>
                    <td style={{ ...tdStyle, color: '#94a3b8' }}>{s.items}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: '#fb923c' }}>{formatCurrency(s.amount)}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: '0.3rem', justifyContent: 'center' }}>
                        <button onClick={() => openEditSupplier(s)} style={iconBtnStyle('blue')}>✏️</button>
                        <button onClick={() => setConfirmDelete({ kind: 'supplier', id: s.id })} style={iconBtnStyle('red')}>🗑</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ marginTop: '0.5rem', textAlign: 'right', fontSize: '0.85rem', color: '#cbd5e1' }}>
          {es ? 'Total Compras:' : 'Total Purchases:'} <strong style={{ color: '#fb923c' }}>{formatCurrency(tax.totalSupplierPurchases)}</strong>
        </div>
      </div>

      {/* Returns / RMA */}
      <div style={cardBox}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {es ? 'Devoluciones / RMA' : 'Returns / RMA'}
          </div>
          <button onClick={openAddReturn} style={btnAddStyle}>
            + {es ? 'Agregar Devolución' : 'Add Return'}
          </button>
        </div>
        {sortedReturns.length === 0 ? (
          <div style={{ padding: '1.5rem', textAlign: 'center', fontSize: '0.78rem', color: '#64748b' }}>
            {es ? 'Sin devoluciones registradas.' : 'No returns recorded yet.'}
          </div>
        ) : (
          <div style={{ background: 'rgba(0,0,0,0.15)', borderRadius: '0.5rem', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                  <th style={thStyle}>{es ? 'Fecha' : 'Date'}</th>
                  <th style={thStyle}>{es ? 'Proveedor' : 'Supplier'}</th>
                  <th style={thStyle}>{es ? 'Producto' : 'Product'}</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>Qty</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>{es ? 'Reembolso' : 'Refund'}</th>
                  <th style={thStyle}>{es ? 'Status' : 'Status'}</th>
                  <th style={{ ...thStyle, textAlign: 'center', width: '90px' }}>{es ? 'Acciones' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody>
                {sortedReturns.map((r) => {
                  const stat = statusInfo(r.status);
                  return (
                    <tr key={r.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={tdStyle}>{new Date(r.date).toLocaleDateString(es ? 'es-MX' : 'en-US')}</td>
                      <td style={{ ...tdStyle, color: '#e2e8f0' }}>{r.supplier}</td>
                      <td style={tdStyle}>
                        <div>{r.product}</div>
                        {r.qrCode && <div style={{ fontSize: '0.65rem', color: '#64748b' }}>RMA: {r.qrCode}</div>}
                        {r.trackingNumber && <div style={{ fontSize: '0.65rem', color: '#64748b' }}>📦 {r.trackingNumber}</div>}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>{r.quantity}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: r.status === 'Refunded' ? '#22c55e' : '#94a3b8' }}>
                        {formatCurrency(r.amount)}
                      </td>
                      <td style={tdStyle}>
                        <span style={{
                          display: 'inline-block',
                          padding: '0.2rem 0.5rem',
                          borderRadius: '0.3rem',
                          fontSize: '0.65rem',
                          fontWeight: 700,
                          background: `${stat.color}22`,
                          color: stat.color,
                          border: `1px solid ${stat.color}55`,
                        }}>
                          {es ? stat.es : stat.en}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: '0.3rem', justifyContent: 'center' }}>
                          <button onClick={() => openEditReturn(r)} style={iconBtnStyle('blue')}>✏️</button>
                          <button onClick={() => setConfirmDelete({ kind: 'return', id: r.id })} style={iconBtnStyle('red')}>🗑</button>
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
          {es ? 'Total Reembolsado:' : 'Total Refunded:'} <strong style={{ color: '#22c55e' }}>{formatCurrency(tax.totalSupplierReturns)}</strong>
        </div>
      </div>

      {/* COGS Calculation */}
      <div style={{
        ...cardBox,
        background: 'rgba(59,130,246,0.06)',
        border: '2px solid rgba(59,130,246,0.3)',
        marginBottom: 0,
      }}>
        <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#93c5fd', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {es ? 'COGS — Costo de Bienes Vendidos (Schedule A)' : 'COGS — Cost of Goods Sold (Schedule A)'}
        </div>
        <CogsRow label={es ? 'Inventario Inicial' : 'Beginning Inventory'} value={tax.data.inventory.beginningInventory} />
        <CogsRow label={es ? '+ Compras durante el año' : '+ Purchases during year'} value={tax.totalSupplierPurchases} sign="+" />
        <CogsRow label={es ? '− Devoluciones reembolsadas' : '− Returns refunded'} value={tax.totalSupplierReturns} sign="-" />
        <CogsRow label={es ? '− Inventario Final' : '− Ending Inventory'} value={tax.data.inventory.endingInventory} sign="-" />
        <div style={{
          marginTop: '0.5rem',
          paddingTop: '0.5rem',
          borderTop: '2px solid rgba(59,130,246,0.3)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{ fontSize: '0.95rem', fontWeight: 700, color: '#cbd5e1' }}>
            COGS {es ? '(Línea 8, Schedule A)' : '(Line 8, Schedule A)'}
          </span>
          <span
            style={{ fontSize: '1.4rem', fontWeight: 800, color: tax.cogs >= 0 ? '#60a5fa' : '#f87171', fontFamily: 'ui-monospace, monospace' }}
            title={tax.cogs < 0
              ? (es
                  ? 'COGS negativo significa que tu inventario final es mayor que (inicial + compras − devoluciones). Probablemente falta una compra o el conteo físico está mal. El 1065 va a clampear este valor a $0 — corrige los datos arriba.'
                  : 'Negative COGS means your ending inventory is greater than (beginning + purchases − returns). You probably forgot a purchase or your physical count is wrong. The 1065 will clamp this to $0 — fix the data above.')
              : undefined}
          >
            {formatCurrency(tax.cogs)}
          </span>
        </div>
        {/* r29c-1: F-INVENTORYTAB-COGS-NEGATIVE-WARNING — explicit warning when COGS < 0 */}
        {tax.cogs < 0 && (
          <div style={{
            marginTop: '0.75rem',
            padding: '0.75rem 1rem',
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.35)',
            borderRadius: '0.5rem',
            fontSize: '0.78rem',
            color: '#fca5a5',
            lineHeight: 1.5,
          }}>
            <strong>⚠️ {es ? 'COGS Negativo Detectado' : 'Negative COGS Detected'}</strong>
            <div style={{ marginTop: '0.3rem', color: '#fecaca' }}>
              {es
                ? 'Tu inventario final es mayor que (inicial + compras − devoluciones). Esto significa que probablemente: (1) falta capturar una compra a proveedor, (2) el conteo físico del inventario final está mal, o (3) el inicial está sobreestimado. El 1065 va a clampear este valor a $0 automáticamente — corrige los datos arriba antes de filear.'
                : 'Your ending inventory is greater than (beginning + purchases − returns). This means probably: (1) a supplier purchase is missing, (2) the physical ending count is wrong, or (3) the beginning is overestimated. The 1065 will automatically clamp this to $0 — fix the data above before filing.'}
            </div>
          </div>
        )}
      </div>

      {/* ════════════ SUPPLIER MODAL ════════════ */}
      {modalKind === 'supplier' && (
        <div onClick={() => setModalKind(null)} style={modalOverlay}>
          <div onClick={(e) => e.stopPropagation()} style={modalCard}>
            <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '1rem' }}>
              {editingSupplier ? (es ? '✏️ Editar Compra' : '✏️ Edit Purchase') : (es ? '+ Agregar Compra' : '+ Add Purchase')}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.875rem' }}>
              <div>
                <label style={labelStyle}>{es ? 'Fecha' : 'Date'} *</label>
                <input type="date" style={inputStyle} value={supForm.date} onChange={(e) => setSupForm({ ...supForm, date: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle}>{es ? 'Monto' : 'Amount'} ($) *</label>
                <input type="text" inputMode="decimal" style={inputStyle} value={supForm.amount} onChange={(e) => setSupForm({ ...supForm, amount: e.target.value })} placeholder="0.00" />
              </div>
            </div>
            <div style={{ marginBottom: '0.875rem' }}>
              <label style={labelStyle}>{es ? 'Proveedor' : 'Supplier Name'} *</label>
              <input style={inputStyle} value={supForm.name} onChange={(e) => setSupForm({ ...supForm, name: e.target.value })} placeholder="Modern Wireless, Costco, etc." autoFocus />
            </div>
            <div style={{ marginBottom: '0.875rem' }}>
              <label style={labelStyle}>{es ? 'Items / Descripción' : 'Items / Description'}</label>
              <input style={inputStyle} value={supForm.items} onChange={(e) => setSupForm({ ...supForm, items: e.target.value })} placeholder={es ? '50 fundas, 10 cargadores' : '50 cases, 10 chargers'} />
            </div>
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={labelStyle}>{es ? 'Método de Pago' : 'Payment Method'}</label>
              <input style={inputStyle} value={supForm.paymentMethod} onChange={(e) => setSupForm({ ...supForm, paymentMethod: e.target.value })} placeholder={es ? 'Chase Ink, AMEX, Cheque' : 'Chase Ink, AMEX, Check'} />
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setModalKind(null)} style={btnSecondaryStyle}>{es ? 'Cancelar' : 'Cancel'}</button>
              <button onClick={saveSupplier} disabled={!supForm.name.trim() || !supForm.amount} style={{
                ...btnPrimaryStyle,
                opacity: (!supForm.name.trim() || !supForm.amount) ? 0.5 : 1,
                cursor: (!supForm.name.trim() || !supForm.amount) ? 'not-allowed' : 'pointer',
              }}>💾 {es ? 'Guardar' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════ RETURN MODAL ════════════ */}
      {modalKind === 'return' && (
        <div onClick={() => setModalKind(null)} style={modalOverlay}>
          <div onClick={(e) => e.stopPropagation()} style={modalCard}>
            <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '1rem' }}>
              {editingReturn ? (es ? '✏️ Editar Devolución' : '✏️ Edit Return') : (es ? '+ Agregar Devolución' : '+ Add Return')}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.875rem' }}>
              <div>
                <label style={labelStyle}>{es ? 'Fecha' : 'Date'} *</label>
                <input type="date" style={inputStyle} value={retForm.date} onChange={(e) => setRetForm({ ...retForm, date: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle}>{es ? 'Reembolso' : 'Refund'} ($) *</label>
                <input type="text" inputMode="decimal" style={inputStyle} value={retForm.amount} onChange={(e) => setRetForm({ ...retForm, amount: e.target.value })} placeholder="0.00" />
              </div>
            </div>
            <div style={{ marginBottom: '0.875rem' }}>
              <label style={labelStyle}>{es ? 'Devolver a (Proveedor)' : 'Return To (Supplier)'} *</label>
              <input style={inputStyle} value={retForm.supplier} onChange={(e) => setRetForm({ ...retForm, supplier: e.target.value })} autoFocus />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem', marginBottom: '0.875rem' }}>
              <div>
                <label style={labelStyle}>{es ? 'Producto' : 'Product'} *</label>
                <input style={inputStyle} value={retForm.product} onChange={(e) => setRetForm({ ...retForm, product: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle}>{es ? 'Cantidad' : 'Quantity'}</label>
                <input type="number" min="1" style={inputStyle} value={retForm.quantity} onChange={(e) => setRetForm({ ...retForm, quantity: e.target.value })} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.875rem' }}>
              <div>
                <label style={labelStyle}>QR / RMA</label>
                <input style={inputStyle} value={retForm.qrCode} onChange={(e) => setRetForm({ ...retForm, qrCode: e.target.value })} placeholder="RMA12345" />
              </div>
              <div>
                <label style={labelStyle}>{es ? 'Tracking #' : 'Tracking #'}</label>
                <input style={inputStyle} value={retForm.trackingNumber} onChange={(e) => setRetForm({ ...retForm, trackingNumber: e.target.value })} placeholder="1Z999AA..." />
              </div>
            </div>
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={labelStyle}>Status</label>
              <select style={inputStyle} value={retForm.status} onChange={(e) => setRetForm({ ...retForm, status: e.target.value as TaxReturnStatus })}>
                {RETURN_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{es ? s.es : s.en}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setModalKind(null)} style={btnSecondaryStyle}>{es ? 'Cancelar' : 'Cancel'}</button>
              <button onClick={saveReturn} disabled={!retForm.supplier.trim() || !retForm.product.trim() || !retForm.amount} style={{
                ...btnPrimaryStyle,
                opacity: (!retForm.supplier.trim() || !retForm.product.trim() || !retForm.amount) ? 0.5 : 1,
                cursor: (!retForm.supplier.trim() || !retForm.product.trim() || !retForm.amount) ? 'not-allowed' : 'pointer',
              }}>💾 {es ? 'Guardar' : 'Save'}</button>
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
              {es ? '¿Borrar este registro?' : 'Delete this record?'}
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', marginTop: '1rem' }}>
              <button onClick={() => setConfirmDelete(null)} style={btnSecondaryStyle}>{es ? 'Cancelar' : 'Cancel'}</button>
              <button
                onClick={() => {
                  if (confirmDelete.kind === 'supplier') tax.deleteSupplier(confirmDelete.id);
                  else tax.deleteReturn(confirmDelete.id);
                  setConfirmDelete(null);
                }}
                style={{ ...btnPrimaryStyle, background: '#dc2626', color: 'white' }}
              >🗑 {es ? 'Borrar' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CogsRow({ label, value, sign }: { label: string; value: number; sign?: '+' | '-' }) {
  const color = sign === '-' ? '#f87171' : sign === '+' ? '#fb923c' : '#cbd5e1';
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.3rem 0', fontSize: '0.82rem' }}>
      <span style={{ color: '#94a3b8' }}>{label}</span>
      <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600, color }}>
        {sign === '-' ? `(${formatCurrency(value)})` : formatCurrency(value)}
      </span>
    </div>
  );
}
