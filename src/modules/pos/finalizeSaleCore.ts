// ============================================================
// CellHub Pro — finalizeSaleCore (R-FINALIZE-SALE-CORE-EXTRACT-SCOPED)
//
// Headless extraction of the GLOBAL data-mutation + reconciliation portion of
// POS checkout (POSModule.handleCompleteSale §pre-flight..§4f). It computes the
// updated business collections, the persist op-batches, and structured
// rejection reasons / side-effect payloads — but performs NO React setState, NO
// persist, NO toast, NO modals, NO window events, NO printing, NO LAN.
//
// Local POS (POSModule) applies the returned updates exactly as before and owns
// all UI effects (cart reset, receipt, toasts, navigation). A later Primary LAN
// dispatcher can apply the SAME updates headlessly, without touching the
// Primary POS UI. Behaviour MUST stay byte-identical to the pre-extraction
// handler — this file is a mechanical move, not a rewrite. No new money/tax math.
// ============================================================

import type {
  Sale, InventoryItem, Customer, Repair, SpecialOrder, Unlock, Layaway,
  StoreCreditLedger, CustomerReturn, Employee, StoreSettings, PendingExchangeReturn,
} from '@/store/types';
import { recordTopUpsToCustomer } from '@/utils/topUpHistory';
import { addLayawayPayment } from '@/services/layaway/payments';
import { redeemLedgerEntry } from '@/services/storeCredit/ledger';
import { finalizeExchangeReturn, type ExchangeFinalizationResult } from '@/services/returns/finalizeExchangeReturn';
import { forwardTaxFromBase } from '@/utils/depositTax';
import { isTaxableCheckoutBlocked } from './taxConfirmGuard';

export type FinalizeSaleRejectionReason =
  | 'tax_setup_required'
  | 'repair_cancelled'
  | 'repair_completed'
  | 'layaway_cancelled'
  | 'repair_overpayment';

/** One persist instruction (matches the batchSave op shape used by POSModule). */
export interface PersistOp {
  collection: string;
  id: string;
  data: Record<string, unknown>;
}

export interface FinalizeSaleCoreInput {
  sale: Sale;
  // Authoritative state arrays (POSModule passes its *Ref.current values).
  sales: Sale[];
  inventory: InventoryItem[];
  customers: Customer[];
  repairs: Repair[];
  specialOrders: SpecialOrder[];
  unlocks: Unlock[];
  layaways: Layaway[];
  storeCreditLedger: StoreCreditLedger[];
  customerReturns: CustomerReturn[];
  settings: StoreSettings;
  selectedCustomer: Customer | null;
  currentEmployee: Employee | null;
}

/** Side-effect INSTRUCTIONS (the caller performs the actual emission/service call). */
export interface FinalizeSaleSideEffects {
  /** window 'cellhub:operator-activity' detail payload. */
  operatorActivity: { customerId?: string; amountCents: number };
  /** key to pass to clearWorkflowTrack(); null = skip. */
  clearWorkflowTrack: 'phone_payment_portal' | null;
  /** addVerification() payload + nudge; null = no external phone payment. */
  phonePaymentVerify:
    | { saleId: string; customerName: string; carrier: string; amountCents: number; source: 'phone_payment' }
    | null;
}

export interface FinalizeSaleCoreSuccess {
  ok: true;
  saleId: string;
  // §1 — sales with the new sale appended (pre-exchange).
  nextSales: Sale[];
  // §2 — inventory after decrement (pre-exchange) + ops.
  inventory: InventoryItem[];
  inventoryOps: PersistOp[];
  // §3/5/6 — customer single-pass.
  customerChanged: boolean;
  customers: Customer[];
  workingCustomer: Customer | null;
  // §4a-e — linked entity reconciliation.
  repairs: Repair[]; repairOps: PersistOp[];
  specialOrders: SpecialOrder[]; specialOrderOps: PersistOp[];
  unlocks: Unlock[]; unlockOps: PersistOp[];
  layaways: Layaway[]; layawayOps: PersistOp[];
  storeCreditLedger: StoreCreditLedger[]; ledgerOps: PersistOp[];
  // §4f — exchange/return finalization (null when no pendingReturn drafts).
  exchange: ExchangeFinalizationResult | null;
  sideEffects: FinalizeSaleSideEffects;
}

