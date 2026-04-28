// ============================================================
// CellHub Pro — Tax Inventory Tab (editable)
// Adapted from GOCELLULARAPP.html lines 1087-1273 (Inventory tab)
// COGS = Beginning Inventory + Purchases - Returns - Ending Inventory
// ============================================================

import { useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import { formatCurrency } from '@/utils/currency';
import { useTranslation } from '@/i18n';
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
  const { toast } = useToast();
  const { t, locale } = useTranslation();
  const tax = useTaxYear(year);

  const dateLocale = locale === 'es' ? 'es-MX' : locale === 'pt' ? 'pt-BR' : 'en-US';

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
      toast(t('taxInv.errAmountGreaterZero'), 'error');
      return;
    }

    // r29c-1 — F-DATE-OUTSIDE-YEAR
    const formYear = new Date(supForm.date).getFullYear();
    if (formYear !== year) {
      toast(t('taxInv.errDateOutsideYear', year), 'error');
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
      toast(t('taxInv.errRefundGreaterZero'), 'error');
      return;
    }

    // r29c-1 — F-INVENTORYTAB-QUANTITY-PARSE: explicit validation rejects invalid quantity.
    // Previously `parseInt(retForm.quantity, 10) || 1` silently coerced empty string,
    // NaN, "0", and negative numbers to 1, modifying user data without warning.
    const quantity = parseInt(retForm.quantity, 10);
    if (!Number.isFinite(quantity) || quantity < 1) {
      toast(t('taxInv.errQuantityInteger'), 'error');
      return;
    }

    // r29c-1 — F-DATE-OUTSIDE-YEAR
    const formYear = new Date(retForm.date).getFullYear();
    if (formYear !== year) {
      toast(t('taxInv.errDateOutsideYear', year), 'error');
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
          {t('taxInv.title', year)}
        </div>
        <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.15rem' }}>
          {t('taxInv.subtitle')}
        </div>
      </div>

      {/* Beginning / Ending Inventory */}
      <div style={cardBox}>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#cbd5e1', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {t('taxInv.beginEndHeader')}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div>
            <label style={labelStyle}>{t('taxInv.beginningInventoryLabel', year)} ($)</label>
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
            <label style={labelStyle}>{t('taxInv.endingInventoryLabel', year)} ($)</label>
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
          💡 {t('taxInv.physicalCountHint')}
        </div>
      </div>

      {/* Supplier Purchases */}
      <div style={cardBox}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {t('taxInv.suppliersHeader')}
          </div>
          <button onClick={openAddSupplier} style={btnAddStyle}>
            + {t('taxInv.addPurchaseBtn')}
          </button>
        </div>
        {sortedSuppliers.length === 0 ? (
          <div style={{ padding: '1.5rem', textAlign: 'center', fontSize: '0.78rem', color: '#64748b' }}>
            {t('taxInv.noSuppliers')}
          </div>
        ) : (
          <div style={{ background: 'rgba(0,0,0,0.15)', borderRadius: '0.5rem', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                  <th style={thStyle}>{t('taxInv.thDate')}</th>
                  <th style={thStyle}>{t('taxInv.thSupplier')}</th>
                  <th style={thStyle}>{t('taxInv.thItems')}</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>{t('taxInv.thAmount')}</th>
                  <th style={{ ...thStyle, textAlign: 'center', width: '90px' }}>{t('taxInv.thActions')}</th>
                </tr>
              </thead>
              <tbody>
                {sortedSuppliers.map((s) => (
                  <tr key={s.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={tdStyle}>{new Date(s.date).toLocaleDateString(dateLocale)}</td>
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
          {t('taxInv.totalPurchases')} <strong style={{ color: '#fb923c' }}>{formatCurrency(tax.totalSupplierPurchases)}</strong>
        </div>
      </div>

      {/* Returns / RMA */}
      <div style={cardBox}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {t('taxInv.returnsHeader')}
          </div>
          <button onClick={openAddReturn} style={btnAddStyle}>
            + {t('taxInv.addReturnBtn')}
          </button>
        </div>
        {sortedReturns.length === 0 ? (
          <div style={{ padding: '1.5rem', textAlign: 'center', fontSize: '0.78rem', color: '#64748b' }}>
            {t('taxInv.noReturns')}
          </div>
        ) : (
          <div style={{ background: 'rgba(0,0,0,0.15)', borderRadius: '0.5rem', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                  <th style={thStyle}>{t('taxInv.thDate')}</th>
                  <th style={thStyle}>{t('taxInv.thSupplier')}</th>
                  <th style={thStyle}>{t('taxInv.thProduct')}</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>Qty</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>{t('taxInv.thRefund')}</th>
                  <th style={thStyle}>{t('taxInv.thStatus')}</th>
                  <th style={{ ...thStyle, textAlign: 'center', width: '90px' }}>{t('taxInv.thActions')}</th>
                </tr>
              </thead>
              <tbody>
                {sortedReturns.map((r) => {
                  const stat = statusInfo(r.status);
                  return (
                    <tr key={r.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={tdStyle}>{new Date(r.date).toLocaleDateString(dateLocale)}</td>
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
                          {locale === 'es' ? stat.es : stat.en}
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
          {t('taxInv.totalRefunded')} <strong style={{ color: '#22c55e' }}>{formatCurrency(tax.totalSupplierReturns)}</strong>
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
          {t('taxInv.cogsHeader')}
        </div>
        <CogsRow label={t('taxInv.beginningInventoryShort')} value={tax.data.inventory.beginningInventory} />
        <CogsRow label={t('taxInv.purchasesDuringYear')} value={tax.totalSupplierPurchases} sign="+" />
        <CogsRow label={t('taxInv.returnsRefunded')} value={tax.totalSupplierReturns} sign="-" />
        <CogsRow label={t('taxInv.endingInventoryShort')} value={tax.data.inventory.endingInventory} sign="-" />
        <div style={{
          marginTop: '0.5rem',
          paddingTop: '0.5rem',
          borderTop: '2px solid rgba(59,130,246,0.3)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{ fontSize: '0.95rem', fontWeight: 700, color: '#cbd5e1' }}>
            COGS {t('taxInv.cogsLine8')}
          </span>
          <span
            style={{ fontSize: '1.4rem', fontWeight: 800, color: tax.cogs >= 0 ? '#60a5fa' : '#f87171', fontFamily: 'ui-monospace, monospace' }}
            title={tax.cogs < 0 ? t('taxInv.cogsNegativeTooltip') : undefined}
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
            <strong>⚠️ {t('taxInv.cogsNegativeWarningTitle')}</strong>
            <div style={{ marginTop: '0.3rem', color: '#fecaca' }}>
              {t('taxInv.cogsNegativeWarningBody')}
            </div>
          </div>
        )}
      </div>

      {/* ════════════ SUPPLIER MODAL ════════════ */}
      {modalKind === 'supplier' && (
        <div onClick={() => setModalKind(null)} style={modalOverlay}>
          <div onClick={(e) => e.stopPropagation()} style={modalCard}>
            <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '1rem' }}>
              {editingSupplier ? t('taxInv.editPurchaseTitle') : t('taxInv.addPurchaseTitle')}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.875rem' }}>
              <div>
                <label style={labelStyle}>{t('taxInv.dateLabel')} *</label>
                <input type="date" style={inputStyle} value={supForm.date} onChange={(e) => setSupForm({ ...supForm, date: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle}>{t('taxInv.amountLabel')} ($) *</label>
                <input type="text" inputMode="decimal" style={inputStyle} value={supForm.amount} onChange={(e) => setSupForm({ ...supForm, amount: e.target.value })} placeholder="0.00" />
              </div>
            </div>
            <div style={{ marginBottom: '0.875rem' }}>
              <label style={labelStyle}>{t('taxInv.supplierName')} *</label>
              <input style={inputStyle} value={supForm.name} onChange={(e) => setSupForm({ ...supForm, name: e.target.value })} placeholder="Modern Wireless, Costco, etc." autoFocus />
            </div>
            <div style={{ marginBottom: '0.875rem' }}>
              <label style={labelStyle}>{t('taxInv.itemsDescription')}</label>
              <input style={inputStyle} value={supForm.items} onChange={(e) => setSupForm({ ...supForm, items: e.target.value })} placeholder={t('taxInv.itemsPlaceholder')} />
            </div>
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={labelStyle}>{t('taxInv.paymentMethod')}</label>
              <input style={inputStyle} value={supForm.paymentMethod} onChange={(e) => setSupForm({ ...supForm, paymentMethod: e.target.value })} placeholder={t('taxInv.paymentMethodPlaceholder')} />
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setModalKind(null)} style={btnSecondaryStyle}>{t('cancel')}</button>
              <button onClick={saveSupplier} disabled={!supForm.name.trim() || !supForm.amount} style={{
                ...btnPrimaryStyle,
                opacity: (!supForm.name.trim() || !supForm.amount) ? 0.5 : 1,
                cursor: (!supForm.name.trim() || !supForm.amount) ? 'not-allowed' : 'pointer',
              }}>💾 {t('save')}</button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════ RETURN MODAL ════════════ */}
      {modalKind === 'return' && (
        <div onClick={() => setModalKind(null)} style={modalOverlay}>
          <div onClick={(e) => e.stopPropagation()} style={modalCard}>
            <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '1rem' }}>
              {editingReturn ? t('taxInv.editReturnTitle') : t('taxInv.addReturnTitle')}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.875rem' }}>
              <div>
                <label style={labelStyle}>{t('taxInv.dateLabel')} *</label>
                <input type="date" style={inputStyle} value={retForm.date} onChange={(e) => setRetForm({ ...retForm, date: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle}>{t('taxInv.refundLabel')} ($) *</label>
                <input type="text" inputMode="decimal" style={inputStyle} value={retForm.amount} onChange={(e) => setRetForm({ ...retForm, amount: e.target.value })} placeholder="0.00" />
              </div>
            </div>
            <div style={{ marginBottom: '0.875rem' }}>
              <label style={labelStyle}>{t('taxInv.returnToSupplier')} *</label>
              <input style={inputStyle} value={retForm.supplier} onChange={(e) => setRetForm({ ...retForm, supplier: e.target.value })} autoFocus />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem', marginBottom: '0.875rem' }}>
              <div>
                <label style={labelStyle}>{t('taxInv.productLabel')} *</label>
                <input style={inputStyle} value={retForm.product} onChange={(e) => setRetForm({ ...retForm, product: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle}>{t('taxInv.qtyLabel')}</label>
                <input type="number" min="1" style={inputStyle} value={retForm.quantity} onChange={(e) => setRetForm({ ...retForm, quantity: e.target.value })} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.875rem' }}>
              <div>
                <label style={labelStyle}>QR / RMA</label>
                <input style={inputStyle} value={retForm.qrCode} onChange={(e) => setRetForm({ ...retForm, qrCode: e.target.value })} placeholder="RMA12345" />
              </div>
              <div>
                <label style={labelStyle}>Tracking #</label>
                <input style={inputStyle} value={retForm.trackingNumber} onChange={(e) => setRetForm({ ...retForm, trackingNumber: e.target.value })} placeholder="1Z999AA..." />
              </div>
            </div>
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={labelStyle}>Status</label>
              <select style={inputStyle} value={retForm.status} onChange={(e) => setRetForm({ ...retForm, status: e.target.value as TaxReturnStatus })}>
                {RETURN_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{locale === 'es' ? s.es : s.en}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setModalKind(null)} style={btnSecondaryStyle}>{t('cancel')}</button>
              <button onClick={saveReturn} disabled={!retForm.supplier.trim() || !retForm.product.trim() || !retForm.amount} style={{
                ...btnPrimaryStyle,
                opacity: (!retForm.supplier.trim() || !retForm.product.trim() || !retForm.amount) ? 0.5 : 1,
                cursor: (!retForm.supplier.trim() || !retForm.product.trim() || !retForm.amount) ? 'not-allowed' : 'pointer',
              }}>💾 {t('save')}</button>
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
              {t('taxInv.deleteRecordTitle')}
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', marginTop: '1rem' }}>
              <button onClick={() => setConfirmDelete(null)} style={btnSecondaryStyle}>{t('cancel')}</button>
              <button
                onClick={() => {
                  if (confirmDelete.kind === 'supplier') tax.deleteSupplier(confirmDelete.id);
                  else tax.deleteReturn(confirmDelete.id);
                  setConfirmDelete(null);
                }}
                style={{ ...btnPrimaryStyle, background: '#dc2626', color: 'white' }}
              >🗑 {t('delete')}</button>
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
