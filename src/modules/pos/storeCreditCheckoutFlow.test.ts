// ============================================================
// P0-SC-1.1 — Owner-symptom integration chain (MAJOR 2)
//
// Reproduces the EXACT visible symptom end-to-end at the data layer:
//   Apply Store Credit selector → cart line (same shape POSModule's
//   handleApplyStoreCredit builds) → buildSale → finalizeSaleCore →
//   apply result the way POSModule does → REOPEN the selector.
//
// The selector logic is the REAL one the modal renders (redeemableEntries +
// redemptionCap from the ledger service — the modal consumes these same
// functions since P0-SC-1.1), so "next checkout offers $169.70, not $232.70"
// is asserted against the code path the cashier actually sees.
// ============================================================
import { describe, it, expect } from 'vitest';
import type { CartItem, Customer, Sale, StoreCreditLedger, StoreSettings } from '@/store/types';
import type { CartTotals } from './types';
import { issueLedgerEntry, redeemableEntries, redemptionCap, findCertificate } from '@/services/storeCredit/ledger';
import { buildSale } from './saleBuilder';
import { finalizeSaleCore } from './finalizeSaleCore';

const settings = { invoicePrefix: 'INV', taxRate: 0.0925, taxSettingsConfirmed: true } as unknown as StoreSettings;

function totals(totalCents: number): CartTotals {
  return {
    subtotal: totalCents, discountAmount: 0, manualDiscount: 0, loyaltyDiscount: 0,
    subtotalAfterDiscount: totalCents, salesTax: 0, utilityTax: 0, mobileSurcharge: 0,
    creditCardFee: 0, cbeFee: 0, screenFee: 0, total: 0,
  };
}

/** Same negative line POSModule.handleApplyStoreCredit appends. */
function applyCreditLine(entry: StoreCreditLedger, amountCents: number): CartItem {
  return {
    id: `line-${amountCents}`,
    name: `Store Credit (${entry.certificateNumber})`,
    category: 'exchange_credit',
    price: -amountCents,
    qty: 1,
    taxable: false,
    cbeEligible: false,
    storeCreditLedgerId: entry.id,
    storeCreditCertNumber: entry.certificateNumber,
  } as CartItem;
}

describe('store credit checkout flow — selector shows the debited balance on the NEXT checkout', () => {
  it('$232.70 issued → redeem $63 → selector offers $169.70 → redeem $50 → $119.70 → depleted cert disappears', () => {
    const customer = { id: 'c1', name: 'Jorge O', phone: '8055550000', storeCredit: 0, loyaltyPoints: 0 } as unknown as Customer;
    const issued = issueLedgerEntry({
      certificateNumber: 'SC-77777777-QAQA', amountCents: 23270,
      customerId: 'c1', customerName: 'Jorge O', employeeName: 'Emp',
    });
    let ledger: StoreCreditLedger[] = [issued];
    let sales: Sale[] = [];

    // ── Checkout 1: $63 payment fully covered by credit ──
    // Selector: cashier scans the cert; cap against a $63 cart is $63.
    const pick1 = findCertificate(redeemableEntries(ledger), 'sc-77777777-qaqa')!;
    expect(pick1).not.toBeNull();
    expect(redemptionCap(pick1, 6300)).toBe(6300);

    const sale1 = buildSale({
      cart: [
        { id: 'pp1', name: 'H2O Payment', category: 'phone_payment', price: 6300, qty: 1, taxable: false, cbeEligible: false } as CartItem,
        applyCreditLine(pick1, 6300),
      ],
      totals: totals(6300), paymentMethod: 'Cash', cashAmount: 0, cardAmount: 0,
      selectedCustomer: customer, currentEmployee: null, settings,
    });
    const r1 = finalizeSaleCore({
      sale: sale1, sales, inventory: [], customers: [customer], repairs: [], specialOrders: [],
      unlocks: [], layaways: [], storeCreditLedger: ledger, customerReturns: [],
      settings, selectedCustomer: customer, currentEmployee: null,
    });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    // Apply exactly the way POSModule does (§1 + §4e).
    sales = r1.nextSales;
    ledger = r1.storeCreditLedger;

    // ── The owner's exact check: reopen the selector on the next checkout ──
    const visible = redeemableEntries(ledger);
    expect(visible).toHaveLength(1);
    expect(visible[0].remainingAmount).toBe(16970);            // $169.70 — NOT $232.70
    expect(redemptionCap(visible[0], 99999)).toBe(16970);      // never offers more than remaining

    // ── Checkout 2: $50 more ──
    const pick2 = visible[0];
    const sale2 = buildSale({
      cart: [
        { id: 'pp2', name: 'H2O Payment', category: 'phone_payment', price: 5000, qty: 1, taxable: false, cbeEligible: false } as CartItem,
        applyCreditLine(pick2, 5000),
      ],
      totals: totals(5000), paymentMethod: 'Cash', cashAmount: 0, cardAmount: 0,
      selectedCustomer: customer, currentEmployee: null, settings,
    });
    const r2 = finalizeSaleCore({
      sale: sale2, sales, inventory: [], customers: [customer], repairs: [], specialOrders: [],
      unlocks: [], layaways: [], storeCreditLedger: ledger, customerReturns: [],
      settings, selectedCustomer: customer, currentEmployee: null,
    });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    sales = r2.nextSales;
    ledger = r2.storeCreditLedger;
    expect(redeemableEntries(ledger)[0].remainingAmount).toBe(11970);  // $119.70

    // ── Checkout 3: consume the rest → cert leaves the selector entirely ──
    const pick3 = redeemableEntries(ledger)[0];
    const sale3 = buildSale({
      cart: [
        { id: 'pp3', name: 'Accessory', category: 'accessory', price: 11970, qty: 1, taxable: false, cbeEligible: false } as CartItem,
        applyCreditLine(pick3, 11970),
      ],
      totals: totals(11970), paymentMethod: 'Cash', cashAmount: 0, cardAmount: 0,
      selectedCustomer: customer, currentEmployee: null, settings,
    });
    const r3 = finalizeSaleCore({
      sale: sale3, sales, inventory: [], customers: [customer], repairs: [], specialOrders: [],
      unlocks: [], layaways: [], storeCreditLedger: ledger, customerReturns: [],
      settings, selectedCustomer: customer, currentEmployee: null,
    });
    expect(r3.ok).toBe(true);
    if (!r3.ok) return;
    ledger = r3.storeCreditLedger;
    expect(ledger[0].status).toBe('redeemed');
    expect(ledger[0].remainingAmount).toBe(0);
    expect(redeemableEntries(ledger)).toHaveLength(0);          // zero balance → cannot be applied
    // Full audit trail survived: 3 redemptions against an immutable issuance.
    expect(ledger[0].issuedAmount).toBe(23270);
    expect(ledger[0].redemptions.map((r) => r.redeemedAmount)).toEqual([6300, 5000, 11970]);
  });
});