export interface FinalizeSaleCoreFailure {
  ok: false;
  reason: FinalizeSaleRejectionReason;
  details?: Record<string, unknown>;
}

export type FinalizeSaleCoreResult = FinalizeSaleCoreSuccess | FinalizeSaleCoreFailure;

/**
 * Compute every global business mutation for a completed sale. Pure with
 * respect to inputs (returns new arrays; never mutates the passed-in arrays in
 * place beyond local copies, matching the original handler's `[...ref]` clones).
 */
export function finalizeSaleCore(input: FinalizeSaleCoreInput): FinalizeSaleCoreResult {
  const { sale, settings, selectedCustomer, currentEmployee } = input;

  // ── R-PRODUCTION-B4: block taxable checkout until tax setup is confirmed ──
  if (isTaxableCheckoutBlocked((settings as unknown as { taxSettingsConfirmed?: boolean }).taxSettingsConfirmed, sale.taxAmount)) {
    return { ok: false, reason: 'tax_setup_required' };
  }

  // ── Pre-flight: linked-entity status guards (cancelled repair / layaway) ──
  const repairIdsInSale = new Set<string>();
  const layawayIdsInSale = new Set<string>();
  for (const saleItem of sale.items) {
    if (saleItem.repairId) repairIdsInSale.add(saleItem.repairId);
    if (saleItem.layawayId) layawayIdsInSale.add(saleItem.layawayId);
  }
  for (const repairId of repairIdsInSale) {
    const repair = input.repairs.find((r) => r.id === repairId);
    if (!repair) continue;
    const freshStatus = String(repair.status || '').toLowerCase();
    if (freshStatus === 'cancelled') return { ok: false, reason: 'repair_cancelled', details: { repairId } };
    if (freshStatus === 'picked_up' || freshStatus === 'completed') return { ok: false, reason: 'repair_completed', details: { repairId } };
  }
  for (const layawayId of layawayIdsInSale) {
    const layaway = input.layaways.find((l) => l.id === layawayId);
    if (!layaway) continue;
    const freshStatus = String(layaway.status || '').toLowerCase();
    if (freshStatus === 'cancelled' || freshStatus === 'forfeited') return { ok: false, reason: 'layaway_cancelled', details: { layawayId } };
  }

  // ── Pre-flight: repair overpayment block (mirrors §4a math in block scope) ──
  {
    const _taxRate = settings.taxRate ?? 0.0925;
    let _discountableBase = 0;
    for (const si of sale.items) {
      if (si.category === 'phone_payment' || si.category === 'top_up') continue;
      _discountableBase += (si.price || 0) * (si.qty || 1);
    }
    const _saleDiscount = Math.max(0, (sale.subtotal || 0) - (sale.subtotalAfterDiscount ?? sale.subtotal ?? 0));
    const _discountRatio = _discountableBase > 0
      ? Math.max(0, (_discountableBase - _saleDiscount) / _discountableBase)
      : 1;
    const _repairPaid = new Map<string, number>();
    for (const si of sale.items) {
      if (!si.repairId) continue;
      const isDisc = si.category !== 'phone_payment' && si.category !== 'top_up';
      const effBase = isDisc ? Math.round((si.price || 0) * _discountRatio) : (si.price || 0);
      const fwd = forwardTaxFromBase(effBase, _taxRate, !!si.taxable);
      _repairPaid.set(si.repairId, (_repairPaid.get(si.repairId) || 0) + fwd.totalCents * (si.qty || (si as unknown as { quantity?: number }).quantity || 1));
    }
    for (const [_repairId, _paidCents] of _repairPaid) {
      const _repair = input.repairs.find((r) => r.id === _repairId);
      if (!_repair) continue;
      const _expected = _repair.balance || 0;
      if (_paidCents > _expected + 1) {
        console.warn(
          `[repair-reconcile] Overpayment pre-flight: repair ${_repairId}`,
          `paid ${_paidCents} cents, balance ${_expected} cents.`,
          `Diff: ${_paidCents - _expected} cents. Possible stale cart.`,
        );
        return { ok: false, reason: 'repair_overpayment', details: { repairId: _repairId, paidCents: _paidCents, balanceCents: _expected } };
      }
    }
  }

  // ── §1. Sale (append) + side-effect payloads ──
  const nextSales = [...input.sales, sale];

  const operatorActivity = { customerId: sale.customerId || undefined, amountCents: sale.total || 0 };

  let phonePaymentVerify: FinalizeSaleSideEffects['phonePaymentVerify'] = null;
  const externalPhoneItems = sale.items.filter((i) =>
    i.category === 'phone_payment'
    && typeof (i as unknown as { carrier?: unknown }).carrier === 'string'
    && String((i as unknown as { carrier?: string }).carrier).trim().length > 0,
  );
  if (externalPhoneItems.length > 0) {
    const carrier = String((externalPhoneItems[0] as unknown as { carrier?: string }).carrier).trim();
    const amountCents = externalPhoneItems.reduce((s, i) => s + (i.price || 0) * (i.qty || 1), 0);
    phonePaymentVerify = {
      saleId: sale.id,
      customerName: sale.customerName || selectedCustomer?.name || '',
      carrier,
      amountCents,
      source: 'phone_payment',
    };
  }

  // ── §2. Inventory decrement ──
  const updatedInventory = [...input.inventory];
  const inventoryOps: PersistOp[] = [];
  for (const saleItem of sale.items) {
    if (!saleItem.inventoryId) continue;
    const idx = updatedInventory.findIndex((i) => i.id === saleItem.inventoryId);
    if (idx >= 0 && updatedInventory[idx].category !== 'service') {
      if ((updatedInventory[idx].qty || 0) <= 0 && (saleItem.qty || 0) > 0) {
        // eslint-disable-next-line no-console
        console.warn(
          '[POS] Sale item with inventoryId but inventory qty already 0:',
          { name: saleItem.name, id: saleItem.inventoryId, soldQty: saleItem.qty },
        );
      }
      updatedInventory[idx] = {
        ...updatedInventory[idx],
        qty: Math.max(0, updatedInventory[idx].qty - saleItem.qty),
      };
      inventoryOps.push({ collection: 'inventory', id: updatedInventory[idx].id, data: updatedInventory[idx] as unknown as Record<string, unknown> });
    }
  }

  // ── §3 + §5 + §6. Customer single-pass (store credit, loyalty, top-up) ──
  let workingCustomers = input.customers;
  let workingCustomer = selectedCustomer;
  let customerChanged = false;

  // §3. Store credit deduction
  const isStoreCreditPayment = sale.paymentMethod === 'store_credit' || sale.paymentMethod === 'Store Credit';
  if (isStoreCreditPayment && selectedCustomer) {
    const creditUsed = Math.min(selectedCustomer.storeCredit || 0, sale.total);
    if (creditUsed > 0) {
      workingCustomer = { ...workingCustomer!, storeCredit: Math.max(0, (workingCustomer!.storeCredit || 0) - creditUsed) };
      workingCustomers = workingCustomers.map((c) => (c.id === workingCustomer!.id ? workingCustomer! : c));
      customerChanged = true;
    }
  }

  // §5. Loyalty points (1 pt per $1 of non-phone/non-topup base)
  if (sale.customerId && settings.loyaltyEnabled && workingCustomer) {
    const loyaltyBase = sale.items
      .filter((i) => i.category !== 'phone_payment' && i.category !== 'top_up')
      .reduce((sum, i) => sum + i.price * i.qty, 0);
    const pts = Math.trunc(loyaltyBase / 100);
    if (pts > 0) {
      workingCustomer = { ...workingCustomer, loyaltyPoints: (workingCustomer.loyaltyPoints || 0) + pts };
      workingCustomers = workingCustomers.map((c) => (c.id === workingCustomer!.id ? workingCustomer! : c));
      customerChanged = true;
    }
  }

  // §6. Top-up history
  if (sale.customerId && workingCustomer) {
    const topUpItems = sale.items.filter((i) => i.category === 'top_up');
    if (topUpItems.length > 0) {
      const updatedCustomer = recordTopUpsToCustomer(workingCustomer, topUpItems, new Date().toISOString());
      if (updatedCustomer !== workingCustomer) {
        workingCustomer = updatedCustomer;
        workingCustomers = workingCustomers.map((c) => (c.id === workingCustomer!.id ? workingCustomer! : c));
        customerChanged = true;
      }
    }
  }

  // ── §4. Linked entity reconciliation (discount ratio + tax-inclusive paid) ──
  const taxRateForReconcile = settings.taxRate ?? 0.0925;
  let discountableBaseSum = 0;
  for (const saleItem of sale.items) {
    if (saleItem.category === 'phone_payment' || saleItem.category === 'top_up') continue;
    discountableBaseSum += (saleItem.price || 0) * (saleItem.qty || 1);
  }
  const saleDiscountAmount = Math.max(0, (sale.subtotal || 0) - (sale.subtotalAfterDiscount ?? sale.subtotal ?? 0));
  const discountRatioForReconcile = discountableBaseSum > 0
    ? Math.max(0, (discountableBaseSum - saleDiscountAmount) / discountableBaseSum)
    : 1;
  const itemPaidCents = (item: Sale['items'][number]): number => {
    const isDiscountable = item.category !== 'phone_payment' && item.category !== 'top_up';
    const effectiveBase = isDiscountable ? Math.round((item.price || 0) * discountRatioForReconcile) : (item.price || 0);
    const fwd = forwardTaxFromBase(effectiveBase, taxRateForReconcile, !!item.taxable);
    return fwd.totalCents * (item.qty || (item as unknown as { quantity?: number }).quantity || 1);
  };

  // ── §4a. Repairs ──
  const updatedRepairs = [...input.repairs];
  const repairOps: PersistOp[] = [];
  const repairDeltas = new Map<string, number>();
  for (const saleItem of sale.items) {
    if (!saleItem.repairId) continue;
    repairDeltas.set(saleItem.repairId, (repairDeltas.get(saleItem.repairId) || 0) + itemPaidCents(saleItem));
  }
  for (const [repairId, paidCents] of repairDeltas) {
    const ri = updatedRepairs.findIndex((r) => r.id === repairId);
    if (ri < 0) continue;
    const repair = updatedRepairs[ri];
    const expectedBalance = repair.balance || 0;
    if (paidCents > expectedBalance + 1) {
      console.warn(
        `[repair-reconcile] Overpayment on repair ${repairId}:`,
        `paid ${paidCents} cents, balance was ${expectedBalance} cents.`,
        `Diff: ${paidCents - expectedBalance} cents (possible stale cart).`,
      );
    }
    const newDeposit = (repair.depositAmount || 0) + paidCents;
    const newBalance = Math.max(0, (repair.balance || 0) - paidCents);
    const nowIso = new Date().toISOString();
    updatedRepairs[ri] = {
      ...repair,
      depositAmount: newDeposit,
      balance: newBalance,
      status: newBalance === 0 ? 'picked_up' as const : repair.status,
      updatedAt: nowIso,
      completedAt: newBalance === 0 ? (repair.completedAt ?? nowIso) : repair.completedAt,
    };
    repairOps.push({ collection: 'repairTickets', id: updatedRepairs[ri].id, data: updatedRepairs[ri] as unknown as Record<string, unknown> });
  }

  // ── §4b. Special Orders ──
  const updatedSOs = [...input.specialOrders];
  const specialOrderOps: PersistOp[] = [];
  const soDeltas = new Map<string, number>();
  for (const saleItem of sale.items) {
    if (!saleItem.specialOrderId) continue;
    soDeltas.set(saleItem.specialOrderId, (soDeltas.get(saleItem.specialOrderId) || 0) + itemPaidCents(saleItem));
  }
  for (const [soId, paidCents] of soDeltas) {
    const si = updatedSOs.findIndex((o) => o.id === soId);
    if (si < 0) continue;
    const so = updatedSOs[si];
    const newDeposit = (so.depositAmount || 0) + paidCents;
    const newBalance = Math.max(0, (so.balance || 0) - paidCents);
    updatedSOs[si] = {
      ...so,
      depositAmount: newDeposit,
      balance: newBalance,
      payments: [
        ...(so.payments || []),
        { date: new Date().toISOString(), method: sale.paymentMethod, amountCents: paidCents },
      ],
      status: newBalance === 0 ? 'picked_up' : so.status,
      updatedAt: new Date().toISOString(),
    };
    specialOrderOps.push({ collection: 'specialOrders', id: updatedSOs[si].id, data: updatedSOs[si] as unknown as Record<string, unknown> });
  }

  // ── §4c. Unlocks ──
  const updatedUnlocks = [...input.unlocks];
  const unlockOps: PersistOp[] = [];
  const unlockDeltas = new Map<string, number>();
  for (const saleItem of sale.items) {
    if (!saleItem.unlockId) continue;
    unlockDeltas.set(saleItem.unlockId, (unlockDeltas.get(saleItem.unlockId) || 0) + itemPaidCents(saleItem));
  }
  for (const [unlockId, paidCents] of unlockDeltas) {
    const ui = updatedUnlocks.findIndex((u) => u.id === unlockId);
    if (ui < 0) continue;
    const unlock = updatedUnlocks[ui];
    const newDeposit = (unlock.depositAmount || 0) + paidCents;
    const newBalance = Math.max(0, (unlock.balance || 0) - paidCents);
    updatedUnlocks[ui] = { ...unlock, depositAmount: newDeposit, balance: newBalance, updatedAt: new Date().toISOString() };
    unlockOps.push({ collection: 'unlocks', id: updatedUnlocks[ui].id, data: updatedUnlocks[ui] as unknown as Record<string, unknown> });
  }

  // ── §4d. Layaways (paidAmount derived from payments[]; status → completed) ──
  const updatedLayaways = [...input.layaways];
  const layawayOps: PersistOp[] = [];
  const layawayDeltas = new Map<string, number>();
  for (const saleItem of sale.items) {
    if (!saleItem.layawayId) continue;
    layawayDeltas.set(saleItem.layawayId, (layawayDeltas.get(saleItem.layawayId) || 0) + itemPaidCents(saleItem));
  }
  for (const [layawayId, paidCents] of layawayDeltas) {
    const li = updatedLayaways.findIndex((l) => l.id === layawayId);
    if (li < 0) continue;
    const layaway = updatedLayaways[li];
    const depositMethodUpdate = layaway.depositMethod ? {} : { depositMethod: sale.paymentMethod };
    let withPaymentLog: typeof layaway = layaway;
    let helperSucceeded = false;
    try {
      withPaymentLog = addLayawayPayment(layaway, {
        amountCents: paidCents,
        method: sale.paymentMethod,
        employeeId: sale.employeeId,
        date: new Date().toISOString(),
      });
      helperSucceeded = true;
    } catch (err) {
      console.warn('[POS §4d] addLayawayPayment threw, falling back to legacy aggregate update:', err);
    }
    const reconciledPaid = helperSucceeded && Array.isArray(withPaymentLog.payments)
      ? withPaymentLog.payments.reduce((s, p) => s + (p.amount || 0), 0)
      : (layaway.paidAmount || 0) + paidCents;
    const newPaid = reconciledPaid;
    const newBalance = Math.max(0, (layaway.totalPrice || 0) - newPaid);
    const nowIsoLay = new Date().toISOString();
    updatedLayaways[li] = {
      ...withPaymentLog,
      ...depositMethodUpdate,
      paidAmount: newPaid,
      balance: newBalance,
      status: newBalance === 0 ? 'completed' : layaway.status,
      completedAt: newBalance === 0 ? (layaway.completedAt ?? nowIsoLay) : layaway.completedAt,
      updatedAt: nowIsoLay,
    };
    layawayOps.push({ collection: 'layaways', id: updatedLayaways[li].id, data: updatedLayaways[li] as unknown as Record<string, unknown> });
  }

  // ── §4e. Store-credit redemption ──
  let updatedLedger = input.storeCreditLedger;
  const ledgerOps: PersistOp[] = [];
  const ledgerDeltas = new Map<string, { cents: number; cert: string }>();
  for (const item of sale.items) {
    const lid = (item as unknown as { storeCreditLedgerId?: string }).storeCreditLedgerId;
    if (!lid) continue;
    const cert = (item as unknown as { storeCreditCertNumber?: string }).storeCreditCertNumber || '';
    const absCents = Math.abs((item.price || 0) * (item.qty || 1));
    if (absCents <= 0) continue;
    const prev = ledgerDeltas.get(lid);
    ledgerDeltas.set(lid, { cents: (prev?.cents || 0) + absCents, cert: cert || prev?.cert || '' });
  }
  if (ledgerDeltas.size > 0) {
    const ledgerCopy = [...input.storeCreditLedger];
    for (const [lid, { cents }] of ledgerDeltas) {
      const idx = ledgerCopy.findIndex((l) => l.id === lid);
      if (idx < 0) continue;
      try {
        const { ledger: nextLedger } = redeemLedgerEntry(ledgerCopy[idx], {
          amountCents: cents,
          saleId: sale.id,
          invoiceNumber: sale.invoiceNumber,
          employeeId: sale.employeeId,
          employeeName: sale.employeeName || currentEmployee?.name || '',
        });
        ledgerCopy[idx] = nextLedger;
        ledgerOps.push({ collection: 'storeCreditLedger', id: nextLedger.id, data: nextLedger as unknown as Record<string, unknown> });
      } catch (err) {
        console.warn('[POS §4e] redeemLedgerEntry rejected:', err);
      }
    }
    if (ledgerOps.length > 0) updatedLedger = ledgerCopy;
  }

  // ── §4f. Exchange/return finalization (uses threaded sales + inventory) ──
  const exchangeDrafts = sale.items
    .map((it) => (it as unknown as { pendingReturn?: PendingExchangeReturn }).pendingReturn)
    .filter((d): d is PendingExchangeReturn => !!d);
  let exchange: ExchangeFinalizationResult | null = null;
  if (exchangeDrafts.length > 0) {
    exchange = finalizeExchangeReturn({
      drafts: exchangeDrafts,
      sales: nextSales,
      inventory: updatedInventory,
      returns: input.customerReturns,
      exchangeSaleId: sale.id,
      exchangeInvoiceNumber: sale.invoiceNumber,
    });
  }

  return {
    ok: true,
    saleId: sale.id,
    nextSales,
    inventory: updatedInventory,
    inventoryOps,
    customerChanged,
    customers: workingCustomers,
    workingCustomer,
    repairs: updatedRepairs,
    repairOps,
    specialOrders: updatedSOs,
    specialOrderOps,
    unlocks: updatedUnlocks,
    unlockOps,
    layaways: updatedLayaways,
    layawayOps,
    storeCreditLedger: updatedLedger,
    ledgerOps,
    exchange,
    sideEffects: { operatorActivity, clearWorkflowTrack: 'phone_payment_portal', phonePaymentVerify },
  };
}
