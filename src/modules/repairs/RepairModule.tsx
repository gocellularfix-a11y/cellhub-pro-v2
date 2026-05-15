// ============================================================
// CellHub Pro — Repair Module
// ============================================================

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useApp } from '@/store/AppProvider';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/ui';
import { useTranslation } from '@/i18n';
import { STATUS_LABELS } from '@/i18n/statusMap';
import { formatCurrency } from '@/utils/currency';
import { reverseTaxFromPayment, forwardTaxFromBase } from '@/utils/depositTax';
import { matchesSearchPhones } from '@/utils/search';
import { normalizePhone } from '@/utils/normalize';
import { generateId } from '@/utils/dates';
import { emitRepairCompleted } from '@/services/intelligence/liveContext/liveContextEvents';
import { persist, persistSettings, remove } from '@/services/persist';
import { REPAIR_STATUS, normalizeRepairStatus, orderedRepairStatusOptions, isDoneRepairStatus } from '@/utils/repairStatus';
import DepositModal from '@/components/DepositModal';
// R-COMMS-SMS-HARD-DISABLE: sendSms import removed.
import { openWhatsApp, buildWaMessage } from '@/services/whatsapp';
import TicketListLayout from '@/components/shared/TicketListLayout';
import TicketCard from '@/components/shared/TicketCard';
import GlobalSearchBar from '@/components/shared/GlobalSearchBar';
import { useHighlightRecord } from '@/hooks/useHighlightRecord';
import { usePrint } from '@/hooks/usePrint';
import RepairModal, { type RepairAuditMeta } from './RepairModal';
import CancelRepairModal from './CancelRepairModal';
import EditHistoryModal from '@/components/EditHistoryModal';
import { Modal } from '@/components/ui';
import type { Repair, CartItem, Customer, Sale, EditAuditEntry } from '@/store/types';
import {
  appendEditEntry, captureSnapshot, checkEditHistoryStatus,
} from '@/services/editAudit';
import { useApprovalGate } from '@/hooks/useApprovalGate';

