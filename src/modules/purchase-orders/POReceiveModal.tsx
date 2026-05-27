// ============================================================
// CellHub Pro — PO Receive Modal
// Receives merchandise for a Purchase Order line by line.
// Auto-updates linked inventory items qty on save.
// ============================================================

import { useState, useCallback, useEffect, useRef } from 'react';
import { useApp } from '@/store/AppProvider';
import { Modal } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { useTranslation } from '@/i18n';
import { formatCurrency } from '@/utils/currency';
import { canViewOwnerFinancials } from '@/utils/financialPrivacy';
import { persist, batchSave } from '@/services/persist';
import { COLLECTIONS } from '@/config/constants';
import { generateId } from '@/utils/dates';
import type { PurchaseOrder, POItem, InventoryItem } from '@/store/types';

interface Props {
  po: PurchaseOrder;
  onClose: () => void;
  onSave: (updated: PurchaseOrder) => void;
}

export default function POReceiveModal({ po, onClose, onSave }: Props) {
  const {
    state: { inventory, settings, isAdminMode, currentEmployee },
    setInventory,
    setPurchaseOrders,
    state,
  } = useApp();
  // R-FINANCIAL-PRIVACY-V3: hide supplier cost label in the receiving modal
  // when the viewer cannot see owner financials. Employees still receive
  // inventory, see ordered qty, mark received qty, etc.
  const canSeeOwnerFinancials = canViewOwnerFinancials(
    settings,
    isAdminMode || currentEmployee?.role === 'owner',
  );

  const { toast } = useToast();
  const { t } = useTranslation();

  // Round 20: anti-stale-closure refs. handleConfirm mutates both inventory AND
  // purchaseOrders, and creates new inventory items per phone IMEI. Without refs,
  // a concurrent receive from station B (different PO) gets clobbered when station
  // A's setInventory call replaces the array with A's stale snapshot. Refs read the
  // latest state pushed by the Firestore listener.
  const inventoryRef      = useRef(inventory);
  const purchaseOrdersRef = useRef(state.purchaseOrders);
  useEffect(() => { inventoryRef.current = inventory; }, [inventory]);
  useEffect(() => { purchaseOrdersRef.current = state.purchaseOrders; }, [state.purchaseOrders]);

  // Local receive quantities — keyed by POItem.id
  const [receiveQtys, setReceiveQtys] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const item of po.items) {
      init[item.id] = Math.max(0, item.qtyOrdered - item.qtyReceived);
    }
    return init;
  });

  // ── IMEI capture per phone POItem ──────────────────────────────
  // Keyed by POItem.id → array of IMEI strings (one slot per pending unit).
  // Only used when the linked inventory item has category === 'phone'.
  const [receiveImeis, setReceiveImeis] = useState<Record<string, string[]>>(() => {
    const init: Record<string, string[]> = {};
    for (const item of po.items) {
      const pend = Math.max(0, item.qtyOrdered - item.qtyReceived);
      init[item.id] = Array.from({ length: pend }, () => '');
    }
    return init;
  });

  const [saving, setSaving] = useState(false);

  // Helper: get linked inventory item for a POItem (or undefined)
  const getInv = useCallback(
    (item: POItem): InventoryItem | undefined =>
      item.inventoryId ? inventory.find((inv) => inv.id === item.inventoryId) : undefined,
    [inventory],
  );

  // Helper: is this POItem a phone (requires per-unit IMEI capture)?
  const isPhonePO = useCallback(
    (item: POItem): boolean => {
      const inv = getInv(item);
      return inv?.category === 'phone';
    },
    [getInv],
  );

  const pending = (item: POItem) => item.qtyOrdered - item.qtyReceived;
  const hasAnythingToReceive = po.items.some((i) => pending(i) > 0);

  const handleQtyChange = useCallback(
    (itemId: string, raw: string) => {
      const item = po.items.find((i) => i.id === itemId);
      if (!item) return;
      const max = pending(item);
      const val = Math.min(max, Math.max(0, parseInt(raw, 10) || 0));
      setReceiveQtys((prev) => ({ ...prev, [itemId]: val }));
      // Resize IMEI slots to match new qty (preserve existing entries)
      setReceiveImeis((prev) => {
        const existing = prev[itemId] ?? [];
        const next = Array.from({ length: val }, (_, i) => existing[i] ?? '');
        return { ...prev, [itemId]: next };
      });
    },
    [po.items],
  );

  const handleImeiChange = useCallback((itemId: string, idx: number, value: string) => {
    setReceiveImeis((prev) => {
      const arr = [...(prev[itemId] ?? [])];
      arr[idx] = value;
      return { ...prev, [itemId]: arr };
    });
  }, []);

  const handleConfirm = useCallback(async () => {
    setSaving(true);
    try {
      // ── Pre-flight validation: phones need an IMEI for every unit ────
      // Also: no duplicate IMEIs in the form, and no collision with existing inventory.
      const normImei = (s: string) => (s || '').replace(/\s+/g, '').trim();
      const allFormImeis: string[] = [];
      for (const item of po.items) {
        const incoming = receiveQtys[item.id] ?? 0;
        if (incoming <= 0) continue;
        if (!isPhonePO(item)) continue;

        const imeis = (receiveImeis[item.id] ?? []).slice(0, incoming).map(normImei);
        if (imeis.some((s) => !s)) {
          toast(t('po.errMissingImei', item.name), 'error');
          setSaving(false);
          return;
        }
        for (const imei of imeis) {
          if (!/^\d{15}$/.test(imei)) {
            toast(t('po.errInvalidImei', imei), 'error');
            setSaving(false);
            return;
          }
          if (allFormImeis.includes(imei)) {
            toast(t('po.errDuplicateImei', imei), 'error');
            setSaving(false);
            return;
          }
          if (inventory.some((inv) => normImei(inv.imei || '') === imei)) {
            toast(t('po.errExistsImei', imei), 'error');
            setSaving(false);
            return;
          }
          allFormImeis.push(imei);
        }
      }

      // ── Build updated PO items ──────────────────────────
      const updatedItems: POItem[] = po.items.map((item) => {
        const incoming = receiveQtys[item.id] ?? 0;
        return {
          ...item,
          qtyReceived: item.qtyReceived + incoming,
        };
      });

      // ── Determine new PO status ─────────────────────────
      const allReceived = updatedItems.every((i) => i.qtyReceived >= i.qtyOrdered);
      const anyReceived = updatedItems.some((i) => i.qtyReceived > 0);
      const newStatus: PurchaseOrder['status'] = allReceived
        ? 'received'
        : anyReceived
          ? 'partial'
          : po.status;

      const updatedPO: PurchaseOrder = {
        ...po,
        items: updatedItems,
        status: newStatus,
        receivedAt: allReceived ? new Date().toISOString() : po.receivedAt,
        updatedAt: new Date().toISOString(),
      };

      // ── Update linked inventory items ───────────────────
      // Phones: create N new InventoryItems (one per IMEI), do NOT bump master qty.
      // Non-phones: bump qty on the linked master (existing behavior).
      // Round 20: read from inventoryRef.current so we see any items pushed by the
      // Firestore listener since mount (other stations may have created/updated items).
      const currentInventory = inventoryRef.current;
      const inventoryUpdates: InventoryItem[] = []; // updated existing items
      const inventoryCreates: InventoryItem[] = []; // brand-new items (per-IMEI phones)
      const persistOps: Array<{ collection: string; id: string; data: Record<string, unknown> }> = [];

      for (const item of po.items) {
        const incoming = receiveQtys[item.id] ?? 0;
        if (incoming <= 0 || !item.inventoryId) continue;

        const invItem = currentInventory.find((inv) => inv.id === item.inventoryId);
        if (!invItem) continue;

        if (isPhonePO(item)) {
          // NOTE: For phones, we create N child items (one per IMEI) and leave the
          // "master" inventory item untouched. The master acts as a template/SKU registry.
          // This is intentional — each physical phone is its own inventory record.
          // Per-IMEI: clone master, qty 1, unique IMEI per unit
          const imeis = (receiveImeis[item.id] ?? []).slice(0, incoming).map((s) => (s || '').replace(/\s+/g, '').trim());
          for (const imei of imeis) {
            const newPhone: InventoryItem = {
              ...invItem,
              id: generateId(),
              imei,
              qty: 1,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            inventoryCreates.push(newPhone);
            persistOps.push({
              collection: COLLECTIONS.inventory,
              id: newPhone.id,
              data: newPhone as unknown as Record<string, unknown>,
            });
          }
        } else {
          // Non-phone: bump qty on master and update cost to latest PO cost (COGS accuracy)
          const updatedInv: InventoryItem = {
            ...invItem,
            qty: invItem.qty + incoming,
            cost: item.cost ?? invItem.cost,
            updatedAt: new Date().toISOString(),
          };
          inventoryUpdates.push(updatedInv);
          persistOps.push({
            collection: COLLECTIONS.inventory,
            id: updatedInv.id,
            data: updatedInv as unknown as Record<string, unknown>,
          });
        }
      }

      // ── Save PO ─────────────────────────────────────────
      persistOps.push({
        collection: COLLECTIONS.purchaseOrders,
        id: updatedPO.id,
        data: updatedPO as unknown as Record<string, unknown>,
      });

      await batchSave(persistOps);

      // ── Update app state ────────────────────────────────
      // Round 20: read from refs so concurrent inventory items (created by another
      // station between mount and click) are preserved through the merge. Old code
      // mapped over the closure `inventory` and dropped any items added since mount.
      if (inventoryUpdates.length > 0 || inventoryCreates.length > 0) {
        const merged = inventoryRef.current.map((inv) => {
          const found = inventoryUpdates.find((u) => u.id === inv.id);
          return found ?? inv;
        });
        const nextInventory = [...merged, ...inventoryCreates];
        inventoryRef.current = nextInventory;
        setInventory(nextInventory);
      }

      const nextPOs = purchaseOrdersRef.current.map((p) => (p.id === po.id ? updatedPO : p));
      purchaseOrdersRef.current = nextPOs;
      setPurchaseOrders(nextPOs);

      toast(t('po.itemsReceived'), 'success');
      onSave(updatedPO);
    } catch (err) {
      console.error('[POReceiveModal]', err);
      toast('Error saving — try again', 'error');
    } finally {
      setSaving(false);
    }
  // Round 20: inventory and state.purchaseOrders removed from deps because the
  // handler now reads from refs (anti stale-closure pattern).
  }, [po, receiveQtys, receiveImeis, setInventory, setPurchaseOrders, toast, t, onSave, isPhonePO]);

  return (
    <Modal
      open
      title={`🚚 ${t('po.receiveModal')} — ${po.poNumber}`}
      onClose={onClose}
      size="max-w-md"
    >
      <div className="space-y-4">

        {/* Vendor info */}
        <div className="glass-card p-3 text-sm flex items-center gap-3">
          <span className="text-2xl">🏢</span>
          <div>
            <div className="font-semibold text-white">{po.vendor}</div>
            {po.vendorContact && (
              <div className="text-slate-400">{po.vendorContact}</div>
            )}
          </div>
          <div className="ml-auto">
            <span className={`badge ${statusBadge(po.status)}`}>
              {translateStatus(po.status, t)}
            </span>
          </div>
        </div>

        {/* Item list */}
        <div className="space-y-2">
          {po.items.map((item) => {
            const pend = pending(item);
            const isFullyReceived = pend <= 0;

            return (
              <div
                key={item.id}
                className={`glass-card p-3 ${isFullyReceived ? 'opacity-50' : ''}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-white truncate">{item.name}</div>
                    {item.sku && (
                      <div className="text-xs text-slate-400">SKU: {item.sku}</div>
                    )}
                    <div className="text-xs text-slate-400 mt-1">
                      {/* R-FINANCIAL-PRIVACY-V3: supplier cost owner-only. */}
                      {canSeeOwnerFinancials && (
                        <>{t('po.costLabel')}: {formatCurrency(item.cost)} </>
                      )}
                      {item.inventoryId && (
                        <span className="ml-2 text-emerald-400">
                          🔗 {t('po.linked')}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Qty columns */}
                  <div className="flex items-center gap-3 text-center text-xs">
                    <div>
                      <div className="text-slate-400">{t('po.qtyOrdered')}</div>
                      <div className="text-white font-semibold">{item.qtyOrdered}</div>
                    </div>
                    <div>
                      <div className="text-slate-400">{t('po.qtyReceived')}</div>
                      <div className="text-emerald-400 font-semibold">{item.qtyReceived}</div>
                    </div>
                    <div>
                      <div className="text-slate-400">{t('po.qtyPending')}</div>
                      <div className={`font-semibold ${pend > 0 ? 'text-amber-400' : 'text-slate-500'}`}>
                        {pend}
                      </div>
                    </div>

                    {/* Receive input */}
                    <div>
                      <div className="text-slate-400">{t('po.receive')}</div>
                      {isFullyReceived ? (
                        <div className="text-emerald-500 text-lg">✓</div>
                      ) : (
                        <input
                          type="number"
                          min={0}
                          max={pend}
                          value={receiveQtys[item.id] ?? 0}
                          onChange={(e) => handleQtyChange(item.id, e.target.value)}
                          className="input w-16 text-center py-1 text-sm"
                        />
                      )}
                    </div>
                  </div>
                </div>

                {/* ── Per-unit IMEI inputs (phones only) ── */}
                {!isFullyReceived && isPhonePO(item) && (receiveQtys[item.id] ?? 0) > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-700/50 space-y-2">
                    <div className="text-xs text-slate-400 font-medium">
                      📱 {t('po.imeiInstruction')}
                    </div>
                    {Array.from({ length: receiveQtys[item.id] ?? 0 }).map((_, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span className="text-xs text-slate-500 w-6 text-right">#{idx + 1}</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={15}
                          placeholder={t('po.imeiPlaceholder')}
                          value={(receiveImeis[item.id] ?? [])[idx] ?? ''}
                          onChange={(e) => handleImeiChange(item.id, idx, e.target.value)}
                          className="input flex-1 py-1 text-sm font-mono"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* No items pending */}
        {!hasAnythingToReceive && (
          <div className="text-center text-slate-400 py-4 text-sm">
            ✅ {t('po.allReceived')}
          </div>
        )}

        {/* Summary of what's about to happen */}
        {hasAnythingToReceive && (
          <div className="glass-card p-3 text-sm space-y-1">
            <div className="text-slate-300 font-medium mb-2">
              {t('po.receivingSummary')}
            </div>
            {po.items.map((item) => {
              const qty = receiveQtys[item.id] ?? 0;
              if (qty <= 0) return null;
              return (
                <div key={item.id} className="flex justify-between text-slate-300">
                  <span>{item.name}</span>
                  <span className="text-emerald-400">+{qty} {t('po.units')}</span>
                </div>
              );
            })}
            {po.items.every((i) => (receiveQtys[i.id] ?? 0) === 0) && (
              <div className="text-amber-400 text-xs">
                {t('po.enterQty')}
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 justify-end pt-2">
          <button className="btn btn-secondary" onClick={onClose}>
            {t('cancel')}
          </button>
          <button
            className="btn btn-success"
            onClick={handleConfirm}
            disabled={
              saving ||
              !hasAnythingToReceive ||
              po.items.every((i) => (receiveQtys[i.id] ?? 0) === 0)
            }
          >
            {saving
              ? t('po.saving')
              : `✅ ${t('po.updateInventory')}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Helpers ───────────────────────────────────────────────

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

function translateStatus(status: string, t: (key: string) => string): string {
  const map: Record<string, string> = {
    draft: t('po.statusDraft'),
    ordered: t('po.statusOrdered'),
    partial: t('po.statusPartial'),
    received: t('po.statusReceived'),
    cancelled: t('po.statusCancelled'),
  };
  return map[status] ?? status;
}
