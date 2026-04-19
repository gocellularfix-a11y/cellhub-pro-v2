// ============================================================
// CellHub Pro — Purchase Orders Module
// Create, track, and receive vendor purchase orders.
// Auto-updates inventory qty on item receipt.
// ============================================================

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useApp } from '@/store/AppProvider';
import { useToast } from '@/components/ui/Toast';
import { Modal } from '@/components/ui';
import GlobalSearchBar from '@/components/shared/GlobalSearchBar';
import { useHighlightRecord } from '@/hooks/useHighlightRecord';
import { getLabels } from '@/config/i18n';
import { formatCurrency } from '@/utils/currency';
import { persist, remove, batchSave } from '@/services/persist';
import { COLLECTIONS } from '@/config/constants';
import { matchesSearch } from '@/utils/fuzzyMatch';
import { generateId } from '@/utils/dates';
import POReceiveModal from './POReceiveModal';
import type { PurchaseOrder, POItem, InventoryItem } from '@/store/types';

// ── Constants ─────────────────────────────────────────────

const STATUSES = ['All', 'draft', 'ordered', 'partial', 'received', 'cancelled'] as const;

function statusBadge(status: string): string {
  const map: Record<string, string> = {
    draft: 'badge-neutral',
    ordered: 'badge-info',
    partial: 'badge-warning',
    received: 'badge-success',
    cancelled: 'badge-danger',
  };
  return map[status] ?? 'badge-neutral';
}

// ── Module ────────────────────────────────────────────────