// Round R1 F1: full HTML escape (defense-in-depth,
// matches ReportsModule canonical pattern).
function escHtml(s: unknown): string {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Round R2: canonical snake_case statuses + friendly "All" filter pseudo-value.
const STATUSES = ['All', ...orderedRepairStatusOptions];

const STATUS_BADGE: Record<string, string> = {
  [REPAIR_STATUS.RECEIVED]:      'badge-info',
  [REPAIR_STATUS.IN_PROGRESS]:   'badge-warning',
  [REPAIR_STATUS.WAITING_PARTS]: 'badge-warning',
  [REPAIR_STATUS.READY]:         'badge-success',
  [REPAIR_STATUS.PICKED_UP]:     'badge-success',
  [REPAIR_STATUS.CANCELLED]:     'badge-danger',
};

export default function RepairModule() {
  const {
    state: { repairs, customers, inventory, settings, employees, currentEmployee, cart, sales, lang, globalSearchTerm, currentStoreId },
    setRepairs, setCustomers, setCart, setSales, dispatch,
  } = useApp();

  const { toast } = useToast();
  const { t } = useTranslation();
  const { highlightRef, isHighlighted } = useHighlightRecord();
  const { printHtml } = usePrint();
  const approvalGate = useApprovalGate({ employees, settings, attemptedByName: currentEmployee?.name });

  const [search, setSearch] = useState(globalSearchTerm || '');
  const [filterStatus, setFilterStatus] = useState('All');
  const [visibleCount, setVisibleCount] = useState(50);
  const [showModal, setShowModal] = useState(false);
  const [editRepair, setEditRepair] = useState<Repair | null>(null);
  const [depositModalRepair, setDepositModalRepair] = useState<Repair | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Repair | null>(null);
  const [isConsolidating, setIsConsolidating] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<Repair | null>(null);
  const [completeConfirm, setCompleteConfirm] = useState<Repair | null>(null);
  // R-EDIT-AUDIT F3.9-11: edit-history viewer, print-choice dialog, mark-refunded confirm.
  const [historyTarget, setHistoryTarget] = useState<Repair | null>(null);
  const [printChoiceTarget, setPrintChoiceTarget] = useState<Repair | null>(null);
  const [refundConfirmTarget, setRefundConfirmTarget] = useState<Repair | null>(null);

  // ── Stale-closure guard: ref-based mirror of repairs so back-to-back
  // setRepairs calls (modal save + collectBalance) don't pisarse mutually.
  const repairsRef = useRef(repairs);
  useEffect(() => { repairsRef.current = repairs; }, [repairs]);

  // R-INTELLIGENCE-RUNTIME-NAVIGATION-V1: open a specific repair ticket from
  // Intelligence action buttons. AppShell navigates here first, then defers
  // 80ms before firing this event so this listener is attached.
  useEffect(() => {
    const handler = (e: Event) => {
      const { repairId } = (e as CustomEvent<{ repairId?: string }>).detail ?? {};
      if (!repairId) return;
      const repair = repairsRef.current.find((r) => r.id === repairId);
      if (!repair) { console.warn('[cellhub] _intel-open-repair: not found', repairId); return; }
      setEditRepair(repair);
      setShowModal(true);
    };
    window.addEventListener('cellhub:_intel-open-repair', handler);
    return () => window.removeEventListener('cellhub:_intel-open-repair', handler);
  }, []);

  // Round R2 + R2.1: one-time delta sweep to canonical repair statuses.
  // Persists the FULL repair record because persist.ts localSaveRecord
  // overwrites non-settings collections (only settings gets a merge per
  // the r26 BLOCKER fix). Firestore merge:true makes this idempotent
  // on the cloud side. Flag in settings prevents re-run across mounts.
  const hasRunSweepRef = useRef(false);
  useEffect(() => {
    if (hasRunSweepRef.current) return;
    // Wait until settings has loaded (at least one key) before checking flag.
    if (!settings || Object.keys(settings).length === 0) return;
    hasRunSweepRef.current = true;

    const sweepDone = (settings as unknown as { repairStatusSweepDone?: boolean }).repairStatusSweepDone;
    if (sweepDone) return;

    const current = repairsRef.current;
    let changed = 0;
    const next = current.map((r) => {
      const normalized = normalizeRepairStatus(r.status);
      if (normalized && normalized !== r.status) {
        changed += 1;
        const nowIso = new Date().toISOString();
        // Round R2.1: pass full repair record — localSaveRecord in
        // persist.ts OVERWRITES non-settings entries with the payload,
        // so a delta payload would destroy every other field. Full-record
        // spread aligns localStorage (overwrite with full) and Firestore
        // (merge:true is idempotent on equal fields).
        persist.repair(r.id, { ...r, status: normalized, updatedAt: nowIso } as unknown as Record<string, unknown>);
        return { ...r, status: normalized, updatedAt: nowIso } as Repair;
      }
      return r;
    });

    if (changed > 0) {
      repairsRef.current = next;
      setRepairs(next);
    }

    // Always set the flag — even when n === 0 — so sweep stays one-time.
    persistSettings({ repairStatusSweepDone: true } as Record<string, unknown>);
    console.log(`[R2] Normalized ${changed} repairs from PascalCase to snake`);
  }, [settings, setRepairs]);
  const customersRef = useRef(customers);
  const cartRef = useRef(cart);
  const salesRef = useRef(sales);
  useEffect(() => { customersRef.current = customers; }, [customers]);
  useEffect(() => { cartRef.current = cart; }, [cart]);
  useEffect(() => { salesRef.current = sales; }, [sales]);

  // Consume cross-module search term once on mount
  useEffect(() => {
    if (globalSearchTerm) {
      setSearch(globalSearchTerm);
      dispatch({ type: 'SET_GLOBAL_SEARCH', payload: '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Translated statuses ─────────────────────────────────

  // Round R2: map canonical snake_case keys → i18n display labels.
  const translateStatus = useCallback(
    (status: string) => {
      const labels = STATUS_LABELS(t);
      const map: Record<string, string> = {
        All: t('repairs.filter.all'),
        ...labels,
        [REPAIR_STATUS.PICKED_UP]: labels.completed,
      };
      return map[status] ?? status;
    },
    [t],
  );

  // ── Filtered list ───────────────────────────────────────

  // Round R2: route both sides through canonical normalizer.
  const filtered = useMemo(() => {
    return repairs
      .filter((r) => {
        if (filterStatus === 'All') return true;
        return normalizeRepairStatus(r.status) === normalizeRepairStatus(filterStatus);
      })
      .filter((r) =>
        // R-SEARCH-NORMALIZE-V1: phone-aware match; also include r.imei
        // for parity with the GlobalSearchBar repair lookup at line ~235.
        matchesSearchPhones(
          search,
          [r.customerPhone],
          r.customerName, r.device, r.issue, r.id, (r as any).imei,
        ),
      )
      .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime());
  }, [repairs, filterStatus, search]);

  // r-new-5 + r-new-6: pending per repair, TAX-INCLUSIVE (what cashier will
  // actually charge at register), not the pre-tax base stored in cart.price.
  // Matches what the customer perceives they "paid" on the printed ticket.
  const pendingByRepairId = useMemo(() => {
    const map = new Map<string, number>();
    const taxRate = settings.taxRate ?? 0.0925;
    for (const item of cart) {
      if (!item.repairId) continue;
      const itemBaseCents = (item.price || 0) * (item.qty || 1);
      const fwd = forwardTaxFromBase(itemBaseCents, taxRate, !!item.taxable);
      const prev = map.get(item.repairId) || 0;
      map.set(item.repairId, prev + fwd.totalCents);
    }
    return map;
  }, [cart, settings.taxRate]);

  // ── Stats ───────────────────────────────────────────────

  // Round R2: canonical DONE buckets (picked_up covers legacy 'complete' via normalizer).
  const DONE_STATUSES: string[] = [REPAIR_STATUS.PICKED_UP, REPAIR_STATUS.CANCELLED, REPAIR_STATUS.READY];
  const activeCount = useMemo(
    () => repairs.filter((r) => !DONE_STATUSES.includes(normalizeRepairStatus(r.status))).length,
    [repairs],
  );
  const completeCount = useMemo(
    () => repairs.filter((r) => {
      const n = normalizeRepairStatus(r.status);
      return n === REPAIR_STATUS.PICKED_UP || n === REPAIR_STATUS.READY;
    }).length,
    [repairs],
  );

  // ── Auto-print repair ticket on creation ────────────────────
  // `displayOverride` lets callers print a ticket showing values that aren't
  // yet persisted on the entity. Specifically, when a repair is created with
  // a pending deposit, the entity holds depositAmount=0 (r-deposit-integrity-1)
  // but the customer should see the deposit they actually paid. The caller
  // passes the real numbers; persistence stays untouched.
  const printRepairTicket = useCallback((repair: any, displayOverride?: {
    depositAmount?: number;  // cents
    balance?: number;        // cents
    // R-EDIT-AUDIT F3.8: corrected-receipt mode for edited tickets.
    corrected?: boolean;
    originalSnapshot?: { capturedAt: string; snapshot: Record<string, unknown> };
  }) => {
    const safe = (v: any) => v == null ? '' : String(v);
    const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
    const storeName = (settings.storeName || 'CellHub Pro').toUpperCase();
    const storeAddr = settings.storeAddress || '';
    const storePhone = settings.storePhone || '';

    // R-EDIT-AUDIT F3.8: annotate "previously: $X.XX" on money lines when the
    // corrected-receipt flag is set and the snapshot has a different prior value.
    const corrected = !!displayOverride?.corrected;
    const snap = displayOverride?.originalSnapshot?.snapshot;
    const previously = (field: string): string => {
      if (!corrected || !snap) return '';
      const prior = snap[field];
      const current = (repair as any)[field];
      if (prior == null || prior === '' || prior === current) return '';
      if (typeof prior === 'number') return ` (${t('repairs.print.previously')}: ${money(prior)})`;
      return '';
    };

    const lines: string[] = [];
    lines.push(storeName);
    if (storeAddr) lines.push(storeAddr);
    if (storePhone) lines.push(storePhone);
    lines.push('----------------------------------------');
    if (corrected) {
      lines.push(t('repairs.print.correctedReceipt'));
      lines.push(`${t('repairs.print.corrected')}: ${new Date().toLocaleString()}`);
      lines.push('----------------------------------------');
    }
    lines.push(t('repairs.print.repairTicket'));
    lines.push(`TICKET: ${safe(repair.ticketNumber)}`);
    lines.push(`${t('repairs.print.date')}: ${new Date().toLocaleString()}`);
    lines.push(`STATUS: ${safe(repair.status)}`);
    lines.push('----------------------------------------');
    lines.push(`${t('repairs.print.customer')}: ${safe(repair.customerName)}`);
    if (repair.customerPhone) lines.push(`${t('repairs.print.phone')}: ${safe(repair.customerPhone)}`);
    lines.push('----------------------------------------');
    lines.push(`${t('repairs.print.device')}: ${safe(repair.device)}`);
    if (repair.imei) lines.push(`IMEI: ${safe(repair.imei)}`);
    lines.push('----------------------------------------');
    lines.push(`${t('repairs.print.issue')}: ${safe(repair.issue)}`);
    if (repair.notes) {
      lines.push('----------------------------------------');
      lines.push(`${t('repairs.print.notes')}: ${safe(repair.notes)}`);
    }
    lines.push('----------------------------------------');
    const partsCents = (repair.subtotal || 0) - (repair.laborCost || 0);
    if (partsCents > 0) lines.push(`${t('repairs.print.parts')}: ${money(partsCents)}`);
    if (repair.laborCost) lines.push(`${t('repairs.print.labor')}: ${money(repair.laborCost)}${previously('laborCost')}`);
    lines.push(`SUBTOTAL: ${money(repair.subtotal || 0)}${previously('subtotal')}`);
    if (repair.taxable && repair.taxAmount > 0) {
      lines.push(`${t('repairs.print.tax')} (${((repair.taxRate || 0) * 100).toFixed(2)}%): ${money(repair.taxAmount)}${previously('taxAmount')}`);
    }
    lines.push(`TOTAL: ${money(repair.total || 0)}${previously('total')}`);
    // Round R-QF1: print the deposit intent captured at form save.
    // depositAmount is $0 until POS checkout reconciles the cart sale
    // (per r-deposit-integrity-1). depositAgreementAmount is the
    // frozen-at-save intent value, never mutated by POS, so re-prints
    // after creation but before checkout still show the correct deposit.
    // Full Agreement + Payment Receipt split is a post-build round.
    const displayDeposit = displayOverride?.depositAmount
      ?? (repair.depositAmount || (repair as any).depositAgreementAmount || 0);
    // When the fallback to depositAgreementAmount fires (pre-checkout),
    // repair.balance still equals total (depositAmount=0) — recompute
    // from total so DEPOSIT + BALANCE reconcile on the printed ticket.
    const displayTotal = repair.total || repair.estimatedCost || 0;
    const displayBalance = displayOverride?.balance
      ?? Math.max(0, displayTotal - displayDeposit);
    lines.push(`${t('repairs.print.deposit')}: ${money(displayDeposit)}${previously('depositAmount')}`);
    lines.push(`${t('repairs.print.balance')}: ${money(displayBalance)}${previously('balance')}`);
    // R-EDIT-AUDIT F3.8: show refund owed on corrected receipt when reason='refund'.
    if (corrected && (repair.refundOwedAmount || 0) > 0) {
      lines.push(`${t('repairs.print.refundOwed')}: ${money(repair.refundOwedAmount)}`);
    }
    lines.push('----------------------------------------');
    if (repair.warranty) lines.push(`${t('repairs.print.warranty')}: ${repair.warranty} ${t('repairs.print.days')}`);
    lines.push(t('repairs.print.thankYou'));

    const text = lines.filter(Boolean).join('\n');
    const html = `<!DOCTYPE html><html><head><title>Repair ${escHtml(repair.ticketNumber)}</title><style>@page{size:4in 6in;margin:0}html,body{width:4in;height:6in;margin:0;padding:0;font-family:monospace}body{padding:.25in;box-sizing:border-box}pre{font-size:14px;line-height:1.55;white-space:pre-wrap;word-break:break-word;margin:0}</style></head><body><pre>${text.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre></body></html>`;
    printHtml(html, { silent: false, printer: settings.detectedPrinters?.[0] });
  }, [settings, printHtml, t]);

  // r-new-5: consolidation helper — ensures the invariant "one repair has at most
  // one cart item at any time". Called by: deposit-at-create (handleSave CREATE),
  // collectBalance, and DepositModal onConfirm. All 3 entry points must go through
  // this helper so the invariant holds even under rapid clicks / stale state.
  //
  // `additionalCents` is TAX-INCLUSIVE (what the cashier intends to collect).
  // Existing items in the cart for this repair are summed (forward-taxed to
  // tax-inclusive) then combined with `additionalCents`. Result is a single cart
  // item with pre-tax base = reverse-tax(combined), so POS ends up charging
  // exactly `combinedCents` at the register.
  const consolidateCartForRepair = useCallback((params: {
    repairId: string;
    additionalCents: number;
    deviceLabel: string;
    ticketNumber?: string;
    isTaxable: boolean;
  }): { combinedCents: number } => {
    const { repairId, additionalCents, deviceLabel, ticketNumber, isTaxable } = params;
    const taxRate = settings.taxRate ?? 0.0925;

    // Sum any existing items for this repair (tax-inclusive cents)
    const existingItems = cartRef.current.filter((c) => c.repairId === repairId);
    let combinedCents = additionalCents;
    for (const existing of existingItems) {
      const existingBase = (existing.price || 0) * (existing.qty || 1);
      const existingFwd = forwardTaxFromBase(existingBase, taxRate, !!existing.taxable);
      combinedCents += existingFwd.totalCents;
    }

    // Reverse-tax the combined tax-inclusive amount back to the pre-tax base
    // that the cart item should store (cart items are stored as pre-tax; POS
    // adds tax when it calculates totals for the sale).
    const split = reverseTaxFromPayment(combinedCents, taxRate, isTaxable);

    const consolidatedItem: CartItem = {
      id: generateId(),
      name: `${deviceLabel} — ${t('repairs.repairSuffix')}`,
      category: 'service',
      price: split.baseCents,
      qty: 1,
      taxable: isTaxable,
      cbeEligible: false,
      repairId,
      notes: ticketNumber || repairId.slice(-6).toUpperCase(),
    };

    const nextCart = [
      ...cartRef.current.filter((c) => c.repairId !== repairId),
      consolidatedItem,
    ];
    cartRef.current = nextCart;
    setCart(nextCart);

    return { combinedCents };
  }, [settings.taxRate, lang, setCart]);

  // ── Save handler ────────────────────────────────────────

  const handleSave = useCallback(
    // R-EDIT-AUDIT F3.6: auditMeta carries reason/changes/note when saving a
    // locked (post-completion) ticket. When present, side-effects + edit-history
    // are applied here; RepairModal does NOT touch audit fields directly.
    (repairData: Partial<Repair>, auditMeta?: RepairAuditMeta) => {
      // Round R1 F4: track matchedCustomerId so we can persist it on the repair
      // entity. Previously customerId was never set → POS couldn't auto-link.
      let matchedCustomerId: string | undefined;

      // Auto-create customer if new — dedup by phone
      if (repairData.customerName && repairData.customerPhone) {
        const phone = normalizePhone(repairData.customerPhone);
        const existing = customers.find(
          (c) => normalizePhone(c.phone) === phone,
        );

        if (existing) {
          matchedCustomerId = existing.id;
          // Customer exists — notify if name differs
          if (existing.name.toLowerCase() !== repairData.customerName.toLowerCase()) {
            toast(t('repairs.existingCustomerFound', existing.name), 'info');
          }
        } else {
          const repairFirstName = (repairData as { firstName?: string }).firstName || repairData.customerName.trim().split(/\s+/)[0] || '';
          const repairLastName  = (repairData as { lastName?: string }).lastName  || repairData.customerName.trim().split(/\s+/).slice(1).join(' ') || '';
          const newCustomer: Customer = {
            id: generateId(),
            firstName: repairFirstName,
            lastName: repairLastName,
            name: repairData.customerName,
            phone: repairData.customerPhone,
            phones: [repairData.customerPhone],
            email: '',
            loyaltyPoints: 0,
            storeCredit: 0,
            customerNumber: `${settings.customerNumberPrefix || 'GC'}-${Date.now().toString().slice(-8)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
            notes: '',
            communicationConsent: false,
            createdAt: new Date().toISOString(),
          };
          const nextCustomers = [...customersRef.current, newCustomer];
          customersRef.current = nextCustomers;
          setCustomers(nextCustomers);
          persist.customer(newCustomer.id, newCustomer as unknown as Record<string, unknown>);
          matchedCustomerId = newCustomer.id;
        }
      }

      if (editRepair) {
        // r-deposit-integrity-1 EDIT guard: spread repairData first but then
        // FORCE depositAmount + balance back to whatever the entity currently
        // has. These two fields are managed exclusively by:
        //   (a) POSModule.handleCompleteSale — increments on checkout
        //   (b) handleCancelRepair — resets on cancel+refund
        // Any other write path is a bug. If the cashier wants to collect a
        // deposit/balance, they use the "Collect" button which pushes to cart.
        // If they want to refund, they use the Cancel button (new flow).
        // Recalculate balance from the new total so price changes (parts/labor)
        // still update balance = total - depositAmount correctly.
        const spread = { ...editRepair, ...repairData } as Repair;
        const lockedDeposit = editRepair.depositAmount || (editRepair as any).deposit || 0;
        const newTotal = (spread as any).total || spread.estimatedCost || 0;
        const lockedBalance = Math.max(0, newTotal - lockedDeposit);
        const updated: Repair = {
          ...spread,
          // Round R2: persist canonical snake_case repair status.
          status: normalizeRepairStatus(spread.status) || REPAIR_STATUS.RECEIVED,
          depositAmount: lockedDeposit,
          balance: lockedBalance,
          id: editRepair.id,
          createdAt: editRepair.createdAt,
          updatedAt: new Date().toISOString(),
        } as Repair;

        // R-EDIT-AUDIT F3.6-7: when modal saved with audit metadata, layer
        // side-effects + capture originalSnapshot + append edit-history entry.
        // Read the truly-fresh entity from repairsRef to guard against background
        // writes that may have landed between modal open and save (e.g. POS checkout).
        if (auditMeta) {
          const fresh = repairsRef.current.find((r) => r.id === editRepair.id) || editRepair;
          const taxRate = settings.taxRate ?? 0.0925;
          const newTaxable = (updated as any).taxable ?? false;
          const oldTaxable = (fresh as any).taxable ?? false;

          // Defensive: incoming payload must not overwrite audit fields; re-seed
          // them from fresh entity so side-effects build on top of real state.
          delete (updated as any).editHistory;
          delete (updated as any).originalSnapshot;
          delete (updated as any).refundOwedAmount;
          updated.editHistory = fresh.editHistory;
          updated.originalSnapshot = fresh.originalSnapshot;
          updated.refundOwedAmount = fresh.refundOwedAmount;

          const sideEffects: EditAuditEntry['sideEffects'] = {};
          switch (auditMeta.reason) {
            case 'additional_balance': {
              const fwd = forwardTaxFromBase(updated.estimatedCost || 0, taxRate, newTaxable);
              const newTotal = fwd.totalCents;
              const alreadyPaid = fresh.depositAmount || 0;
              const newBalance = Math.max(0, newTotal - alreadyPaid);
              updated.balance = newBalance;
              updated.status = REPAIR_STATUS.RECEIVED;
              sideEffects.balanceChange = newBalance - (fresh.balance || 0);
              sideEffects.statusChange = {
                from: String(fresh.status),
                to: REPAIR_STATUS.RECEIVED,
              };
              break;
            }
            case 'absorbed': {
              updated.balance = 0;
              const oldFwd = forwardTaxFromBase(fresh.estimatedCost || 0, taxRate, oldTaxable);
              const newFwd = forwardTaxFromBase(updated.estimatedCost || 0, taxRate, newTaxable);
              sideEffects.absorbedAmount = Math.abs(newFwd.totalCents - oldFwd.totalCents);
              break;
            }
            case 'refund': {
              const oldFwd = forwardTaxFromBase(fresh.estimatedCost || 0, taxRate, oldTaxable);
              const newFwd = forwardTaxFromBase(updated.estimatedCost || 0, taxRate, newTaxable);
              const refundOwed = Math.max(0, oldFwd.totalCents - newFwd.totalCents);
              updated.refundOwedAmount = refundOwed;
              updated.status = REPAIR_STATUS.REFUND_PENDING;
              updated.balance = 0;
              sideEffects.refundOwedAmount = refundOwed;
              sideEffects.statusChange = {
                from: String(fresh.status),
                to: REPAIR_STATUS.REFUND_PENDING,
              };
              break;
            }
            case 'typo_correction':
              break;
          }

          // Capture originalSnapshot on first edit — never overwrite.
          if (!updated.originalSnapshot) {
            updated.originalSnapshot = captureSnapshot(fresh as unknown as Record<string, unknown>);
          }

          const entry: EditAuditEntry = {
            editedAt: updated.updatedAt as string,
            editedBy: currentEmployee?.name || 'Unknown',
            // AdminPinGate validates against a single shared adminPin with no
            // identity attribution; use currentEmployee until per-employee PINs exist.
            pinUsedBy: currentEmployee?.name || 'Admin',
            reason: auditMeta.reason,
            fieldsChanged: auditMeta.changes,
            note: auditMeta.note || undefined,
            sideEffects: Object.keys(sideEffects).length > 0 ? sideEffects : undefined,
          };
          // checkEditHistoryStatus was already enforced in the modal, but re-check
          // defensively in case of concurrent writes bumping history to cap.
          if (checkEditHistoryStatus(updated.editHistory) === 'full') {
            toast(t('repairs.errHistoryFullShort'), 'error');
            return;
          }
          const newHistory = appendEditEntry(updated.editHistory, entry);
          if (newHistory === null) {
            toast(t('repairs.errHistoryFullShort'), 'error');
            return;
          }
          updated.editHistory = newHistory;
        }

        const next = repairsRef.current.map((r) => (r.id === editRepair.id ? updated : r));
        repairsRef.current = next;
        setRepairs(next);
        persist.repair(updated.id, updated as unknown as Record<string, unknown>);

        // R-EDIT-AUDIT F3.8: auto-reprint corrected receipt for money-impacting edits.
        if (auditMeta && auditMeta.reason !== 'typo_correction') {
          printRepairTicket(updated, {
            corrected: true,
            originalSnapshot: updated.originalSnapshot,
          });
        }

        // R-COMMS-SMS-HARD-DISABLE: removed proactive status-change SMS block.
        // WhatsApp button on TicketCard remains the manual comm channel.

        toast(t('saved'), 'success');
      } else {
        // Create new — ticket number matching original format
        const now = new Date();
        const rd = repairData as any;
        const deviceLabel = [rd.brand, rd.model].filter(Boolean).join(' ') || rd.device || '';
        // Round R-QF1: capture deposit intent early so it can be stamped
        // on the entity for receipt re-prints. Value is cents.
        const depositAmt = rd.depositAmount || 0;

        // Round R1 F3: collision check. ticketNumber is user-visible on
        // printed tickets and trackingToken is the public customer handle
        // — collisions would expose other repairs' status. Bounded retry
        // so a pathological random seed can't livelock handleSave.
        const genTicketNum = () =>
          `RPR-${String(now.getFullYear()).slice(-2)}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(Math.floor(Math.random()*9000)+1000)}`;
        const genTrackingToken = () => Math.random().toString(36).slice(2, 10).toUpperCase();

        let ticketNum = rd.ticketNumber || genTicketNum();
        if (!rd.ticketNumber) {
          let ticketAttempts = 0;
          while (repairsRef.current.some((r) => (r as any).ticketNumber === ticketNum)) {
            ticketNum = genTicketNum();
            if (++ticketAttempts > 10) {
              toast(t('repairs.couldNotGenTicket'), 'error');
              return;
            }
          }
        }

        let trackingToken = genTrackingToken();
        let tokenAttempts = 0;
        while (repairsRef.current.some((r) => (r as any).trackingToken === trackingToken)) {
          trackingToken = genTrackingToken();
          if (++tokenAttempts > 10) {
            toast(t('repairs.couldNotGenToken'), 'error');
            return;
          }
        }

        const newRepair = {
          id: generateId(),
          storeId: currentStoreId,
          ticketNumber: ticketNum,
          trackingToken,
          // Customer
          customerId: matchedCustomerId,  // Round R1 F4: link repair to customer
          customerName: rd.customerName || '',
          customerPhone: rd.customerPhone || '',
          firstName: rd.firstName || '',
          lastName: rd.lastName || '',
          // Device
          device: deviceLabel,
          deviceModel: rd.model || rd.deviceModel || '',
          brand: rd.brand || '',
          model: rd.model || '',
          deviceType: rd.deviceType || 'Phone',
          imei: rd.imei || '',
          carrier: rd.carrier || '',
          password: rd.password || '',
          // Repair
          issue: rd.issue || '',
          diagnosis: rd.diagnosis || '',
          // Round R2: persist canonical snake_case repair status.
          status: normalizeRepairStatus(rd.status) || REPAIR_STATUS.RECEIVED,
          priority: rd.priority || 'Normal',
          // Financials (cents)
          parts: rd.parts || [],
          laborCost: rd.laborCost || 0,
          partsTotal: rd.partsTotal || 0,
          subtotal: rd.subtotal || 0,
          taxAmount: rd.taxAmount || 0,
          taxable: !!rd.taxable,
          taxRate: rd.taxRate || 0,
          estimatedCost: rd.total || rd.estimatedCost || 0,
          total: rd.total || rd.estimatedCost || 0,
          // r-deposit-integrity-1 P1: deposits MUST NOT be reflected in the
          // entity until the POS checkout confirms the sale. The amount the
          // user typed is captured into `pendingDepositAmt` below and pushed
          // to the cart; the entity itself is persisted as if no deposit had
          // been collected. POSModule.handleCompleteSale reconciles the cart
          // items back to the entity when the sale is finalized. If the
          // cashier abandons the cart, the entity stays at depositAmount=0
          // and no revenue ghost is created.
          depositAmount: 0,
          deposit: 0,
          // Round R-QF1: L-QF1 analogue — "agreement" intent captured at
          // form save, never mutated by POS. The r-deposit-integrity-1
          // invariant keeps depositAmount=0 until POS checkout reconciles;
          // this separate field powers the receipt DEPOSIT line on the
          // initial auto-print AND subsequent re-prints from the ticket
          // card. Post-build Agreement/Payment split round will formalize.
          depositAgreementAmount: depositAmt,
          balance: rd.total || rd.estimatedCost || 0,
          // Notes
          techNotes: rd.notes || rd.techNotes || '',
          notes: rd.notes || '',
          internalNotes: rd.internalNotes || '',
          // Meta
          warranty: rd.warranty || 30,
          estimatedCompletion: rd.estimatedCompletion || '',
          technicianName: currentEmployee?.name || '',
          employeeName: currentEmployee?.name,
          employeeId: currentEmployee?.id,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as unknown as Repair;

        const next = [...repairsRef.current, newRepair];
        repairsRef.current = next;
        setRepairs(next);
        persist.repair(newRepair.id, newRepair as unknown as Record<string, unknown>);

        // Round R-QF2: mirror Layaway cart auto-link so the cashier
        // doesn't have to re-select the customer that the repair form
        // already captured. Dispatch now uses the local matchedCustomerId
        // (same pattern as Layaway's finalCustomerId) and fires on every
        // new repair with a matched customer, not just deposit-bearing
        // ones. Post-build unified round will formalize cart-customer
        // linking across all deposit flows.
        if (matchedCustomerId) {
          dispatch({ type: 'SET_PENDING_POS_CUSTOMER', payload: matchedCustomerId });
        }

        // r-deposit-integrity-1: pending deposit was read from form data (rd)
        // earlier — newRepair is persisted with depositAmount=0 per the
        // invariant. Round R-QF1 moved the declaration up so the intent
        // can also be stamped as depositAgreementAmount on the entity.
        if (depositAmt > 0) {
          const isTaxable = !!(newRepair as any).taxable;
          // r-new-5: go through consolidation helper. On CREATE there are
          // never pre-existing cart items for a just-generated repairId, but
          // using the helper keeps all cart-add paths identical.
          consolidateCartForRepair({
            repairId: newRepair.id,
            additionalCents: depositAmt,
            deviceLabel,
            ticketNumber: ticketNum,
            isTaxable,
          });
          toast(t('repairs.depositAddedToCart', formatCurrency(depositAmt)), 'info');
        } else {
          toast(t('repairs.repairCreated'), 'success');
        }

        // Auto-print repair ticket on creation.
        // r-repair-deposit-print: newRepair has depositAmount=0 (intentional),
        // but the customer paid `depositAmt` right now. Pass display override
        // so the printed ticket shows the real deposit and remaining balance.
        // The persisted entity stays at depositAmount=0; POS checkout
        // reconciles the real number into the entity later.
        const displayTotalCents = Number(newRepair.total || newRepair.estimatedCost || 0);
        const displayBalanceCents = Math.max(0, displayTotalCents - depositAmt);
        setTimeout(
          () => printRepairTicket(newRepair, {
            depositAmount: depositAmt,
            balance: displayBalanceCents,
          }),
          300
        );
      }

      setShowModal(false);
      setEditRepair(null);
    },
    [editRepair, customers, settings, currentEmployee, cart, lang,
     setRepairs, setCustomers, setCart, toast, printRepairTicket, consolidateCartForRepair,
     dispatch],  // Round R1 F5: missing dispatch dep (used for SET_PENDING_POS_CUSTOMER)
  );

  // ── Cancel repair with deposit disposal ────────────────────
  // BUG #1 fix: Before this, cancelling a repair left depositAmount intact
  // on the entity — ghost revenue with no record of what happened to the money.
  // Now every cancellation forces a disposition choice.
  const handleCancelRepair = useCallback(async (repair: Repair, choice: {
    method: 'store_credit' | 'cash' | 'forfeit';
    note: string;
  }) => {
    // R-APPROVAL-GATE-REPAIRS-UNLOCKS-V1: approval gate before any mutation.
    const approval = await approvalGate.requestApproval({
      actionType: 'CANCEL_REPAIR',
      requestedByEmployeeId: currentEmployee?.id || '',
      entityId: repair.id,
      affectedAmount: repair.depositAmount || (repair as any).deposit || 0,
      reason: choice.method === 'cash'
        ? 'Repair cancellation — cash refund'
        : choice.method === 'store_credit'
        ? 'Repair cancellation — store credit'
        : 'Repair cancellation — deposit forfeited',
    });
    if (!approval.approved) return;

    // Round R3-mini: legacy repairs may have { deposit: X, depositAmount: undefined }.
    // Match the fallback pattern used in handleCompleteRequest, TicketCard display,
    // and handleSave EDIT so legacy cancellations refund the actual amount paid.
    const depositCents = repair.depositAmount || (repair as any).deposit || 0;
    const now = new Date().toISOString();

    // 1. Customer side effects (store credit or voided sale)
    if (choice.method === 'store_credit' && depositCents > 0) {
      const phoneTail = (repair.customerPhone || '').replace(/\D/g, '').slice(-10);
      const matched = customersRef.current.find((c) => {
        if ((repair as any).customerId && c.id === (repair as any).customerId) return true;
        if (phoneTail) {
          const cPhone = (c.phone || '').replace(/\D/g, '').slice(-10);
          if (cPhone && cPhone === phoneTail) return true;
        }
        return false;
      });
      if (matched) {
        const updatedCustomer = {
          ...matched,
          storeCredit: (matched.storeCredit || 0) + depositCents,
        };
        const nextCustomers = customersRef.current.map((c) =>
          c.id === matched.id ? updatedCustomer : c
        );
        customersRef.current = nextCustomers;
        setCustomers(nextCustomers);
        persist.customer(updatedCustomer.id, updatedCustomer as unknown as Record<string, unknown>);
      } else {
        toast(t('repairs.customerNotMatched'), 'warning');
      }
    } else if (choice.method === 'cash' && depositCents > 0) {
      const refundSale: Sale = {
        id: generateId(),
        storeId: (repair as any).storeId,
        invoiceNumber: `REFUND-${repair.id.slice(-6).toUpperCase()}`,
        customerId: (repair as any).customerId,
        customerName: repair.customerName,
        customerPhone: repair.customerPhone,
        items: [{
          id: generateId(),
          name: `${repair.device} — ${t('repairs.cancellationRefundSuffix')}`,
          category: 'service' as any,
          price: -depositCents,
          qty: 1,
          taxable: false,
          cbeEligible: false,
          repairId: repair.id,
        }],
        subtotal: -depositCents,
        taxAmount: 0,
        cbeTotal: 0,
        total: -depositCents,
        paymentMethod: 'Cash' as any,
        status: 'voided',
        employeeId: currentEmployee?.id,
        employeeName: currentEmployee?.name,
        notes: `Repair cancelled — cash refund for ticket ${(repair as any).ticketNumber || repair.id.slice(-6).toUpperCase()}`,
        refundReason: 'Repair cancelled',
        createdAt: now,
      };
      // r9-1: Mark original sale(s) containing this repair as refunded so Reports
      //       excludes them from Gross/Cash/Profit. Voided refund sale remains
      //       as audit trail.
      const originalSales = salesRef.current.filter((s: Sale) =>
        (s.items || []).some((item: any) => item.repairId === repair.id)
        && s.status !== 'voided'
        && s.status !== 'refunded'
      );
      const markedSales = originalSales.map((s: Sale) => ({
        ...s,
        status: 'refunded' as Sale['status'],
        refundedAt: now,
        refundReason: `Repair Cancel: ${choice.note || 'no note'}`,
        refundMethod: 'cash',
      }));
      for (const ms of markedSales) {
        persist.sale(ms.id, ms as unknown as Record<string, unknown>);
      }

      // Build next sales array: replace originals with marked versions + add refund audit record
      const salesWithMarked = salesRef.current.map((s: Sale) => {
        const marked = markedSales.find((m: any) => m.id === s.id);
        return marked || s;
      });
      const nextSales = [...salesWithMarked, refundSale];
      salesRef.current = nextSales;
      setSales(nextSales);
      persist.sale(refundSale.id, refundSale as unknown as Record<string, unknown>);
    }

    // 2. Update repair entity
    const updated = {
      ...repair,
      // Round R2: canonical snake_case on cancel path.
      status: REPAIR_STATUS.CANCELLED,
      depositRefundMethod: choice.method,
      depositRefundAmount: depositCents,
      cancellationNote: choice.note || '',
      cancelledAt: now,
      depositAmount: 0,
      deposit: 0,                // r-new-4: zero legacy field — TicketCard falls back to .deposit
      balance: 0,
      updatedAt: now,
    } as unknown as Repair;
    const nextRepairs = repairsRef.current.map((r) => r.id === repair.id ? updated : r);
    repairsRef.current = nextRepairs;
    setRepairs(nextRepairs);
    persist.repair(updated.id, updated as unknown as Record<string, unknown>);

    // 3. Toast feedback
    const msg = {
      store_credit: t('repairs.cancelledStoreCreditAdded', formatCurrency(depositCents)),
      cash: t('repairs.cancelledCashRefundRecorded', formatCurrency(depositCents)),
      forfeit: t('repairs.cancelledForfeited'),
    }[choice.method];
    toast(msg, 'success');
    setCancelTarget(null);
  }, [lang, setCustomers, setSales, setRepairs, toast, currentEmployee, approvalGate.requestApproval]);

  // ── Collect balance ─────────────────────────────────────

  const collectBalance = useCallback(
    (repair: Repair) => {
      if (!repair.balance || repair.balance <= 0) return;

      const isTaxable = !!(repair as any).taxable;
      const { combinedCents } = consolidateCartForRepair({
        repairId: repair.id,
        additionalCents: repair.balance,
        deviceLabel: [(repair as any).brand, (repair as any).model].filter(Boolean).join(' ') || repair.device || '',
        ticketNumber: (repair as any).ticketNumber,
        isTaxable,
      });
      if ((repair as any).customerId) {
        dispatch({ type: 'SET_PENDING_POS_CUSTOMER', payload: (repair as any).customerId });
      }

      toast(t('repairs.cartAdded', formatCurrency(combinedCents)), 'info');
    },
    [consolidateCartForRepair, dispatch, toast, lang],
  );

  const handleCompleteRequest = useCallback((repair: Repair) => {
    const balance = repair.balance || 0;
    const deposit = (repair as any).depositAmount || (repair as any).deposit || 0;
    if (balance === 0 && deposit === 0) {
      // Round R2: canonical snake_case on complete path (picked_up).
      // R-COMPLETEDAT-FIELD: stamp completedAt once; preserve if already set.
      const nowIso = new Date().toISOString();
      const updated: Repair = { ...repair, status: REPAIR_STATUS.PICKED_UP, updatedAt: nowIso, completedAt: repair.completedAt ?? nowIso };
      const next = repairsRef.current.map((r) => r.id === repair.id ? updated : r);
      repairsRef.current = next;
      setRepairs(next);
      persist.repair(updated.id, updated as unknown as Record<string, unknown>);
      emitRepairCompleted(repair.id, (repair as any).customerId);
      toast(t('repairs.repairCompleted'), 'success');
      return;
    }
    setCompleteConfirm(repair);
  }, [setRepairs, toast, lang]);

  const handleCompleteConfirmed = useCallback(() => {
    const repair = completeConfirm;
    if (!repair) return;

    if ((repair.balance || 0) > 0) {
      // Round R-POS-PARITY F2: consolidateCartForRepair is ADDITIVE
      // (sums additionalCents + existing cart cents, both tax-inclusive).
      // When "Complete / Collect $X" is clicked with a deposit already
      // in the cart, passing the full balance double-counts (seen in
      // runtime as the $159.25 ghost = $50 deposit + $109.25 balance).
      // Mirror Layaway's "collect remaining" flow by passing the DELTA
      // using the same forwardTaxFromBase conversion the helper uses
      // internally so the math is bit-identical.
      const taxRate = settings.taxRate ?? 0.0925;
      const existingCents = cartRef.current
        .filter((c) => c.repairId === repair.id)
        .reduce((sum, c) => {
          const base = (c.price || 0) * (c.qty || 1);
          const fwd = forwardTaxFromBase(base, taxRate, !!c.taxable);
          return sum + fwd.totalCents;
        }, 0);
      const deltaCents = Math.max(0, (repair.balance || 0) - existingCents);

      if (deltaCents > 0) {
        const isTaxable = !!(repair as any).taxable;
        consolidateCartForRepair({
          repairId: repair.id,
          additionalCents: deltaCents,
          deviceLabel: [(repair as any).brand, (repair as any).model].filter(Boolean).join(' ') || repair.device || '',
          ticketNumber: (repair as any).ticketNumber,
          isTaxable,
        });
      }

      if ((repair as any).customerId) {
        dispatch({ type: 'SET_PENDING_POS_CUSTOMER', payload: (repair as any).customerId });
      }
    }

    // Round R-POS-PARITY F1: delegate status transition to POS reconcile.
    // POSModule.tsx:538 owns the newBalance === 0 → 'picked_up' rule. This
    // handler only stamps picked_up when there is literally nothing left
    // to collect (balance = 0), mirroring the fast-path in
    // handleCompleteRequest. When balance > 0, POS reconcile will stamp
    // picked_up once the final payment brings balance to 0 — no status
    // mutation here.
    if ((repair.balance || 0) === 0) {
      // Round R2: canonical snake_case on complete path (picked_up).
      // R-COMPLETEDAT-FIELD: stamp completedAt once; preserve if already set.
      const nowIso = new Date().toISOString();
      const updated: Repair = { ...repair, status: REPAIR_STATUS.PICKED_UP, updatedAt: nowIso, completedAt: repair.completedAt ?? nowIso };
      const next = repairsRef.current.map((r) => r.id === repair.id ? updated : r);
      repairsRef.current = next;
      setRepairs(next);
      persist.repair(updated.id, updated as unknown as Record<string, unknown>);
      emitRepairCompleted(repair.id, (repair as any).customerId);
    }

    setCompleteConfirm(null);
    toast(
      (repair.balance || 0) > 0
        ? t('repairs.balanceAddedGoToPOS')
        : t('repairs.repairCompleted'),
      'success',
    );
  }, [completeConfirm, consolidateCartForRepair, setRepairs, dispatch, toast, lang, settings.taxRate]);

  // R-COMMS-SMS-HARD-DISABLE: handleSMS callback removed.
  // TicketCard's onWhatsApp prop is the live manual comm path.

  const handleDeleteConfirmed = useCallback(() => {
    if (!deleteConfirm) return;

    // r-new-4 GUARD 1: prevent delete if repair has pending cart items.
    // Deleting would leave orphan cart lines that still charge at POS but
    // can't update any entity on reconciliation.
    const hasPendingCart = cartRef.current.some((item) => item.repairId === deleteConfirm.id);
    if (hasPendingCart) {
      toast(t('repairs.cantDeletePendingCart'), 'error');
      setDeleteConfirm(null);
      return;
    }

    // r-new-4 GUARD 2: prevent delete of paid/completed repairs.
    // These have Sale records in the sales collection that reference repairId.
    // Deleting the repair leaves dangling references and breaks reports.
    // For paid repairs, the correct action is Cancel with refund, not Delete.
    const hasDeposit = ((deleteConfirm as any).depositAmount || 0) > 0;
    // Round R2: canonical comparison via normalizer.
    const isCompleted = normalizeRepairStatus(deleteConfirm.status) === REPAIR_STATUS.PICKED_UP;
    if (hasDeposit || isCompleted) {
      toast(t('repairs.cantDeletePaid'), 'error');
      setDeleteConfirm(null);
      return;
    }

    // Safe to delete (unpaid + not-completed + no cart items)
    const next = repairsRef.current.filter((r) => r.id !== deleteConfirm.id);
    repairsRef.current = next;
    setRepairs(next);
    remove.repair(deleteConfirm.id);
    setDeleteConfirm(null);
    toast(t('repairs.repairDeleted'), 'success');
  }, [deleteConfirm, setRepairs, toast, lang]);

  // ── Render ──────────────────────────────────────────────

  return (
    <>
      <TicketListLayout
        title={t('repairs.title')}
        icon="🔧"
        statuses={STATUSES}
        activeStatus={filterStatus}
        onStatusChange={(s) => { setFilterStatus(s); setVisibleCount(50); }}
        translateStatus={translateStatus}
        // r-global-search: search props removed; GlobalSearchBar mounted via slot.
        // Local `search` state still drives the filtered list memo (synced mode).
        globalSearchSlot={
          <GlobalSearchBar
            localValue={search}
            onLocalChange={(s) => { setSearch(s); setVisibleCount(50); }}
            excludeCollection="repairs"
            placeholder={t('repairs.searchPlaceholder')}
          />
        }
        stats={[
          { label: t('repairs.stat.active'), value: activeCount, color: 'text-orange-400' },
          { label: t('repairs.stat.completed'), value: completeCount, color: 'text-emerald-400' },
          { label: t('repairs.stat.total'), value: repairs.length, color: 'text-slate-300' },
        ]}
        onNew={() => { setEditRepair(null); setShowModal(true); }}
        newLabel={t('repairs.action.newRepair')}
      >
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            <span className="text-4xl block mb-3">🔧</span>
            <p>{t('repairs.noRepairsFound')}</p>
          </div>
        ) : (
          filtered.slice(0, visibleCount).map((repair) => (
            <TicketCard
              ref={isHighlighted(repair.id) ? highlightRef : null}
              highlighted={isHighlighted(repair.id)}
              key={repair.id}
              ticketNumber={(repair as any).ticketNumber || repair.id.slice(-8).toUpperCase()}
              customerName={repair.customerName}
              customerPhone={repair.customerPhone}
              device={[(repair as any).brand, (repair as any).model].filter(Boolean).join(' ') || repair.device || ''}
              issue={repair.issue}
              status={repair.status}
              statusBadgeClass={STATUS_BADGE[normalizeRepairStatus(repair.status)] || 'badge-neutral'}
              total={(repair as any).total || repair.estimatedCost || 0}
              deposit={(repair as any).depositAmount || (repair as any).deposit || 0}
              balance={repair.balance || 0}
              pendingCents={pendingByRepairId.get(repair.id) || 0}
              createdAt={repair.createdAt as string}
              priority={repair.priority}
              onClick={() => {
                setEditRepair(repair);
                setShowModal(true);
                // R-OPERATOR-ACTIVITY-WIRING: notify FloatingOperatorBubble that a repair was opened
                try {
                  window.dispatchEvent(new CustomEvent('cellhub:operator-activity', {
                    detail: { type: 'repair.opened', payload: { repairId: repair.id } },
                  }));
                } catch { /* env without CustomEvent — silent */ }
              }}
              onCollectBalance={repair.balance > 0 ? () => setDepositModalRepair(repair) : undefined}
              onWhatsApp={settings.waEnabled !== false && repair.customerPhone ? () => {
                // Round R2: canonical status checks for WA template selection.
                const canonical = normalizeRepairStatus(repair.status);
                const tmplKey = (canonical === REPAIR_STATUS.PICKED_UP || canonical === REPAIR_STATUS.READY) ? 'repairReady'
                  : canonical === REPAIR_STATUS.IN_PROGRESS ? 'repairInProgress'
                  : repair.balance > 0 ? 'balanceDue'
                  : 'repairReceived';
                const customTmpl = tmplKey === 'repairReady' ? settings.waTemplateRepairReady
                  : tmplKey === 'repairReceived' ? settings.waTemplateRepairReceived
                  : tmplKey === 'balanceDue' ? settings.waTemplateBalanceDue
                  : undefined;
                openWhatsApp(
                  repair.customerPhone,
                  buildWaMessage(
                    tmplKey as any,
                    {
                      customerName: repair.customerName,
                      storeName: settings.storeName || 'Go Cellular',
                      storePhone: settings.storePhone,
                      device: [(repair as any).brand, (repair as any).model].filter(Boolean).join(' ') || repair.device || '',
                      balance: repair.balance > 0 ? `$${(repair.balance / 100).toFixed(2)}` : undefined,
                      ticketNumber: (repair as any).ticketNumber || repair.id.slice(-8).toUpperCase(),
                    },
                    lang as 'en' | 'es',
                    customTmpl || undefined,
                  )
                );
              } : undefined}
              onDeposit={!isDoneRepairStatus(repair.status) && (repair.balance || 0) > 0
                ? () => setDepositModalRepair(repair)
                : undefined}
              onComplete={() => handleCompleteRequest(repair)}
              completeLabel={
                normalizeRepairStatus(repair.status) === REPAIR_STATUS.CANCELLED
                  ? t('repairs.cancelledLabel')
                  : normalizeRepairStatus(repair.status) === REPAIR_STATUS.PICKED_UP
                  ? t('repairs.completedLabel')
                  : (repair.balance || 0) > 0
                  ? t('repairs.completeCollect', formatCurrency(repair.balance))
                  : t('repairs.complete')
              }
              completeDisabled={isDoneRepairStatus(repair.status)}
              completeVariant={normalizeRepairStatus(repair.status) === REPAIR_STATUS.PICKED_UP ? 'green' : 'amber'}
              onPrint={() => {
                // R-EDIT-AUDIT F3.10: edited tickets trigger the corrected/original
                // print choice; unedited tickets print directly as before.
                if (repair.editHistory && repair.editHistory.length > 0) {
                  setPrintChoiceTarget(repair);
                } else {
                  printRepairTicket(repair);
                }
              }}
              onDelete={() => setDeleteConfirm(repair)}
              extraBadges={
                <>
                  {/* R-EDIT-AUDIT F3.9: edit-history count badge. */}
                  {repair.editHistory && repair.editHistory.length > 0 && (
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        setHistoryTarget(repair);
                      }}
                      style={{
                        cursor: 'pointer',
                        fontSize: '0.75rem',
                        padding: '0.125rem 0.5rem',
                        borderRadius: '0.25rem',
                        background: 'rgba(251, 191, 36, 0.15)',
                        color: '#fbbf24',
                      }}
                      title={t('repairs.viewEditHistory')}
                    >
                      🕐 {repair.editHistory.length}
                    </span>
                  )}
                  {/* R-EDIT-AUDIT F3.11: Mark Refunded button when in refund_pending state. */}
                  {normalizeRepairStatus(repair.status) === 'refund_pending' && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRefundConfirmTarget(repair);
                      }}
                      style={{
                        cursor: 'pointer',
                        fontSize: '0.72rem',
                        padding: '0.2rem 0.5rem',
                        borderRadius: '0.3rem',
                        background: 'rgba(16, 185, 129, 0.15)',
                        color: '#10b981',
                        border: '1px solid rgba(16, 185, 129, 0.3)',
                        fontWeight: 600,
                      }}
                    >                      {t('repairs.markRefunded')}
                    </button>
                  )}
                </>
              }
              lang={lang}
            />
          ))
        )}

          {filtered.length > visibleCount && (
            <div style={{ textAlign: 'center', padding: '1rem' }}>
              <button
                onClick={() => setVisibleCount((n) => n + 50)}
                className="btn btn-secondary btn-sm"
              >
                {t('repairs.showMore', filtered.length - visibleCount)}
              </button>
            </div>
          )}
      </TicketListLayout>

      {depositModalRepair && (
        <DepositModal
          title={t('repairs.depositTitle', (depositModalRepair as any).ticketNumber || depositModalRepair.id.slice(-6).toUpperCase())}
          itemLabel={`${[(depositModalRepair as any).brand, (depositModalRepair as any).model].filter(Boolean).join(' ') || depositModalRepair.device} — ${depositModalRepair.issue || 'Repair'}`}
          itemPrice={((depositModalRepair as any).subtotal || depositModalRepair.estimatedCost || 0) / 100}
          taxRate={settings.taxRate ?? 0.0925}
          taxable={!!(depositModalRepair as any).taxable}
          existingDeposit={(depositModalRepair.depositAmount || 0) / 100}
          pendingInCart={(pendingByRepairId.get(depositModalRepair.id) || 0) / 100}
          mode={depositModalRepair.balance > 0 ? 'balance' : 'deposit'}
          lang={lang}
          onClose={() => setDepositModalRepair(null)}
          onConfirm={({ depositAmt }) => {
            // r-new-5 race guard: prevent double-firing onConfirm if the user
            // rapidly clicks the confirm button or state is stale. The helper
            // itself is idempotent (filter + filter always produces the right
            // cart) but we avoid any toast/close double-fire.
            if (isConsolidating) return;
            setIsConsolidating(true);

            try {
              const r = depositModalRepair;
              const newAmtCents = Math.round(depositAmt * 100);
              const isTaxable = !!(r as any).taxable;

              const { combinedCents } = consolidateCartForRepair({
                repairId: r.id,
                additionalCents: newAmtCents,
                deviceLabel: [(r as any).brand, (r as any).model].filter(Boolean).join(' ') || r.device || '',
                ticketNumber: (r as any).ticketNumber,
                isTaxable,
              });
              if ((r as any).customerId) {
                dispatch({ type: 'SET_PENDING_POS_CUSTOMER', payload: (r as any).customerId });
              }

              setDepositModalRepair(null);
              toast(t('repairs.cartAdded', formatCurrency(combinedCents)), 'success');
            } finally {
              // Reset guard on next tick so future confirmations work.
              setTimeout(() => setIsConsolidating(false), 100);
            }
          }}
        />
      )}

      {showModal && (
        <RepairModal
          repair={editRepair}
          customers={customers}
          inventory={inventory}
          settings={settings}
          allRepairs={repairs}
          onSave={handleSave}
          onCollectBalance={collectBalance}
          onRequestCancel={(r) => {
            setShowModal(false);
            setEditRepair(null);
            setCancelTarget(r);
          }}
          onClose={() => { setShowModal(false); setEditRepair(null); }}
          lang={lang}
        />
      )}

      {cancelTarget && (
        <CancelRepairModal
          repair={cancelTarget}
          customerHasPhone={!!cancelTarget.customerPhone}
          customerName={cancelTarget.customerName}
          lang={lang}
          onConfirm={(choice) => handleCancelRepair(cancelTarget, choice)}
          onClose={() => setCancelTarget(null)}
        />
      )}

      {/* R-APPROVAL-GATE-REPAIRS-UNLOCKS-V1 */}
      {approvalGate.modal}

      {deleteConfirm && (
        <ConfirmDialog
          open
          title={t('repairs.deleteTitle')}
          message={t('repairs.deleteConfirm', (deleteConfirm as any).ticketNumber || deleteConfirm.id.slice(-6))}
          variant="danger"
          confirmLabel={t('delete')}
          cancelLabel={t('cancel')}
          onConfirm={handleDeleteConfirmed}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}

      {completeConfirm && (
        <ConfirmDialog
          open
          title={t('repairs.completeTitle')}
          message={
            (completeConfirm.balance || 0) > 0
              ? t('repairs.completeWithBalance', formatCurrency(completeConfirm.balance))
              : t('repairs.completeSimple')
          }
          variant="warning"
          confirmLabel={t('confirm')}
          cancelLabel={t('cancel')}
          onConfirm={handleCompleteConfirmed}
          onCancel={() => setCompleteConfirm(null)}
        />
      )}

      {/* R-EDIT-AUDIT F3.9: edit history viewer. */}
      {historyTarget && (
        <EditHistoryModal
          open
          onClose={() => setHistoryTarget(null)}
          lang={lang}
          editHistory={historyTarget.editHistory || []}
          originalSnapshot={historyTarget.originalSnapshot}
        />
      )}

      {/* R-EDIT-AUDIT F3.10: corrected-vs-original print choice for edited tickets. */}
      {printChoiceTarget && (
        <Modal
          open
          title={t('repairs.printTicketTitle')}
          onClose={() => setPrintChoiceTarget(null)}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <button
              className="btn btn-primary"
              style={{ width: '100%' }}
              onClick={() => {
                printRepairTicket(printChoiceTarget, {
                  corrected: true,
                  originalSnapshot: printChoiceTarget.originalSnapshot,
                });
                setPrintChoiceTarget(null);
              }}
            >
              {t('repairs.printCurrentCorrected')}
            </button>
            <button
              className="btn btn-secondary"
              style={{ width: '100%' }}
              onClick={() => {
                // R-EDIT-AUDIT F6-FIX: explicit money-field mapping instead of
                // raw snapshot spread. Prevents snapshot's id/createdAt/status/
                // editHistory from clobbering the current entity — we only want
                // the pre-edit money values for the "original" print.
                if (printChoiceTarget.originalSnapshot?.snapshot) {
                  const snap = printChoiceTarget.originalSnapshot.snapshot;
                  printRepairTicket({
                    ...printChoiceTarget,
                    laborCost: snap.laborCost ?? printChoiceTarget.laborCost,
                    estimatedCost: snap.estimatedCost ?? printChoiceTarget.estimatedCost,
                    depositAmount: snap.depositAmount ?? printChoiceTarget.depositAmount,
                    balance: snap.balance ?? printChoiceTarget.balance,
                    total: snap.total ?? printChoiceTarget.total,
                    subtotal: snap.subtotal ?? (printChoiceTarget as any).subtotal,
                    taxAmount: snap.taxAmount ?? (printChoiceTarget as any).taxAmount,
                  } as any);
                } else {
                  printRepairTicket(printChoiceTarget);
                }
                setPrintChoiceTarget(null);
              }}
            >
              {t('repairs.printOriginalPreEdits')}
            </button>
            <button
              className="btn btn-secondary"
              style={{ width: '100%' }}
              onClick={() => setPrintChoiceTarget(null)}
            >
              {t('cancel')}
            </button>
          </div>
        </Modal>
      )}

      {/* R-EDIT-AUDIT F3.11: confirm Mark Refunded → closes out refund_pending state. */}
      {refundConfirmTarget && (
        <ConfirmDialog
          open
          title={t('repairs.markRefundedTitle')}
          message={t('repairs.markRefundedConfirm', formatCurrency(refundConfirmTarget.refundOwedAmount || 0))}
          confirmLabel={t('repairs.yesRefunded')}
          cancelLabel={t('cancel')}
          onConfirm={() => {
            const target = refundConfirmTarget;
            // F7-FIX-v2: double-refund guard (rapid double-click or stale state).
            if (normalizeRepairStatus(target.status) === REPAIR_STATUS.REFUNDED) {
              setRefundConfirmTarget(null);
              return;
            }
            const now = new Date().toISOString();
            const refundAmountCents = target.refundOwedAmount || 0;

            // 1. Mark the ticket as refunded, clear refundOwedAmount.
            const updated: Repair = {
              ...target,
              status: REPAIR_STATUS.REFUNDED,
              refundOwedAmount: 0,
              updatedAt: now,
            };
            const nextRepairs = repairsRef.current.map((r) =>
              r.id === updated.id ? updated : r,
            );
            repairsRef.current = nextRepairs;
            setRepairs(nextRepairs);
            persist.repair(updated.id, updated as unknown as Record<string, unknown>);

            // 2. F7-FIX-v2: partial refund sale. status='completed' (NOT voided)
            //    so Reports includes it with negative total, which subtracts from
            //    gross revenue. Originals stay untouched — this is a PARTIAL
            //    refund from a price edit, not a cancellation.
            if (refundAmountCents > 0) {
              // Fix 4: split refund amount into base + tax so Reports tax
              // totals net correctly. refundOwedAmount is the all-in amount
              // the customer overpaid (base + any tax portion).
              const repairTaxable = !!(updated as any).taxable;
              const taxRateForRefund = settings.taxRate ?? 0.0925;
              const { baseCents: refundBaseCents, taxCents: refundTaxCents } =
                reverseTaxFromPayment(refundAmountCents, taxRateForRefund, repairTaxable);
              const refundSale: Sale = {
                id: generateId(),
                storeId: (updated as any).storeId,
                invoiceNumber: `REFUND-${updated.id.slice(-6).toUpperCase()}`,
                customerId: (updated as any).customerId,
                customerName: updated.customerName || 'Walk-in',
                customerPhone: updated.customerPhone || '',
                items: [{
                  id: generateId(),
                  name: `${updated.device || 'Repair'} — ${t('repairs.postEditRefundSuffix')}`,
                  category: 'service' as any,
                  price: -refundBaseCents,
                  qty: 1,
                  taxable: repairTaxable,
                  cbeEligible: false,
                  repairId: updated.id,
                }],
                subtotal: -refundBaseCents,
                taxAmount: -refundTaxCents,
                salesTax: -refundTaxCents,
                cbeTotal: 0,
                total: -refundAmountCents,
                paymentMethod: 'Cash' as any,
                status: 'completed',
                employeeId: currentEmployee?.id,
                employeeName: currentEmployee?.name,
                notes: `Post-edit refund — Repair ${(updated as any).ticketNumber || updated.id.slice(-6).toUpperCase()}`,
                refundReason: 'Post-edit refund',
                createdAt: now,
              };
              const nextSales = [...salesRef.current, refundSale];
              salesRef.current = nextSales;
              setSales(nextSales);
              persist.sale(refundSale.id, refundSale as unknown as Record<string, unknown>);
            }

            toast(t('repairs.refundMarkedSuccess'), 'success');
            setRefundConfirmTarget(null);
          }}
          onCancel={() => setRefundConfirmTarget(null)}
        />
      )}
    </>
  );
}