export default function PurchaseOrdersModule() {
  const {
    state: { purchaseOrders, inventory, lang, settings, globalSearchTerm },
    setPurchaseOrders,
    setInventory,
    dispatch,
  } = useApp();

  const { toast } = useToast();
  const { highlightRef, isHighlighted } = useHighlightRecord<HTMLDivElement>();
  const L = getLabels(lang);
  const es = lang === 'es';

  // Round 20: anti-stale-closure ref (canonical project pattern). setPurchaseOrders
  // from AppProvider only accepts arrays (not functions), so handlers that read
  // `purchaseOrders` from the closure can clobber concurrent updates from the
  // Firestore listener (multi-station sync). All write paths in this module read
  // purchaseOrdersRef.current and assign back before calling setPurchaseOrders.
  const purchaseOrdersRef = useRef(purchaseOrders);
  useEffect(() => { purchaseOrdersRef.current = purchaseOrders; }, [purchaseOrders]);
  const inventoryRef = useRef(inventory);
  useEffect(() => { inventoryRef.current = inventory; }, [inventory]);

  // ── UI state ────────────────────────────────────────────
  const [search, setSearch] = useState(globalSearchTerm || '');
  const [filterStatus, setFilterStatus] = useState('All');
  const [showFormModal, setShowFormModal] = useState(false);
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [editPO, setEditPO] = useState<PurchaseOrder | null>(null);
  const [receivePO, setReceivePO] = useState<PurchaseOrder | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Consume cross-module search term once on mount
  useEffect(() => {
    if (globalSearchTerm) {
      setSearch(globalSearchTerm);
      dispatch({ type: 'SET_GLOBAL_SEARCH', payload: '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Form state ──────────────────────────────────────────
  const [form, setForm] = useState<Partial<PurchaseOrder>>({});
  const [formItems, setFormItems] = useState<POItem[]>([]);
  const [invSearch, setInvSearch] = useState('');
  const [showInvPicker, setShowInvPicker] = useState<string | null>(null); // POItem.id being linked

  // ── Derived data ────────────────────────────────────────

  const filtered = useMemo(() => {
    return purchaseOrders
      .filter((po) => filterStatus === 'All' || po.status === filterStatus)
      .filter((po) => matchesSearch(search, po.poNumber, po.vendor, po.vendorContact, po.notes))
      .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime());
  }, [purchaseOrders, filterStatus, search]);

  const stats = useMemo(() => {
    const open = purchaseOrders.filter((p) => !['received', 'cancelled'].includes(p.status));
    const totalSpend = purchaseOrders
      .filter((p) => p.status !== 'cancelled')
      .reduce((sum, p) => sum + p.total, 0);
    const pendingCost = open.reduce((sum, p) => sum + p.total, 0);
    return { total: purchaseOrders.length, open: open.length, totalSpend, pendingCost };
  }, [purchaseOrders]);

  // ── PO Number generator ──────────────────────────────────
  // Round 20 fix (BUG 1): old code used Math.max(...) + 1 which collided when two
  // stations generated POs simultaneously (both read the array snapshot before the
  // Firestore push). Now: year-scoped sequential + 4-char random suffix. Pattern:
  // PO-2026-0042-A7K9. Sequential gives Jorge a human-readable counter, suffix
  // prevents cross-station collision.
  // Side fix: old regex matched ANY year (PO-NNNN-NNNN) so the counter never reset
  // in January. New regex is year-scoped via template string.
  const nextPONumber = useCallback(() => {
    const year = new Date().getFullYear();
    const yearRegex = new RegExp(`^PO-${year}-(\\d+)`);
    const existingNumbers = purchaseOrders
      .map((p) => {
        const m = p.poNumber.match(yearRegex);
        return m ? parseInt(m[1], 10) : 0;
      });
    const next = existingNumbers.length > 0 ? Math.max(0, ...existingNumbers) + 1 : 1;
    const seqStr = String(next).padStart(4, '0');
    const rand4 = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `PO-${year}-${seqStr}-${rand4}`;
  }, [purchaseOrders]);

  // ── Form helpers ─────────────────────────────────────────

  const calcTotals = useCallback((items: POItem[], shipping: number) => {
    const subtotal = items.reduce((sum, i) => sum + i.cost * i.qtyOrdered, 0);
    return { subtotal, total: subtotal + shipping };
  }, []);

  const openNew = () => {
    setEditPO(null);
    setForm({
      poNumber: nextPONumber(),
      vendor: '',
      vendorContact: '',
      status: 'draft',
      shippingCost: 0,
      notes: '',
      expectedDate: '',
    });
    setFormItems([]);
    setShowFormModal(true);
  };

  const openEdit = (po: PurchaseOrder) => {
    if (['received', 'cancelled'].includes(po.status)) {
      toast(es ? 'No se puede editar una PO cerrada' : 'Cannot edit a closed PO', 'error');
      return;
    }
    setEditPO(po);
    setForm({ ...po });
    setFormItems([...po.items]);
    setShowFormModal(true);
  };

  const openReceive = (po: PurchaseOrder) => {
    if (po.status === 'received') {
      toast(es ? 'Esta orden ya fue recibida completamente' : 'Order already fully received', 'info');
      return;
    }
    if (po.status === 'cancelled') {
      toast(es ? 'Orden cancelada' : 'Order is cancelled', 'error');
      return;
    }
    setReceivePO(po);
    setShowReceiveModal(true);
  };

  // ── Line item management ─────────────────────────────────

  const addLineItem = () => {
    const newItem: POItem = {
      id: generateId(),
      name: '',
      sku: '',
      cost: 0,
      qtyOrdered: 1,
      qtyReceived: 0,
      inventoryId: undefined,
    };
    setFormItems((prev) => [...prev, newItem]);
  };

  const updateLineItem = (id: string, field: keyof POItem, value: string | number) => {
    setFormItems((prev) =>
      prev.map((item) => item.id === id ? { ...item, [field]: value } : item),
    );
  };

  const removeLineItem = (id: string) => {
    setFormItems((prev) => prev.filter((item) => item.id !== id));
  };

  const linkInventoryItem = (poItemId: string, invItem: InventoryItem) => {
    setFormItems((prev) =>
      prev.map((item) =>
        item.id === poItemId
          ? {
              ...item,
              inventoryId: invItem.id,
              name: item.name || invItem.name,
              sku: item.sku || invItem.sku,
              cost: item.cost || invItem.cost,
            }
          : item,
      ),
    );
    setShowInvPicker(null);
    setInvSearch('');
  };

  // ── Save PO ──────────────────────────────────────────────

  const handleSave = useCallback(() => {
    if (!form.vendor?.trim()) {
      toast(es ? 'Ingresa el nombre del proveedor' : 'Enter vendor name', 'error');
      return;
    }
    if (formItems.length === 0) {
      toast(es ? 'Agrega al menos un artículo' : 'Add at least one item', 'error');
      return;
    }
    if (formItems.some((i) => !i.name.trim())) {
      toast(es ? 'Todos los artículos necesitan nombre' : 'All items need a name', 'error');
      return;
    }

    const shipping = form.shippingCost ?? 0;
    const { subtotal, total } = calcTotals(formItems, shipping);

    if (editPO) {
      const updated: PurchaseOrder = {
        ...editPO,
        ...form,
        items: formItems,
        subtotal,
        total,
        updatedAt: new Date().toISOString(),
      } as PurchaseOrder;
      // Round 20: read from ref to avoid stale-closure clobber on multi-station sync
      const nextPOs = purchaseOrdersRef.current.map((p) => p.id === editPO.id ? updated : p);
      purchaseOrdersRef.current = nextPOs;
      setPurchaseOrders(nextPOs);
      persist.purchaseOrder(updated.id, updated as unknown as Record<string, unknown>);
    } else {
      const newPO: PurchaseOrder = {
        id: generateId(),
        poNumber: form.poNumber || nextPONumber(),
        vendor: form.vendor!,
        vendorContact: form.vendorContact || '',
        status: 'draft',
        items: formItems,
        subtotal,
        shippingCost: shipping,
        total,
        notes: form.notes || '',
        expectedDate: form.expectedDate || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      // Round 20: read from ref so we don't drop concurrent POs from another station
      const nextPOs = [...purchaseOrdersRef.current, newPO];
      purchaseOrdersRef.current = nextPOs;
      setPurchaseOrders(nextPOs);
      persist.purchaseOrder(newPO.id, newPO as unknown as Record<string, unknown>);
    }

    toast(L.poSaved || 'Purchase order saved', 'success');
    setShowFormModal(false);
    setEditPO(null);
  // Round 20: purchaseOrders removed from deps because handler now reads from ref
  }, [form, formItems, editPO, setPurchaseOrders, calcTotals, nextPONumber, toast, L, es]);

  // ── Quick status actions ──────────────────────────────────

  const markOrdered = useCallback((po: PurchaseOrder) => {
    const updated = { ...po, status: 'ordered' as const, updatedAt: new Date().toISOString() };
    // Round 20: read from ref (anti stale-closure)
    const nextPOs = purchaseOrdersRef.current.map((p) => p.id === po.id ? updated : p);
    purchaseOrdersRef.current = nextPOs;
    setPurchaseOrders(nextPOs);
    persist.purchaseOrder(updated.id, updated as unknown as Record<string, unknown>);
    toast(es ? 'Marcado como Ordenado' : 'Marked as Ordered', 'success');
  }, [setPurchaseOrders, toast, es]);

  const markCancelled = useCallback(async (id: string) => {
    // Round 20: read from ref so we cancel against the latest state
    const po = purchaseOrdersRef.current.find((p) => p.id === id);
    if (!po) return;

    // Reverse inventory from partial receives (if any items were already received)
    const currentInventory = inventoryRef.current;
    const inventoryRollbacks: Array<{ collection: string; id: string; data: Record<string, unknown> }> = [];
    const updatedInvItems: InventoryItem[] = [];

    for (const item of po.items) {
      const received = item.qtyReceived ?? 0;
      if (received <= 0 || !item.inventoryId) continue;
      const invItem = currentInventory.find((inv) => inv.id === item.inventoryId);
      if (!invItem) continue;
      const rolledBack: InventoryItem = {
        ...invItem,
        qty: Math.max(0, invItem.qty - received),
        updatedAt: new Date().toISOString(),
      };
      updatedInvItems.push(rolledBack);
      inventoryRollbacks.push({
        collection: COLLECTIONS.inventory,
        id: rolledBack.id,
        data: rolledBack as unknown as Record<string, unknown>,
      });
    }

    // Reset all qtyReceived to 0 on the PO items
    const resetItems = po.items.map((item) => ({ ...item, qtyReceived: 0 }));
    const updated = { ...po, items: resetItems, status: 'cancelled' as const, updatedAt: new Date().toISOString() };

    // Persist PO + inventory rollbacks in one batch
    const allOps = [
      ...inventoryRollbacks,
      { collection: COLLECTIONS.purchaseOrders, id: updated.id, data: updated as unknown as Record<string, unknown> },
    ];
    await batchSave(allOps);

    // Update app state
    const nextPOs = purchaseOrdersRef.current.map((p) => p.id === id ? updated : p);
    purchaseOrdersRef.current = nextPOs;
    setPurchaseOrders(nextPOs);

    if (updatedInvItems.length > 0) {
      const nextInv = inventoryRef.current.map((inv) => {
        const found = updatedInvItems.find((u) => u.id === inv.id);
        return found ?? inv;
      });
      inventoryRef.current = nextInv;
      setInventory(nextInv);
    }

    setDeleteConfirm(null);
    toast(es ? 'Orden cancelada — inventario revertido' : 'Order cancelled — inventory reversed', 'info');
  }, [setPurchaseOrders, setInventory, toast, es]);

  // ── Inventory picker search ───────────────────────────────

  const invResults = useMemo(() => {
    if (!invSearch.trim()) return [];
    return inventory
      .filter((i) => matchesSearch(invSearch, i.name, i.sku, i.barcode))
      .slice(0, 8);
  }, [inventory, invSearch]);

  // ── Form computed ─────────────────────────────────────────

  const formSubtotal = useMemo(
    () => formItems.reduce((sum, i) => sum + (i.cost || 0) * (i.qtyOrdered || 0), 0),
    [formItems],
  );
  const formTotal = formSubtotal + (form.shippingCost ?? 0);

  const translateStatus = (s: string) => {
    const map: Record<string, string> = {
      All: L.all || 'All',
      draft: L.poStatusDraft || 'Draft',
      ordered: L.poStatusOrdered || 'Ordered',
      partial: L.poStatusPartial || 'Partial',
      received: L.poStatusReceived || 'Received',
      cancelled: L.poStatusCancelled || 'Cancelled',
    };
    return map[s] ?? s;
  };

  // ─────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">
            🛒 {L.purchaseOrders || 'Purchase Orders'}
          </h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {es
              ? 'Gestiona órdenes de compra a proveedores y recepción de mercancía'
              : 'Manage vendor purchase orders and merchandise receiving'}
          </p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>
          + {L.newPurchaseOrder || 'New Purchase Order'}
        </button>
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label={L.totalPOs || 'Total POs'}
          value={String(stats.total)}
          icon="📋"
        />
        <StatCard
          label={L.openPOs || 'Open POs'}
          value={String(stats.open)}
          icon="⏳"
          highlight={stats.open > 0}
        />
        <StatCard
          label={es ? 'Pendiente de Pago' : 'Pending Cost'}
          value={formatCurrency(stats.pendingCost)}
          icon="💸"
        />
        <StatCard
          label={L.totalSpend || 'Total Spend'}
          value={formatCurrency(stats.totalSpend)}
          icon="📊"
        />
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex-1 min-w-[200px]">
          {/* r-global-search: synced mode — local `search` still drives filtered list.
              No excludeCollection: PurchaseOrders is not in the 8 searchable collections,
              so the dropdown shows all 8 (nothing to exclude). */}
          <GlobalSearchBar
            localValue={search}
            onLocalChange={setSearch}
            placeholder={es ? 'Buscar proveedor, # orden…' : 'Search vendor, PO number…'}
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`btn btn-sm ${filterStatus === s ? 'btn-primary' : 'btn-secondary'}`}
            >
              {translateStatus(s)}
            </button>
          ))}
        </div>
      </div>

      {/* ── PO List ── */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <div className="text-5xl mb-4">🛒</div>
          <div className="text-lg font-medium">
            {es ? 'No hay órdenes de compra' : 'No purchase orders yet'}
          </div>
          <div className="text-sm mt-1">
            {es ? 'Crea tu primera PO con el botón de arriba' : 'Create your first PO using the button above'}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((po) => (
            <div
              key={po.id}
              ref={isHighlighted(po.id) ? highlightRef : null}
              style={{
                outline: isHighlighted(po.id) ? '2px solid #667eea' : 'none',
                outlineOffset: '4px',
                borderRadius: '0.75rem',
                transition: 'outline 0.2s',
              }}
            >
              <POCard
                po={po}
                lang={lang}
                L={L}
                onEdit={() => openEdit(po)}
                onReceive={() => openReceive(po)}
                onMarkOrdered={() => markOrdered(po)}
                onCancel={() => setDeleteConfirm(po.id)}
                translateStatus={translateStatus}
              />
            </div>
          ))}
        </div>
      )}

      {/* ── Cancel Confirm Dialog ── */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="modal-content max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-2">
              ⚠️ {es ? 'Cancelar Orden' : 'Cancel Order'}
            </h3>
            <p className="text-slate-300 text-sm mb-4">
              {es
                ? '¿Estás seguro? Esta acción no se puede deshacer.'
                : 'Are you sure? This action cannot be undone.'}
            </p>
            <div className="flex gap-3 justify-end">
              <button className="btn btn-secondary" onClick={() => setDeleteConfirm(null)}>
                {L.cancel}
              </button>
              <button className="btn btn-danger" onClick={() => markCancelled(deleteConfirm)}>
                {L.markCancelled || 'Cancel Order'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Receive Modal ── */}
      {showReceiveModal && receivePO && (
        <POReceiveModal
          po={receivePO}
          onClose={() => { setShowReceiveModal(false); setReceivePO(null); }}
          onSave={(updated) => { setShowReceiveModal(false); setReceivePO(null); }}
        />
      )}

      {/* ── Form Modal ── */}
      {showFormModal && (
        <Modal
          open={showFormModal}
          title={editPO
            ? `✏️ ${es ? 'Editar' : 'Edit'} ${editPO.poNumber}`
            : `+ ${L.newPurchaseOrder || 'New Purchase Order'}`}
          onClose={() => { setShowFormModal(false); setEditPO(null); }}
          size="max-w-lg"
        >
          <div className="space-y-5">

            {/* Header fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="label">{L.poNumber || 'PO Number'}</label>
                <input
                  className="input"
                  value={form.poNumber || ''}
                  onChange={(e) => setForm((f) => ({ ...f, poNumber: e.target.value }))}
                  placeholder="PO-2026-0001"
                />
              </div>
              <div>
                <label className="label">{L.vendor || 'Vendor'} *</label>
                <input
                  className="input"
                  value={form.vendor || ''}
                  onChange={(e) => setForm((f) => ({ ...f, vendor: e.target.value }))}
                  placeholder={es ? 'Nombre del proveedor' : 'Vendor name'}
                />
              </div>
              <div>
                <label className="label">{L.vendorContact || 'Vendor Contact'}</label>
                <input
                  className="input"
                  value={form.vendorContact || ''}
                  onChange={(e) => setForm((f) => ({ ...f, vendorContact: e.target.value }))}
                  placeholder={es ? 'Teléfono o email' : 'Phone or email'}
                />
              </div>
              <div>
                <label className="label">{L.expectedDate || 'Expected Date'}</label>
                <input
                  className="input"
                  type="date"
                  value={form.expectedDate || ''}
                  onChange={(e) => setForm((f) => ({ ...f, expectedDate: e.target.value }))}
                />
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="label">{L.notes || 'Notes'}</label>
              <textarea
                className="input"
                rows={2}
                value={form.notes || ''}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder={es ? 'Notas adicionales…' : 'Additional notes…'}
              />
            </div>

            {/* Line items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="label mb-0">{es ? 'Artículos' : 'Items'}</label>
                <button className="btn btn-sm btn-secondary" onClick={addLineItem}>
                  + {L.addLineItem || 'Add Item'}
                </button>
              </div>

              {formItems.length === 0 && (
                <div className="text-center py-6 text-slate-500 text-sm glass-card">
                  {es ? 'Sin artículos — agrega uno arriba' : 'No items — add one above'}
                </div>
              )}

              <div className="space-y-2">
                {formItems.map((item) => (
                  <div key={item.id} className="glass-card p-3 space-y-2">
                    <div className="flex gap-2 items-start">
                      {/* Name */}
                      <div className="flex-1">
                        <input
                          className="input text-sm"
                          placeholder={es ? 'Nombre del artículo *' : 'Item name *'}
                          value={item.name}
                          onChange={(e) => updateLineItem(item.id, 'name', e.target.value)}
                        />
                      </div>
                      {/* SKU */}
                      <div className="w-28">
                        <input
                          className="input text-sm"
                          placeholder="SKU"
                          value={item.sku || ''}
                          onChange={(e) => updateLineItem(item.id, 'sku', e.target.value)}
                        />
                      </div>
                      {/* Remove */}
                      <button
                        className="btn btn-sm btn-danger mt-0.5"
                        onClick={() => removeLineItem(item.id)}
                        title={L.delete}
                      >
                        ✕
                      </button>
                    </div>

                    <div className="flex gap-2 items-center flex-wrap">
                      {/* Cost */}
                      <div className="flex items-center gap-1">
                        <span className="text-slate-400 text-xs">{es ? 'Costo $' : 'Cost $'}</span>
                        <input
                          className="input text-sm w-24"
                          type="number"
                          min={0}
                          step={0.01}
                          placeholder="0.00"
                          value={(item.cost / 100).toFixed(2)}
                          onChange={(e) =>
                            updateLineItem(item.id, 'cost', Math.round(parseFloat(e.target.value || '0') * 100))
                          }
                        />
                      </div>
                      {/* Qty */}
                      <div className="flex items-center gap-1">
                        <span className="text-slate-400 text-xs">{L.qtyOrdered || 'Qty'}</span>
                        <input
                          className="input text-sm w-16 text-center"
                          type="number"
                          min={1}
                          value={item.qtyOrdered}
                          onChange={(e) =>
                            updateLineItem(item.id, 'qtyOrdered', Math.max(1, parseInt(e.target.value, 10) || 1))
                          }
                        />
                      </div>
                      {/* Line total */}
                      <div className="text-slate-300 text-xs ml-auto">
                        = {formatCurrency(item.cost * item.qtyOrdered)}
                      </div>

                      {/* Link to inventory */}
                      <div className="relative">
                        {item.inventoryId ? (
                          <span className="text-xs text-emerald-400 flex items-center gap-1">
                            🔗 {es ? 'Vinculado' : 'Linked'}
                            <button
                              className="text-slate-400 hover:text-red-400 ml-1"
                              onClick={() => updateLineItem(item.id, 'inventoryId', '')}
                              title={es ? 'Desvincular' : 'Unlink'}
                            >
                              ✕
                            </button>
                          </span>
                        ) : (
                          <button
                            className="btn btn-sm btn-ghost text-xs"
                            onClick={() => {
                              setShowInvPicker(item.id);
                              setInvSearch('');
                            }}
                          >
                            🔗 {L.linkToInventory || 'Link Inventory'}
                          </button>
                        )}

                        {/* Inventory picker dropdown */}
                        {showInvPicker === item.id && (
                          <div className="absolute z-50 top-8 left-0 w-72 glass-card p-2 space-y-1 shadow-xl">
                            <input
                              autoFocus
                              className="input text-sm"
                              placeholder={es ? 'Buscar en inventario…' : 'Search inventory…'}
                              value={invSearch}
                              onChange={(e) => setInvSearch(e.target.value)}
                            />
                            {invResults.length === 0 && invSearch.length > 1 && (
                              <div className="text-slate-400 text-xs text-center py-2">
                                {es ? 'Sin resultados' : 'No results'}
                              </div>
                            )}
                            {invResults.map((inv) => (
                              <button
                                key={inv.id}
                                className="w-full text-left px-2 py-1.5 rounded hover:bg-white/10 text-sm text-white"
                                onClick={() => linkInventoryItem(item.id, inv)}
                              >
                                <span className="font-medium">{inv.name}</span>
                                {inv.sku && (
                                  <span className="text-slate-400 text-xs ml-2">{inv.sku}</span>
                                )}
                                <span className="text-slate-400 text-xs ml-2">
                                  ({es ? 'Stock' : 'Qty'}: {inv.qty})
                                </span>
                              </button>
                            ))}
                            <button
                              className="btn btn-sm btn-ghost w-full text-xs mt-1"
                              onClick={() => { setShowInvPicker(null); setInvSearch(''); }}
                            >
                              {L.cancel}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Shipping + totals */}
            {formItems.length > 0 && (
              <div className="glass-card p-3 space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">{es ? 'Subtotal' : 'Subtotal'}</span>
                  <span className="text-white">{formatCurrency(formSubtotal)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-400">{L.shippingCost || 'Shipping'}</span>
                  <input
                    className="input text-sm w-28 text-right"
                    type="number"
                    min={0}
                    step={0.01}
                    placeholder="0.00"
                    value={((form.shippingCost ?? 0) / 100).toFixed(2)}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, shippingCost: Math.round(parseFloat(e.target.value || '0') * 100) }))
                    }
                  />
                </div>
                <div className="flex items-center justify-between border-t border-white/10 pt-2 font-semibold">
                  <span className="text-white">Total</span>
                  <span className="text-emerald-400 text-lg">{formatCurrency(formTotal)}</span>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 justify-end pt-2">
              <button
                className="btn btn-secondary"
                onClick={() => { setShowFormModal(false); setEditPO(null); }}
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

// ── Sub-components ─────────────────────────────────────────

interface POCardProps {
  po: PurchaseOrder;
  lang: string;
  L: Record<string, string>;
  onEdit: () => void;
  onReceive: () => void;
  onMarkOrdered: () => void;
  onCancel: () => void;
  translateStatus: (s: string) => string;
}

function POCard({ po, lang, L, onEdit, onReceive, onMarkOrdered, onCancel, translateStatus }: POCardProps) {
  const es = lang === 'es';
  const isClosed = ['received', 'cancelled'].includes(po.status);
  const canReceive = ['ordered', 'partial'].includes(po.status);
  const canMarkOrdered = po.status === 'draft';

  const totalItems = po.items.reduce((s, i) => s + i.qtyOrdered, 0);
  const receivedItems = po.items.reduce((s, i) => s + i.qtyReceived, 0);
  const progress = totalItems > 0 ? (receivedItems / totalItems) * 100 : 0;

  return (
    <div className="glass-card p-4 hover:bg-white/10 transition-colors">
      <div className="flex items-start justify-between gap-4">

        {/* Left — info */}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-white">{po.poNumber}</span>
            <span className={`badge ${statusBadge(po.status)}`}>
              {translateStatus(po.status)}
            </span>
            {po.expectedDate && (
              <span className="text-xs text-slate-400">
                📅 {new Date(po.expectedDate).toLocaleDateString()}
              </span>
            )}
          </div>
          <div className="text-slate-300 font-medium">🏢 {po.vendor}</div>
          {po.vendorContact && (
            <div className="text-slate-400 text-xs">{po.vendorContact}</div>
          )}
          <div className="text-xs text-slate-400">
            {po.items.length} {po.items.length === 1 ? (es ? 'artículo' : 'item') : (es ? 'artículos' : 'items')}
            {' · '}
            {es ? 'Creado' : 'Created'}: {new Date(po.createdAt as string).toLocaleDateString()}
          </div>
          {po.notes && (
            <div className="text-xs text-slate-400 italic truncate">"{po.notes}"</div>
          )}

          {/* Progress bar for partial */}
          {(po.status === 'partial' || po.status === 'ordered') && totalItems > 0 && (
            <div className="mt-2">
              <div className="flex justify-between text-xs text-slate-400 mb-1">
                <span>{es ? 'Recibido' : 'Received'}: {receivedItems}/{totalItems}</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Right — totals + actions */}
        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className="text-right">
            <div className="text-emerald-400 font-bold text-lg">{formatCurrency(po.total)}</div>
            {po.shippingCost > 0 && (
              <div className="text-xs text-slate-400">
                {es ? 'Envío' : 'Shipping'}: {formatCurrency(po.shippingCost)}
              </div>
            )}
          </div>

          <div className="flex gap-2 flex-wrap justify-end">
            {canMarkOrdered && (
              <button className="btn btn-sm btn-info" onClick={onMarkOrdered}>
                📦 {L.markOrdered || 'Mark Ordered'}
              </button>
            )}
            {canReceive && (
              <button className="btn btn-sm btn-success" onClick={onReceive}>
                🚚 {L.receiveItems || 'Receive'}
              </button>
            )}
            {!isClosed && (
              <button className="btn btn-sm btn-secondary" onClick={onEdit}>
                ✏️
              </button>
            )}
            {!isClosed && (
              <button className="btn btn-sm btn-danger" onClick={onCancel} title={L.markCancelled}>
                ✕
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Item summary (collapsed) */}
      <div className="mt-3 pt-3 border-t border-white/10 grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
        {po.items.slice(0, 6).map((item) => (
          <div key={item.id} className="flex justify-between text-xs text-slate-400">
            <span className="truncate mr-2">{item.name}</span>
            <span className="shrink-0">
              {item.qtyReceived}/{item.qtyOrdered}
              {item.inventoryId && ' 🔗'}
            </span>
          </div>
        ))}
        {po.items.length > 6 && (
          <div className="text-xs text-slate-500 col-span-full">
            +{po.items.length - 6} {es ? 'más…' : 'more…'}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label, value, icon, highlight,
}: {
  label: string; value: string; icon: string; highlight?: boolean;
}) {
  return (
    <div className={`stat-card ${highlight ? 'border border-amber-500/30' : ''}`}>
      <div className="text-2xl mb-1">{icon}</div>
      <div className={`text-xl font-bold ${highlight ? 'text-amber-400' : 'text-white'}`}>
        {value}
      </div>
      <div className="text-slate-400 text-xs mt-0.5">{label}</div>
    </div>
  );
}
