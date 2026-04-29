// ============================================================
// CellHub Pro — Tax Reports Module
// Matches original app layout:
//   Left sidebar: Taxes/Impuestos | 1065/K-1/1040 | W-9 Form
//   1065 has horizontal tab bar: Overview | Income | Expenses | Inventory |
//     Members | 1065 | K1 | Sched L/M/C/SE | Schedule 1/2 | 1040 Sched C | CA 540
// ============================================================

import { useState, useMemo, useCallback } from 'react';
import { useApp } from '@/store/AppProvider';
import { useToast } from '@/components/ui/Toast';
import { getLabels } from '@/config/i18n';
import { useTranslation } from '@/i18n';
import { formatCurrency } from '@/utils/currency';
import { toDate } from '@/utils/dates';
import { usePrint } from '@/hooks/usePrint';
import { normalizeCarrier } from '@/utils/normalize';
import { calcMemberK1 } from './taxData';
import PartnershipMembersTab from './PartnershipMembersTab';
import TaxExpensesTab from './TaxExpensesTab';
import TaxIncomeTab from './TaxIncomeTab';
import TaxInventoryTab from './TaxInventoryTab';
import TaxCA540Tab from './TaxCA540Tab';
import Tax1040Tab from './Tax1040Tab';
import TaxScheduleCTab from './TaxScheduleCTab';
import TaxBalanceSheetTab from './TaxBalanceSheetTab';
import TaxScheduleMTab from './TaxScheduleMTab';

// ── Quarter config ────────────────────────────────────────
const QUARTERS = [
  { id: 'Q1', label: 'Q1 (Jan–Mar)', months: [0, 1, 2] },
  { id: 'Q2', label: 'Q2 (Apr–Jun)', months: [3, 4, 5] },
  { id: 'Q3', label: 'Q3 (Jul–Sep)', months: [6, 7, 8] },
  { id: 'Q4', label: 'Q4 (Oct–Dec)', months: [9, 10, 11] },
];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// r29b-1: HTML escape helper for handleW9Print interpolations.
// Pattern matches the local escHtml in EmployeeSection, ReceiptModal,
// ReturnsModule, ReportsModule (each module has its own copy — refactoring
// to a shared helper is deferred to a future polish round).
function escHtml(s: unknown): string {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function getCurrentQuarter() {
  const m = new Date().getMonth();
  if (m < 3) return 'Q1'; if (m < 6) return 'Q2'; if (m < 9) return 'Q3'; return 'Q4';
}

// ── 1065 horizontal tabs ──────────────────────────────────
const F1065_TABS = [
  { id: 'overview',   label: 'Overview' },
  { id: 'f1040',      label: '1040' },
  { id: 'income',     label: 'Income (Auto)' },
  { id: 'expenses',   label: 'Expenses' },
  { id: 'inventory',  label: 'Inventory' },
  { id: 'members',    label: 'Members' },
  { id: 'f1065',      label: '1065' },
  { id: 'k1',         label: 'K1' },
  { id: 'schedL',     label: 'Schedule L' },
  { id: 'schedM',     label: 'Schedule M' },
  { id: 'schedC',     label: 'Schedule C' },
  { id: 'schedSE',    label: 'Schedule SE' },
  { id: 'sched1',     label: 'Schedule 1' },
  { id: 'sched2',     label: 'Schedule 2' },
  { id: 'f1040C',     label: '1040 Schedule C' },
  { id: 'ca540',      label: 'CA Form 540' },
];

// ── Shared UI helpers ─────────────────────────────────────
function Row({ label, value, sub, color, bold, indent }: {
  label: string; value: string; sub?: string; color?: string; bold?: boolean; indent?: boolean;
}) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
      padding: '0.4rem 0', borderBottom: '1px solid rgba(255,255,255,0.04)',
      paddingLeft: indent ? '1.25rem' : 0,
    }}>
      <div>
        <span style={{ fontSize: bold ? '0.875rem' : '0.8rem', color: bold ? '#e2e8f0' : '#94a3b8', fontWeight: bold ? 700 : 400 }}>{label}</span>
        {sub && <div style={{ fontSize: '0.68rem', color: '#475569' }}>{sub}</div>}
      </div>
      <span style={{ fontSize: bold ? '0.95rem' : '0.875rem', fontWeight: bold ? 800 : 600, color: color || '#e2e8f0', marginLeft: '1rem', whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  );
}

function Card({ title, children, noPad }: { title?: string; children: React.ReactNode; noPad?: boolean }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.75rem', padding: noPad ? 0 : '1rem', marginBottom: '0.875rem', overflow: 'hidden' }}>
      {title && <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '0.75rem' }}>{title}</div>}
      {children}
    </div>
  );
}

function InfoBox({ children, color = 'blue' }: { children: React.ReactNode; color?: 'blue'|'amber'|'green'|'red' }) {
  const c = { blue: ['rgba(59,130,246,0.08)','rgba(59,130,246,0.25)','#93c5fd'], amber: ['rgba(251,191,36,0.08)','rgba(251,191,36,0.25)','#fcd34d'], green: ['rgba(34,197,94,0.08)','rgba(34,197,94,0.25)','#86efac'], red: ['rgba(239,68,68,0.08)','rgba(239,68,68,0.25)','#fca5a5'] }[color];
  return <div style={{ background: c[0], border: `1px solid ${c[1]}`, borderRadius: '0.625rem', padding: '0.875rem', marginBottom: '0.875rem' }}><p style={{ fontSize: '0.8rem', color: c[2], lineHeight: 1.6 }}>{children}</p></div>;
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.75rem', padding: '1rem' }}>
      <div style={{ fontSize: '0.68rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, marginBottom: '0.35rem' }}>{label}</div>
      <div style={{ fontSize: '1.5rem', fontWeight: 800, color: color || '#fff' }}>{value}</div>
      {sub && <div style={{ fontSize: '0.72rem', color: '#475569', marginTop: '0.2rem' }}>{sub}</div>}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════
export default function TaxReportsModule() {
  const { state: { sales, repairs, unlocks, inventory, employees, settings, lang, expenses }, setExpenses } = useApp();
  const { toast } = useToast();
  const L = getLabels(lang);
  const { t, locale } = useTranslation();
  const es = locale === 'es';
  const { printHtml } = usePrint();

  // r-print-audit: print the current section in a standalone window instead
  // of window.print() which would print the entire CellHub Pro UI.
  const printSection = useCallback((title: string) => {
    const el = document.getElementById('tax-print-area');
    if (!el) return;
    const html = `<!DOCTYPE html><html><head><title>${title}</title><style>
      @page{size:letter;margin:0.5in}*{margin:0;padding:0;box-sizing:border-box}
      body{font-family:Arial,sans-serif;font-size:10pt;color:#000;background:#fff;padding:0.25in}
      table{width:100%;border-collapse:collapse}th,td{padding:3px 6px;text-align:left;border-bottom:1px solid #ddd;font-size:9pt}
      th{background:#f5f5f5;font-weight:700}h1,h2,h3{margin:8px 0 4px}
      @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
    </style></head><body>${el.innerHTML}</body></html>`;
    printHtml(html, { silent: false, printer: settings.detectedPrinters?.[0] });
  }, [printHtml, settings]);

  const [activeSection, setActiveSection] = useState('ca_tax');  const [selectedQuarter, setSelectedQuarter] = useState(getCurrentQuarter());
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [f1065Tab, setF1065Tab] = useState('overview');

  const years = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);

  // ── Tax computation (matches original GOCELLULARAPP logic) ──
  const caTax = useMemo(() => {
    const quarter = QUARTERS.find((q) => q.id === selectedQuarter)!;
    const inQ = <T extends { createdAt: any }>(arr: T[]) =>
      arr.filter((x) => { const d = toDate(x.createdAt); return d.getFullYear() === selectedYear && quarter.months.includes(d.getMonth()); });

    // FIX 1: Don't filter by status='completed' — original filters by !voided only
    // R-RETURNS-F1.1: also exclude refunded sales — ReturnsModule marks the
    // original sale 'refunded' and creates a separate 'voided' refund sale.
    // Without this filter, CDTFA-401 report over-counts salesTax/utilityTax/
    // mobileSurcharge on refunded originals (tax that was reversed to the
    // customer but still reported to CDTFA as collected).
    const qSales = inQ(sales).filter((s) => s.status !== 'voided' && s.status !== 'refunded');

    let productSalesCount = 0, productSalesRevenue = 0, productSalesTax = 0;
    let phonePaymentsCount = 0, phonePaymentsRevenue = 0, phonePaymentsTax = 0, phonePaymentsMobilityFees = 0;
    let cbeTotal = 0, screenFeeTotal = 0;
    // R-IMPORT-REPAIR-REVENUE-PARITY: sales.items-sourced repair accumulators
    // (v1 architecture). Replaces qRepairs + balance=0 filter that missed
    // paid-via-sale repair transactions.
    let repairRevenueFromSales = 0;
    let repairCostFromSales = 0;
    let repairItemsCount = 0;

    for (const sale of qSales) {
      let saleHasPhonePayment = false;
      let saleHasProduct = false;
      let saleHasRepair = false;
      let salePhoneItemsRevenue = 0;
      let saleProductItemsRevenue = 0;
      let saleRepairItemsRevenue = 0;

      for (const item of (sale.items || [])) {
        const itemType = (item as any).type;
        const itemCategory = (item as any).category;
        const isPhone = itemType === 'phone_payment' || itemCategory === 'phone_payment';
        const isRepair = itemType === 'repair' || itemCategory === 'repair'
          || itemType === 'special_order' || itemCategory === 'special_order';
        const itemRevenue = ((item as any).price || 0) * ((item as any).qty || (item as any).quantity || 1);
        const qty = (item as any).qty || (item as any).quantity || 1;

        if (isPhone) {
          saleHasPhonePayment = true;
          salePhoneItemsRevenue += itemRevenue;
        } else if (isRepair) {
          saleHasRepair = true;
          saleRepairItemsRevenue += itemRevenue;
          repairItemsCount++;
          const itemCost = ((item as any).cost || 0) * qty;
          const fallbackCost = itemRevenue * 0.35;
          repairCostFromSales += itemCost > 0 ? itemCost : fallbackCost;
        } else {
          saleHasProduct = true;
          saleProductItemsRevenue += itemRevenue;
        }
      }

      // Add accumulated repair-items revenue for this sale
      repairRevenueFromSales += saleRepairItemsRevenue;

      if (saleHasProduct) {
        productSalesCount++;
        // On pure-product sales use saleSubtotal (captures discount + rounding).
        // On mixed sales use per-item revenue to avoid crediting product
        // with the phone/repair portion of the sale.
        const saleSubtotal = (sale as any).subtotalAfterDiscount ?? (sale as any).subtotal ?? sale.total ?? 0;
        const isMixed = saleHasPhonePayment || saleHasRepair;
        productSalesRevenue += isMixed ? saleProductItemsRevenue : saleSubtotal;
        // Sales tax always goes to Product Sales — even on mixed sales.
        // Sales tax is levied on the product portion, not the phone or repair portion.
        productSalesTax += (sale as any).salesTax || (isMixed ? 0 : ((sale as any).taxAmount || 0));
      }
      if (saleHasPhonePayment) {
        phonePaymentsCount++;
        const isMixed = saleHasProduct || saleHasRepair;
        phonePaymentsRevenue += isMixed ? salePhoneItemsRevenue : (sale.total || 0);
        phonePaymentsTax += (sale as any).utilityTax || 0;
        phonePaymentsMobilityFees += (sale as any).mobileSurcharge || 0;
      }

      cbeTotal += (sale as any).cbeFee || sale.cbeTotal || 0;
      screenFeeTotal += (sale as any).screenFee || (sale as any).screenFeeTotal || 0;
    }

    // salesRevenue = sum of sale.total, MINUS repair-items portion (which is
    // broken out into repairRevenue below), to avoid double-counting in
    // totalRevenue = salesRevenue + repairRevenue + unlockRevenue.
    const salesRevenue = qSales.reduce((s, sale) => s + (sale.total || 0), 0) - repairRevenueFromSales;

    const normStatus = (s: string) => s.toLowerCase().replace(/ /g, '_');
    // qRepairs retained for count/workflow display only (e.g. "X repairs this quarter").
    // Revenue now sourced from sales.items via repairRevenueFromSales.
    const qRepairs = inQ(repairs).filter((r) =>
      ['complete', 'completed', 'picked_up'].includes(normStatus(r.status)) && r.balance === 0 && !(r as any).paidViaSales
    );
    const qUnlocks = inQ(unlocks).filter((u) => normStatus((u as any).status) === 'completed');

    // R-IMPORT-REPAIR-REVENUE-PARITY: repairRevenue = sales.items-sourced
    const repairRevenue = repairRevenueFromSales;
    const unlockRevenue = qUnlocks.reduce((s, u) => s + ((u as any).price || 0), 0);
    const totalRevenue = salesRevenue + repairRevenue + unlockRevenue;

    // Tax totals — exactly matching CDTFA-401 lines
    const salesTax = qSales.reduce((s, sale) => s + ((sale as any).salesTax || 0), 0);
    const utilityTaxTotal = qSales.reduce((s, sale) => s + ((sale as any).utilityTax || 0), 0);
    const mobileSurchargeTotal = qSales.reduce((s, sale) => s + ((sale as any).mobileSurcharge || 0), 0);
    const totalTax = salesTax + utilityTaxTotal + mobileSurchargeTotal;
    const totalTaxDue = totalTax; // alias for render

    // Monthly breakdown
    const monthly = quarter.months.map((mi) => {
      const mSales = qSales.filter((s) => toDate(s.createdAt).getMonth() === mi);
      const gross = mSales.reduce((s, sale) => s + (sale.total || 0), 0);
      const taxable = mSales
        .filter((s) => !(s.items || []).some((i: any) => i.type === 'phone_payment' || i.category === 'phone_payment'))
        .reduce((s, sale) => s + ((sale as any).subtotal || 0), 0);
      const tax = mSales.reduce((s, sale) => s + ((sale as any).salesTax || 0), 0);
      return { month: MONTHS[mi], transactions: mSales.length, gross, taxable, tax };
    });

    return {
      quarter, qSales, qRepairs, qUnlocks,
      // Product sales
      productSalesCount, productSalesRevenue, productSalesTax,
      // Phone payments
      phonePaymentsCount, phonePaymentsRevenue, phonePaymentsTax, phonePaymentsMobilityFees,
      // Revenue totals
      salesRevenue, repairRevenue, unlockRevenue, totalRevenue,
      // Tax totals
      salesTax, utilityTaxTotal, mobileSurchargeTotal, totalTax, totalTaxDue,
      // Recycling fees (CBE)
      cbeTotal, screenFeeTotal, totalRecyclingFees: cbeTotal + screenFeeTotal,
      // Legacy aliases used in render
      productRevenue: productSalesRevenue, productTax: productSalesTax, productCount: productSalesCount,
      phoneRevenue: phonePaymentsRevenue, phoneTax: phonePaymentsTax, phoneSurcharge: phonePaymentsMobilityFees, phoneCount: phonePaymentsCount,
      serviceRevenue: 0, // included in productSalesRevenue
      monthly,
    };
  }, [sales, repairs, unlocks, selectedQuarter, selectedYear]);

  // ── Annual P&L (all values in CENTS to match sale.total units) ──
  const annual = useMemo(() => {
    const ySales = sales.filter((s) => {
      const d = toDate(s.createdAt);
      // R-RETURNS-F1.1: exclude refunded originals from annual P&L (same
      // rationale as quarterly filter — avoid over-reporting income that
      // was refunded to the customer).
      return d.getFullYear() === selectedYear && s.status !== 'voided' && s.status !== 'refunded';
    });
    // Per-item classification (matches quarterly caTax fix)
    let phoneGross = 0;
    let phoneNetCommission = 0;
    let productGross = 0;
    let productCOGS = 0;
    // R-IMPORT-REPAIR-REVENUE-PARITY: track repair revenue/cost from
    // sales.items[type='repair'|'special_order'] — matches v1 monolith
    // architecture (GOCELLULARAPP.html L34573-34629). Replaces the prior
    // `repairs[]` collection + balance=0 filter which undercounted revenue
    // (only ~50% of paid repairs passed) and produced $0 parts cost (v1 data
    // has empty parts[] arrays; cost lives on the transaction item instead).
    let repairRevenueFromSales = 0;
    let repairCostFromSales = 0;

    for (const sale of ySales) {
      for (const item of (sale.items || [])) {
        const itemType = (item as any).type;
        const itemCategory = (item as any).category;
        const isPhone = itemType === 'phone_payment' || itemCategory === 'phone_payment';
        const isRepair = itemType === 'repair' || itemCategory === 'repair'
          || itemType === 'special_order' || itemCategory === 'special_order';
        const amt = ((item as any).price || 0) * ((item as any).qty || (item as any).quantity || 1);
        const qty = (item as any).qty || (item as any).quantity || 1;

        if (isPhone) {
          phoneGross += amt;
          // R-COMMISSION-FIX-WRITE-AND-READ: trust stamped rate first
          // (transaction-time commission = source of truth). Only recompute
          // if stamped data is missing or invalid (legacy items, broken
          // writes from `?? 0` bug pre-fix).
          let rate = (item as any).commissionRate;
          if (rate == null || rate === 0) {
            // Stamped rate missing or zero — recompute from settings.
            // Normalize carrier first to handle legacy lowercase variants.
            let rawCarrier = ((item as any).carrier || (item as any).carrierName || '').trim();
            // Last-resort fallback: extract from item.name (v1 legacy compat)
            if (!rawCarrier && (item as any).name) {
              const match = String((item as any).name).match(/^([A-Za-z0-9\s&]+?)(?:\s*[-–]\s*|\s+Bill Payment)/i);
              if (match) rawCarrier = match[1].trim();
            }
            const normalized = normalizeCarrier(rawCarrier);
            const carrierRate = normalized
              ? settings.carrierCommissions?.[normalized]
              : undefined;
            rate = carrierRate
              ?? (settings as any).defaultCommissionRate
              ?? 0.07;
          }
          phoneNetCommission += amt * rate;
        } else if (isRepair) {
          repairRevenueFromSales += amt;
          const itemCost = ((item as any).cost || 0) * qty;
          // V1 fallback: if transactional cost is 0, assume 35% of revenue
          // (matches monolith `defaultRepairCostPct || 0.35`).
          const fallbackCost = amt * 0.35;
          repairCostFromSales += itemCost > 0 ? itemCost : fallbackCost;
        } else {
          productGross += amt;
          const cost = (item as any).cost || 0;
          productCOGS += cost * qty;
        }
      }
    }

    const phonePaidToCarrier = phoneGross - phoneNetCommission;
    const productProfit = productGross - productCOGS;

    // R-IMPORT-REPAIR-REVENUE-PARITY: repair revenue/cost sourced from the
    // sales.items loop above (v1 architecture). The `repairs[]` collection
    // is workflow-only — used for ticket UX (RepairModule, RepairModal) but
    // NOT for tax revenue accounting, to avoid double-counting when the
    // same repair is both a ticket AND a POS sale item.
    const repairRevenue = repairRevenueFromSales;
    const repairCOGS = repairCostFromSales;
    const repairProfit = repairRevenue - repairCOGS;

    const totalIncome = productProfit + phoneNetCommission + repairProfit;
    const yearExpenses = expenses.filter((e) => new Date(e.date).getFullYear() === selectedYear);
    const generalExpensesTotal = yearExpenses.reduce((s, e) => s + e.amount, 0); // already cents

    // ── Tax Center editable data (settings.taxData.byYear[year]) ──
    const yearKey = String(selectedYear);
    const taxYear = settings.taxData?.byYear?.[yearKey];

    const taxExpenses = taxYear?.expenses ?? [];
    const taxIncome = taxYear?.income ?? [];
    const taxSuppliers = taxYear?.suppliers ?? [];
    const taxReturns = taxYear?.returns ?? [];
    const taxInventory = taxYear?.inventory ?? { beginningInventory: 0, endingInventory: 0 };
    const taxAdjustments = taxYear?.adjustments ?? { otherIncome: 0, returnsRefunds: 0 };

    // Tax Center expenses (excluding Pass-through which is non-deductible)
    const taxExpensesDeductible = taxExpenses
      .filter((e: any) => e.category !== 'Pass-through')
      .reduce((s: number, e: any) => s + e.amount, 0);

    // Tax Center manual income (excluding Pass-Through Income)
    const taxIncomeAdditional = taxIncome
      .filter((i: any) => i.category !== 'Pass-Through Income')
      .reduce((s: number, i: any) => s + i.amount, 0);

    // Tax Center COGS calculation: beginning + supplier purchases - refunded returns - ending
    const taxSupplierTotal = taxSuppliers.reduce((s: number, x: any) => s + x.amount, 0);
    const taxReturnsRefunded = taxReturns
      .filter((r: any) => r.status === 'Refunded')
      .reduce((s: number, r: any) => s + r.amount, 0);
    const taxCOGS = taxInventory.beginningInventory + taxSupplierTotal - taxReturnsRefunded - taxInventory.endingInventory;

    // Combined totals (POS + Tax Center editable)
    const manualTotal = generalExpensesTotal + taxExpensesDeductible;

    // ── R-TAX-DISPLAY-PARITY: v1 parity breakdown ──────────
    // v1 split expense entries into two buckets for display:
    //   - 'Inventory/COGS' category → COGS bucket (combined w/ suppliers + inv delta)
    //   - everything else (ex Pass-through) → Operating Expenses bucket
    // Math unchanged: manualTotal still feeds netProfit identically.
    // These values exist purely for the Tax Year Summary cosmetic split.
    const taxExpensesCOGS = taxExpenses
      .filter((e: any) => e.category === 'Inventory/COGS')
      .reduce((s: number, e: any) => s + e.amount, 0);
    const taxExpensesOperating = taxExpenses
      .filter((e: any) => e.category !== 'Pass-through' && e.category !== 'Inventory/COGS')
      .reduce((s: number, e: any) => s + e.amount, 0);

    // v1 formula: cogs = max(0, beginInv + (expensesCOGS + suppliers − refundedReturns) − endInv)
    const cogsPurchasesV1 = taxExpensesCOGS + taxSupplierTotal - taxReturnsRefunded;
    const cogsV1 = Math.max(0, taxInventory.beginningInventory + cogsPurchasesV1 - taxInventory.endingInventory);
    const operatingExpensesV1 = generalExpensesTotal + taxExpensesOperating;

    // PRE-COGS total income for the Tax Year Summary display. Matches v1's
    // totalIncome semantic so `displayTotalIncome − cogsV1 − operatingExpensesV1`
    // equals netProfit (when GP=0 — GP deduction is v2-only per Form 1065 Line 23).
    const displayTotalIncome =
      totalIncome
      + taxIncomeAdditional
      + taxAdjustments.otherIncome
      - taxAdjustments.returnsRefunds;

    // Guaranteed payments to partners — Form 1065 Line 10 deduction.
    // Reduces ordinary business income (Line 23) but partners pay SE tax on them
    // separately via K-1 Box 4a + Box 14 Code A.
    const guaranteedPaymentsTotal = (settings.partnership?.members ?? [])
      .reduce((s, m) => s + (m.guaranteedPayments || 0), 0);

    // Total income includes:
    //   - POS profit (already net of POS COGS)
    //   - Manual income from Tax Center
    //   - Other income adjustment
    //   - MINUS returns/refunds adjustment
    //   - MINUS Tax Center COGS (additional inventory cost not captured in POS)
    const adjustedTotalIncome =
      totalIncome
      + taxIncomeAdditional
      + taxAdjustments.otherIncome
      - taxAdjustments.returnsRefunds
      - Math.max(0, taxCOGS); // only subtract positive COGS

    // netProfit = Form 1065 Line 23 (Ordinary Business Income/Loss)
    // = Total income (line 8) - Total deductions (line 21, includes GP on line 10)
    const netProfit = adjustedTotalIncome - manualTotal - guaranteedPaymentsTotal;

    // ── IRS Schedule C line mapping ──────────────────────────
    // Maps expense categories to official Schedule C line numbers
    // Reference: IRS Schedule C (Form 1040) 2024
    const SCHED_C_MAP: Record<string, { line: string; label: string }> = {
      rent:             { line: '20b', label: 'Rent or lease — business property' },
      utilities:        { line: '25',  label: 'Utilities' },
      payroll:          { line: '26',  label: 'Wages (less employment credits)' },
      parts_supplies:   { line: '22',  label: 'Supplies' },
      marketing:        { line: '8',   label: 'Advertising' },
      insurance:        { line: '15',  label: 'Insurance (other than health)' },
      equipment:        { line: '13',  label: 'Depreciation / Section 179' },
      carrier_fees:     { line: '10',  label: 'Commissions and fees' },
      software:         { line: '27a', label: 'Other expenses — Software/subscriptions' },
      professional_fees:{ line: '17',  label: 'Legal and professional services' },
      taxes_licenses:   { line: '23',  label: 'Taxes and licenses' },
      other:            { line: '27a', label: 'Other expenses' },
    };

    // Group expenses by Schedule C line
    const schedCLines = yearExpenses.reduce((acc, e) => {
      const mapping = SCHED_C_MAP[e.category] || { line: '27a', label: 'Other expenses' };
      const key = mapping.line;
      if (!acc[key]) acc[key] = { line: key, label: mapping.label, amount: 0, items: [] };
      acc[key].amount += e.amount;
      acc[key].items.push(e);
      return acc;
    }, {} as Record<string, { line: string; label: string; amount: number; items: any[] }>);

    // Sort by line number
    const schedCLinesSorted = Object.values(schedCLines).sort((a, b) => {
      const numA = parseFloat(a.line.replace(/[a-z]/g, ''));
      const numB = parseFloat(b.line.replace(/[a-z]/g, ''));
      return numA - numB;
    });

    // Inventory value (cost and retail in cents)
    const inventoryValue = inventory.reduce((s, i) => s + (i.cost || 0) * (i.qty || 0), 0);
    const inventoryRetail = inventory.reduce((s, i) => s + (i.price || 0) * (i.qty || 0), 0);

    return {
      phoneGross, phonePaidToCarrier, phoneNetCommission,
      productGross, productCOGS, productProfit,
      repairRevenue, repairCOGS, repairProfit,
      totalIncome, manualTotal, netProfit, guaranteedPaymentsTotal,
      inventoryValue, inventoryRetail,
      ySales,
      schedCLinesSorted, yearExpenses,
      // Tax Center editable data exposed for display
      adjustedTotalIncome,
      taxExpensesDeductible,
      taxIncomeAdditional,
      taxCOGS,
      taxAdjustments,
      generalExpensesTotal,
      // R-TAX-DISPLAY-PARITY: v1-parity display buckets
      displayTotalIncome,
      cogsV1,
      operatingExpensesV1,
      taxExpensesCOGS,
      taxExpensesOperating,
    };
  // r29b-1: granular deps. Previously this depended on the entire `settings`
  // object, so any unrelated settings edit (storeName, smsTemplate, etc.) would
  // re-run the entire annual P&L computation including loops over sales/repairs.
  }, [sales, repairs, inventory, expenses, selectedYear, settings.taxData, settings.partnership, settings.defaultCommissionRate]);

  // ── W-9 state ────────────────────────────────────────────
  const [w9, setW9] = useState({
    name: settings.storeName || '',
    businessName: '',
    classification: 'LLC',
    llcType: 'P',
    exemptPayee: '',
    fatcaCode: '',
    address: settings.storeAddress || '',
    city: settings.storeAddress ? '' : '',
    accountNumbers: '',
    ssn1: '', ssn2: '', ssn3: '',
    ein1: '', ein2: '',
    signature: '',
    date: new Date().toLocaleDateString(),
    requester: '',
  });

  const handleW9Print = () => {

    const f = {
      name:          w9.name,
      businessName:  w9.businessName || '',
      fedTaxClass:   w9.classification === 'LLC'                    ? 'LLC'
                   : w9.classification === 'Individual/Sole Proprietor' ? 'individual'
                   : w9.classification === 'C Corporation'          ? 'C'
                   : w9.classification === 'S Corporation'          ? 'S'
                   : w9.classification === 'Partnership'            ? 'Partnership'
                   : w9.classification === 'Trust/Estate'           ? 'Trust'
                   : 'Other',
      llcType:        w9.llcType || 'P',
      otherDesc:      '',
      exemptPayee:    w9.exemptPayee || '',
      exemptFATCA:    w9.fatcaCode   || '',
      address:        w9.address,
      cityStateZip:   w9.city,
      accountNumbers: w9.accountNumbers || '',
      ssn1:           w9.ssn1,
      ssn2:           w9.ssn2,
      ssn3:           w9.ssn3,
      ein1:           w9.ein1,
      ein2:           w9.ein2,
      signature:      w9.signature || '',
      signDate:       w9.date,
    };

    const chkd = (cond: boolean) => cond ? 'cb-checked' : '';
    const tick = (cond: boolean) => cond ? '&#10003;' : '';

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Form W-9</title>
<style>
@page { size: letter; margin: 0.25in; }
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: Arial, sans-serif; font-size: 8.46pt; color: #000; background:#fff; }
/* r-audit-r3: shrink-to-fit on letter (8.5×11). The W-9 content is ~750px
   tall at native size but browser rendering variance pushes it past the
   ~756px usable area. 93% scale guarantees single-page fit. */
.page { width:100%; transform: scale(0.93); transform-origin: top left; }
.header-bar { background:#000; color:#fff; display:flex; align-items:stretch; margin-bottom:3px; }
.header-left { padding:6px 8px; flex:1; }
.header-form-name { font-size:28pt; font-weight:900; letter-spacing:-0.5px; line-height:1; }
.header-rev { font-size:8.5pt; line-height:1.4; }
.header-center { flex:2; padding:6px 10px; border-left:1px solid #666; border-right:1px solid #666; display:flex; flex-direction:column; justify-content:center; }
.header-center-title { font-size:16pt; font-weight:900; text-align:center; line-height:1.2; }
.header-center-sub { font-size:8.5pt; text-align:center; margin-top:4px; }
.header-right { padding:6px 8px; font-size:8pt; width:150px; display:flex; align-items:center; }
.dept { font-size:8.5pt; font-weight:700; line-height:1.35; }
.section { border:1px solid #000; margin-bottom:3px; }
.section-inner { padding:3px 5px; }
.field-label { font-size:8pt; color:#000; line-height:1.3; }
.field-line { border-bottom:1px solid #000; min-height:17px; padding:2px 3px; font-size:9.5pt; }
.field-line-short { border-bottom:1px solid #000; min-height:17px; padding:2px 3px; font-size:9.5pt; display:inline-block; }
.checkbox-row { display:flex; align-items:center; gap:5px; flex-wrap:wrap; margin:3px 0; }
.cb { width:11px; height:11px; border:1px solid #000; display:inline-block; text-align:center; line-height:10px; font-size:9pt; flex-shrink:0; }
.cb-checked { background:#000; color:#fff; }
.part-header { background:#000; color:#fff; font-size:8.5pt; font-weight:700; padding:2px 5px; display:flex; justify-content:space-between; }
.tin-box { border:1px solid #000; display:inline-flex; align-items:center; padding:3px 8px; gap:6px; font-size:11pt; letter-spacing:1px; min-width:160px; }
.tin-dash { font-size:13pt; font-weight:700; padding:0 2px; }
.sign-line { border-bottom:2px solid #000; min-height:22px; font-size:11pt; padding:2px 3px; font-style:italic; }
.note-box { border:1px solid #000; padding:5px 7px; font-size:8pt; margin-bottom:3px; line-height:1.4; }
.bold { font-weight:700; }
.italic { font-style:italic; }
.underline { text-decoration:underline; }
@media print { body { -webkit-print-color-adjust:exact; print-color-adjust:exact; } }
</style></head><body>
<div class="page">

<div class="header-bar">
  <div class="header-left">
    <div class="header-form-name">Form W-9</div>
    <div class="header-rev">(Rev. March 2024)</div>
    <div class="header-rev">Department of the Treasury</div>
    <div class="header-rev">Internal Revenue Service</div>
  </div>
  <div class="header-center">
    <div class="header-center-title">Request for Taxpayer<br>Identification Number and Certification</div>
    <div class="header-center-sub"><span class="bold">Go to <span class="italic">www.irs.gov/FormW9</span> for instructions and the latest information.</span></div>
  </div>
  <div class="header-right">
    <div class="dept">Give form to the requester. Do not send to the IRS.</div>
  </div>
</div>

<div class="section">
  <div class="section-inner">
    <div class="field-label"><span class="bold">1</span> Name of entity/individual. An entry is required. (For a sole proprietor or disregarded entity, see the instructions on page 3.)</div>
    <div class="field-line">${escHtml(f.name)}</div>
  </div>
</div>

<div class="section">
  <div class="section-inner">
    <div class="field-label"><span class="bold">2</span> Business name/disregarded entity name, if different from above</div>
    <div class="field-line">${escHtml(f.businessName)}</div>
  </div>
</div>

<div style="display:flex; gap:0; margin-bottom:2px;">
  <div class="section" style="flex:3; margin-bottom:0; margin-right:2px;">
    <div class="section-inner">
      <div class="field-label"><span class="bold">3a</span> Check the appropriate box for federal tax classification of the entity/individual whose name is entered on line 1. Check only <span class="bold underline">one</span> of the following seven boxes.</div>
      <div class="checkbox-row" style="margin-top:3px;">
        <div class="cb ${chkd(f.fedTaxClass==='individual')}">${tick(f.fedTaxClass==='individual')}</div><span>Individual/sole proprietor</span>
        <div class="cb ${chkd(f.fedTaxClass==='C')}">${tick(f.fedTaxClass==='C')}</div><span>C Corporation</span>
        <div class="cb ${chkd(f.fedTaxClass==='S')}">${tick(f.fedTaxClass==='S')}</div><span>S Corporation</span>
        <div class="cb ${chkd(f.fedTaxClass==='Partnership')}">${tick(f.fedTaxClass==='Partnership')}</div><span>Partnership</span>
        <div class="cb ${chkd(f.fedTaxClass==='Trust')}">${tick(f.fedTaxClass==='Trust')}</div><span>Trust/estate</span>
      </div>
      <div class="checkbox-row">
        <div class="cb ${chkd(f.fedTaxClass==='LLC')}">${tick(f.fedTaxClass==='LLC')}</div>
        <span>Limited liability company. Enter the tax classification (C=C corporation, S=S corporation, P=Partnership) &#9658;</span>
        <span style="border-bottom:1px solid #000; min-width:20px; padding:0 4px; font-weight:700;">${f.fedTaxClass==='LLC' ? escHtml(f.llcType) : ''}</span>
      </div>
      <div style="font-size:7.5pt; margin-left:12px; margin-bottom:3px;"><span class="bold">Note:</span> Check the "LLC" box only if the LLC is classified as a single-member LLC that is disregarded from the owner OR if the LLC has filed Form 8832 or 2553 to be taxed as a corporation.</div>
      <div class="checkbox-row">
        <div class="cb ${chkd(f.fedTaxClass==='Other')}">${tick(f.fedTaxClass==='Other')}</div>
        <span>Other (see instructions) &#9658;</span>
        <span style="border-bottom:1px solid #000; min-width:80px; padding:0 4px;">${f.fedTaxClass==='Other' ? escHtml(f.otherDesc) : ''}</span>
      </div>
    </div>
  </div>
  <div class="section" style="flex:1; margin-bottom:0;">
    <div class="section-inner">
      <div class="field-label"><span class="bold">3b</span> If on line 3a you checked "Partnership" or "Trust/estate," or checked "LLC" and entered "P" as its tax classification, and you are providing this form to a partnership, trust, or estate in which you have an ownership interest, check this box if you have any foreign partners, owners, or beneficiaries. See instructions &#9658;</div>
      <div class="cb" style="margin-top:4px;">&nbsp;</div>
    </div>
  </div>
</div>

<div style="display:flex; gap:2px; margin-bottom:2px;">
  <div class="section" style="flex:1; margin-bottom:0;">
    <div class="section-inner">
      <div class="field-label"><span class="bold">4</span> Exemptions (codes apply only to certain entities, not individuals; see instructions on page 3):</div>
      <div style="margin-top:2px;">
        <div class="field-label">Exempt payee code (if any)</div>
        <div class="field-line-short" style="width:60px;">${escHtml(f.exemptPayee)}</div>
      </div>
      <div style="margin-top:2px;">
        <div class="field-label">Exemption from FATCA reporting code (if any)</div>
        <div class="field-line-short" style="width:60px;">${escHtml(f.exemptFATCA)}</div>
      </div>
      <div style="font-size:7.5pt; margin-top:3px; font-style:italic;">(Applies to accounts maintained outside the United States.)</div>
    </div>
  </div>
</div>

<div class="section">
  <div class="section-inner">
    <div class="field-label"><span class="bold">5</span> Address (number, street, and apt. or suite no.). See the instructions on page 4, for "Requester's name and address."</div>
    <div class="field-line">${escHtml(f.address)}</div>
  </div>
</div>

<div style="display:flex; gap:2px; margin-bottom:2px;">
  <div class="section" style="flex:2; margin-bottom:0;">
    <div class="section-inner">
      <div class="field-label"><span class="bold">6</span> City, state, and ZIP code</div>
      <div class="field-line">${escHtml(f.cityStateZip)}</div>
    </div>
  </div>
  <div class="section" style="flex:2; margin-bottom:0;">
    <div class="section-inner">
      <div class="field-label"><span class="bold">7</span> List account number(s) here (optional)</div>
      <div class="field-line">${escHtml(f.accountNumbers)}</div>
    </div>
  </div>
</div>

<div class="section" style="margin-bottom:3px;">
  <div class="part-header"><span>Part I &nbsp;&nbsp; Taxpayer Identification Number (TIN)</span></div>
  <div class="section-inner" style="display:flex; gap:10px; padding:5px;">
    <div style="flex:2; font-size:8pt; line-height:1.45;">
      Enter your TIN in the appropriate box. The TIN provided must match the name given on line 1 to avoid backup withholding. For individuals, this is generally your social security number (SSN). However, for a resident alien, sole proprietor, or disregarded entity, see the instructions for Part I, later. For other entities, it is your employer identification number (EIN). If you do not have a number, see <span class="italic bold">How to get a TIN</span>, later.<br><br>
      <span class="bold">Note:</span> If the account is in more than one name, see the instructions for line 1. See also <span class="italic">What Name and Number To Give the Requester</span> for guidelines on whose number to enter.
    </div>
    <div style="flex:1;">
      <div class="field-label bold" style="margin-bottom:4px;">Social security number</div>
      <div class="tin-box">
        <span>${f.ssn1 ? escHtml(f.ssn1) : '&nbsp;&nbsp;&nbsp;'}</span><div class="tin-dash">&#8211;</div><span>${f.ssn2 ? escHtml(f.ssn2) : '&nbsp;&nbsp;'}</span><div class="tin-dash">&#8211;</div><span>${f.ssn3 ? escHtml(f.ssn3) : '&nbsp;&nbsp;&nbsp;&nbsp;'}</span>
      </div>
      <div style="text-align:center; font-size:8.5pt; margin:5px 0;">or</div>
      <div class="field-label bold" style="margin-bottom:4px;">Employer identification number</div>
      <div class="tin-box">
        <span>${f.ein1 ? escHtml(f.ein1) : '&nbsp;&nbsp;'}</span><div class="tin-dash">&#8211;</div><span>${f.ein2 ? escHtml(f.ein2) : '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;'}</span>
      </div>
    </div>
  </div>
</div>

<div class="section" style="margin-bottom:3px;">
  <div class="part-header"><span>Part II &nbsp;&nbsp; Certification</span></div>
  <div class="section-inner" style="padding:5px;">
    <div style="font-size:8pt; line-height:1.45; margin-bottom:5px;">
      Under penalties of perjury, I certify that:<br>
      <span class="bold">1.</span> The number shown on this form is my correct taxpayer identification number (or I am waiting for a number to be issued to me); and<br>
      <span class="bold">2.</span> I am not subject to backup withholding because: (a) I am exempt from backup withholding, or (b) I have not been notified by the Internal Revenue Service (IRS) that I am subject to backup withholding as a result of a failure to report all interest or dividends, or (c) the IRS has notified me that I am no longer subject to backup withholding; and<br>
      <span class="bold">3.</span> I am a U.S. citizen or other U.S. person (defined below); and<br>
      <span class="bold">4.</span> The FATCA code(s) entered on this form (if any) indicating that I am exempt from FATCA reporting is correct.<br><br>
      <span class="bold">Certification instructions.</span> You must cross out item 2 above if you have been notified by the IRS that you are currently subject to backup withholding because you have failed to report all interest and dividends on your tax return. For real estate transactions, item 2 does not apply. For mortgage interest paid, acquisition or abandonment of secured property, cancellation of debt, contributions to an individual retirement arrangement (IRA), and generally, payments other than interest and dividends, you are not required to sign the certification, but you must provide your correct TIN. See the instructions for Part II, later.
    </div>
    <div style="display:flex; align-items:flex-end; gap:8px; margin-top:4px;">
      <div style="flex:2;">
        <div class="field-label bold">Signature of U.S. person &#9658;</div>
        <div class="sign-line">${escHtml(f.signature)}</div>
      </div>
      <div style="flex:1;">
        <div class="field-label bold">Date &#9658;</div>
        <div class="sign-line">${escHtml(f.signDate)}</div>
      </div>
    </div>
  </div>
</div>

<div class="note-box">
  <span class="bold">General Instructions</span><br>
  Section references are to the Internal Revenue Code unless otherwise noted.<br>
  <span class="bold">Future developments.</span> For the latest information about developments related to Form W-9 and its instructions, such as legislation enacted after they were published, go to <span class="italic">www.irs.gov/FormW9</span>.<br>
  <span class="bold">Purpose of form.</span> An individual or entity (Form W-9 requester) who is required to file an information return with the IRS is giving you this form because they must obtain your correct taxpayer identification number (TIN) to report on an information return the amount paid to you, or other amount reportable on an information return. See <span class="italic">How To Fill In This Form W-9</span>, later. <span class="bold">Cat. No. 10231X</span>
</div>

</div>
</body></html>`;

    printHtml(html, { silent: false, printer: settings.detectedPrinters?.[0] });
  };

  // ── Render ────────────────────────────────────────────────
  const NAV = [
    { id: 'ca_tax',  icon: '🏛️', label: t('tax.taxesNav'),        sub: t('tax.cdtfaQuarterlySub') },
    { id: 'f1065',   icon: '📊', label: '1065 / K-1 / 1040',  sub: t('tax.federalReturnsSub') },
    { id: 'w9',      icon: '📋', label: 'W-9 Form',            sub: t('tax.contractorTinSub') },
  ];

  return (
    <div style={{ display: 'flex', gap: '1rem', minHeight: 0 }}>

      {/* ── Left Sidebar ─────────────────────────────────── */}
      <div style={{ width: '200px', flexShrink: 0, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.875rem', padding: '0.5rem 0', alignSelf: 'flex-start', position: 'sticky', top: 0 }}>
        <div style={{ padding: '0.625rem 1rem 0.75rem', borderBottom: '1px solid rgba(255,255,255,0.07)', marginBottom: '0.25rem' }}>
          <div style={{ fontSize: '0.65rem', color: '#475569', fontWeight: 700, letterSpacing: '0.06em' }}>{t('tax.taxCenter')}</div>
        </div>
        {NAV.map((n) => (
          <button key={n.id} onClick={() => setActiveSection(n.id)} style={{ width: '100%', textAlign: 'left', padding: '0.6rem 1rem', background: activeSection === n.id ? 'rgba(102,126,234,0.15)' : 'transparent', border: 'none', borderLeft: `3px solid ${activeSection === n.id ? '#667eea' : 'transparent'}`, cursor: 'pointer', transition: 'all 0.15s' }}>
            <div style={{ fontSize: '0.825rem', fontWeight: 600, color: activeSection === n.id ? '#a5b4fc' : '#94a3b8', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <span>{n.icon}</span>{n.label}
            </div>
            <div style={{ fontSize: '0.67rem', color: '#475569', paddingLeft: '1.4rem' }}>{n.sub}</div>
          </button>
        ))}
        <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid rgba(255,255,255,0.07)', marginTop: '0.5rem' }}>
          <label style={{ fontSize: '0.65rem', color: '#475569', display: 'block', marginBottom: '0.3rem' }}>{t('tax.taxYear')}</label>
          <select value={selectedYear} onChange={(e) => setSelectedYear(+e.target.value)} className="select" style={{ width: '100%', fontSize: '0.8rem' }}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {/* ── Main Content ─────────────────────────────────── */}
      <div id="tax-print-area" style={{ flex: 1, minWidth: 0, overflowY: 'auto', paddingBottom: '2rem' }}>

        {/* ═══════════════════════════════════════════════ */}
        {/* CA TAX REPORTS                                  */}
        {/* ═══════════════════════════════════════════════ */}
        {activeSection === 'ca_tax' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
              <div>
                <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#fff', marginBottom: '0.2rem' }}>{t('tax.taxesNav')}</h1>
                <p style={{ fontSize: '0.8rem', color: '#64748b' }}>{t('tax.caSalesTaxQuarterly')}</p>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button onClick={() => printSection(t('tax.taxReportTitle'))} className="btn btn-secondary" style={{ fontSize: '0.8rem' }}>🖨️ {t('tax.printReport')}</button>
                {/* r29b-1: removed dead "Export Report" button (had no onClick handler) */}
              </div>
            </div>

            {/* Quarter + Year */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
              <div>
                <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem' }}>{t('tax.selectQuarter')}</label>
                <select value={selectedQuarter} onChange={(e) => setSelectedQuarter(e.target.value)} className="select">
                  {QUARTERS.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem' }}>{t('tax.selectYear')}</label>
                <select value={selectedYear} onChange={(e) => setSelectedYear(+e.target.value)} className="select">
                  {years.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </div>

            {/* 4 stat cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '0.75rem', marginBottom: '1rem' }}>
              <StatCard label={t('tax.grossSalesStat')} value={formatCurrency(caTax.totalRevenue)} sub={t('tax.transactionsSub', caTax.qSales.length)} />
              <StatCard label={t('tax.taxableSales')} value={formatCurrency(caTax.productRevenue)} sub={t('tax.beforeTaxSub')} color="#60a5fa" />
              <StatCard label={t('tax.taxRateStat')} value={`${((settings.taxRate ?? 0.0925)*100).toFixed(4)}%`} sub={t('caSalesTax')} color="#a78bfa" />
              <StatCard label={t('tax.taxToRemit')} value={formatCurrency(caTax.productTax)} sub={t('tax.salesTaxOnlySub', ((settings.taxRate ?? 0.0925)*100).toFixed(2))} color="#f87171" />
            </div>

            {/* Transaction Breakdown table */}
            <Card title={`📊 ${t('tax.transactionBreakdown')}`}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                    <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: '#64748b', fontWeight: 600, fontSize: '0.72rem' }}>{t('tax.transactionType')}</th>
                    <th style={{ textAlign: 'right', padding: '0.5rem 0.75rem', color: '#64748b', fontWeight: 600, fontSize: '0.72rem' }}>{t('tax.countHeader')}</th>
                    <th style={{ textAlign: 'right', padding: '0.5rem 0.75rem', color: '#64748b', fontWeight: 600, fontSize: '0.72rem' }}>{t('tax.revenueHeader')}</th>
                    <th style={{ textAlign: 'right', padding: '0.5rem 0.75rem', color: '#64748b', fontWeight: 600, fontSize: '0.72rem' }}>{t('tax.taxesAndFees')}</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { icon: '🛒', name: t('tax.productSales'), sub: t('tax.phonesAccessories'), count: caTax.productCount, rev: caTax.productRevenue, tax: caTax.productTax, taxLabel: t('tax.salesTaxTaxLabel') },
                    { icon: '📱', name: t('tax.phoneBillPayments'), sub: 'AT&T, T-Mobile, Verizon, etc.', count: caTax.phoneCount, rev: caTax.phoneRevenue, tax: caTax.phoneTax + caTax.phoneSurcharge, taxLabel: `Utility: ${formatCurrency(caTax.phoneTax)}\nCA Fee: ${formatCurrency(caTax.phoneSurcharge)}` },
                    { icon: '🔧', name: t('tax.repairServices'), sub: t('tax.completedRepairs'), count: caTax.qRepairs.length, rev: caTax.repairRevenue, tax: 0, taxLabel: t('tax.noTaxService') },
                    { icon: '🔓', name: t('tax.unlockServices'), sub: t('tax.completedUnlocks'), count: caTax.qUnlocks.length, rev: caTax.unlockRevenue, tax: 0, taxLabel: t('tax.noTax') },
                  ].map((row, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding: '0.75rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span>{row.icon}</span>
                          <div>
                            <div style={{ color: '#e2e8f0', fontWeight: 600 }}>{row.name}</div>
                            <div style={{ fontSize: '0.72rem', color: '#475569' }}>{row.sub}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ textAlign: 'right', padding: '0.75rem', color: '#94a3b8' }}>{row.count}</td>
                      <td style={{ textAlign: 'right', padding: '0.75rem', color: '#e2e8f0', fontWeight: 600 }}>{formatCurrency(row.rev)}</td>
                      <td style={{ textAlign: 'right', padding: '0.75rem', color: row.tax > 0 ? '#f87171' : '#475569', fontSize: '0.78rem' }}>
                        <div style={{ fontWeight: 700 }}>{formatCurrency(row.tax)}</div>
                        <div style={{ whiteSpace: 'pre-line', fontSize: '0.68rem' }}>{row.taxLabel}</div>
                      </td>
                    </tr>
                  ))}
                  {(() => {
                    const rows = [
                      { count: caTax.productCount, rev: caTax.productRevenue, tax: caTax.productTax },
                      { count: caTax.phoneCount, rev: caTax.phoneRevenue, tax: caTax.phoneTax + caTax.phoneSurcharge },
                      { count: caTax.qRepairs.length, rev: caTax.repairRevenue, tax: 0 },
                      { count: caTax.qUnlocks.length, rev: caTax.unlockRevenue, tax: 0 },
                    ];
                    const totCount = rows.reduce((s, r) => s + r.count, 0);
                    const totRev = rows.reduce((s, r) => s + r.rev, 0);
                    const totTax = rows.reduce((s, r) => s + r.tax, 0);
                    return (
                      <tr style={{ background: 'rgba(255,255,255,0.04)', fontWeight: 700 }}>
                        <td style={{ padding: '0.75rem', color: '#e2e8f0' }}>{t('tax.totalLabel')}</td>
                        <td style={{ textAlign: 'right', padding: '0.75rem', color: '#e2e8f0' }}>{totCount}</td>
                        <td style={{ textAlign: 'right', padding: '0.75rem', color: '#e2e8f0' }}>{formatCurrency(totRev)}</td>
                        <td style={{ textAlign: 'right', padding: '0.75rem', color: '#f87171' }}>{formatCurrency(totTax)}</td>
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
            </Card>

            {/* Revenue Breakdown bars */}
            <Card title={t('tax.revenueBreakdownByCategory')}>
              {[
                { label: t('tax.productSales'), sub: t('tax.transactionsSub', caTax.productCount), value: caTax.productRevenue, tax: caTax.productTax, total: caTax.totalRevenue },
                { label: t('tax.repairServices'), sub: t('tax.repairsSub', caTax.qRepairs.length), value: caTax.repairRevenue, tax: 0, total: caTax.totalRevenue },
                { label: t('tax.unlockServices'), sub: t('tax.unlocksSub', caTax.qUnlocks.length), value: caTax.unlockRevenue, tax: 0, total: caTax.totalRevenue },
                { label: t('tax.phonePayments'), sub: t('tax.paymentsSub', caTax.phoneCount), value: caTax.phoneRevenue, tax: caTax.phoneTax + caTax.phoneSurcharge, total: caTax.totalRevenue },
              ].map((item, i) => (
                <div key={i} style={{ marginBottom: '0.875rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                    <div><div style={{ fontSize: '0.85rem', color: '#e2e8f0', fontWeight: 600 }}>{item.label}</div><div style={{ fontSize: '0.7rem', color: '#475569' }}>{item.sub}</div></div>
                    <div style={{ textAlign: 'right' }}><div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#22c55e' }}>{formatCurrency(item.value)}</div><div style={{ fontSize: '0.7rem', color: '#f87171' }}>{t('tax.taxPrefixLabel')} {formatCurrency(item.tax)}</div></div>
                  </div>
                  <div style={{ height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${item.total > 0 ? (item.value / item.total * 100) : 0}%`, background: 'linear-gradient(90deg, #667eea, #22c55e)', borderRadius: '3px', transition: 'width 0.5s' }} />
                  </div>
                </div>
              ))}
            </Card>

            {/* California CDTFA Form Summary */}
            <Card title={t('californiaCdtfaFormSummary')}>
              <Row label={t('tax.cdtfaLine1')} value={formatCurrency(caTax.productRevenue)} bold />
              <Row label={t('tax.cdtfaLine2')} value={`${((settings.taxRate ?? 0.0925)*100).toFixed(4)}%`} />
              <Row label={t('tax.cdtfaLine3')} value={formatCurrency(caTax.productTax)} color="#f87171" bold />
              <InfoBox color="amber">
                {t('tax.cdtfaReminder', selectedQuarter, selectedYear)}
              </InfoBox>
            </Card>

            {/* Payment Reference Information */}
            <Card noPad>
              <div style={{ padding: '1rem', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: '0.875rem', fontWeight: 700, color: '#fbbf24' }}>{t('tax.paymentRefInfo')}</div>
                <button className="btn btn-secondary btn-sm" style={{ fontSize: '0.75rem' }} onClick={async () => {
                  const text = `Product Sales (Taxable): ${formatCurrency(caTax.productRevenue)}\nPhone Bill Payments (Utility): ${formatCurrency(caTax.phoneRevenue)}\nSales Tax (${((settings.taxRate||0.0925)*100).toFixed(2)}%): ${formatCurrency(caTax.productTax)}\nUtility Tax: ${formatCurrency(caTax.phoneTax)}\nTotal Tax: ${formatCurrency(caTax.totalTaxDue)}`;
                  // r29b-1: try/catch + toast feedback. Clipboard API can reject silently
                  // when permission is denied (HTTPS issues, iframes, mobile browsers).
                  try {
                    await navigator.clipboard.writeText(text);
                    toast(t('tax.copiedClipboard'), 'success');
                  } catch (err) {
                    console.warn('[Tax] clipboard.writeText failed:', err);
                    toast(t('tax.copyClipboardError'), 'error');
                  }
                }}>{t('tax.copyPaymentInfoBtn')}</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', padding: '1rem', gap: '1rem' }}>
                <div>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', marginBottom: '0.5rem' }}>{t('tax.salesBreakdownTitle')}</div>
                  {[
                    [t('tax.productSalesTaxable'), formatCurrency(caTax.productRevenue)],
                    [t('tax.phoneBillPaymentsUtility'), formatCurrency(caTax.phoneRevenue)],
                    [t('tax.repairServicesNoTax'), formatCurrency(caTax.repairRevenue)],
                    [t('tax.unlockServicesNoTax'), formatCurrency(caTax.unlockRevenue)],
                    [t('tax.totalGrossSales'), formatCurrency(caTax.totalRevenue)],
                  ].map(([l, v]) => (
                    <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', padding: '0.2rem 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <span style={{ color: '#94a3b8' }}>{l}</span><span style={{ color: '#e2e8f0', fontWeight: 600 }}>{v}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', marginBottom: '0.5rem' }}>{t('tax.taxesCollectedTitle')}</div>
                  {[
                    [`${t('tax.salesTaxTaxLabel')} (${((settings.taxRate||0.0925)*100).toFixed(4)}%):`, formatCurrency(caTax.productTax)],
                    [`${t('tax.utilityUsersTax')} (${((settings.utilityUsersTax||0.055)*100).toFixed(2)}%):`, formatCurrency(caTax.phoneTax)],
                    [`${t('tax.caMobilityFee')} ($${(settings.mobileSurcharge||0.41).toFixed(2)} ea):`, formatCurrency(caTax.phoneSurcharge)],
                    [t('tax.totalTaxCollectedRow'), formatCurrency(caTax.totalTaxDue)],
                  ].map(([l, v]) => (
                    <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', padding: '0.2rem 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <span style={{ color: '#94a3b8' }}>{l}</span><span style={{ color: '#f87171', fontWeight: 600 }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* CDTFA mini form */}
              <div style={{ margin: '0 1rem 1rem', padding: '0.75rem', background: 'rgba(102,126,234,0.06)', border: '1px solid rgba(102,126,234,0.2)', borderRadius: '0.5rem', fontSize: '0.78rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  <div><span style={{ color: '#64748b' }}>{t('tax.cdtfaMiniLine1')}</span> <span style={{ color: '#e2e8f0' }}>{formatCurrency(caTax.totalRevenue)}</span></div>
                  <div><span style={{ color: '#64748b' }}>{t('tax.cdtfaMiniLine2')}</span> <span style={{ color: '#e2e8f0' }}>{formatCurrency(caTax.productRevenue)}</span></div>
                  <div><span style={{ color: '#64748b' }}>{t('tax.cdtfaMiniLine3')}</span> <span style={{ color: '#e2e8f0' }}>{((settings.taxRate||0.0925)*100).toFixed(4)}%</span></div>
                  <div><span style={{ color: '#64748b' }}>{t('tax.cdtfaMiniLine4')}</span> <span style={{ color: '#f87171', fontWeight: 700 }}>{formatCurrency(caTax.productTax)}</span></div>
                </div>
              </div>
              {/* Payment summary box */}
              <div style={{ margin: '0 1rem 1rem', padding: '0.75rem', background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: '0.5rem', fontSize: '0.78rem' }}>
                <div style={{ color: '#86efac', fontWeight: 700, marginBottom: '0.5rem', fontSize: '0.85rem' }}>
                  $ {t('tax.totalDueCDTFA')}: {formatCurrency(caTax.totalTaxDue)}
                </div>
                <div style={{ color: '#94a3b8', fontSize: '0.72rem', marginBottom: '0.4rem' }}>
                  {t('tax.cdtfaForms3Header')}
                </div>
                <div style={{ color: '#cbd5e1', paddingLeft: '0.5rem', borderLeft: '2px solid rgba(34,197,94,0.3)' }}>
                  <div>• <strong>CDTFA-401</strong> ({t('tax.cdtfa401Label')}): {formatCurrency(caTax.salesTax)}</div>
                  <div>• <strong>CDTFA-501-LA</strong> (UUT Prepaid MTS → City of SB): {formatCurrency(caTax.utilityTaxTotal)}</div>
                  <div>• <strong>ETUS Return</strong> (911/988 + {t('tax.mobilityLabel')}): {formatCurrency(caTax.mobileSurchargeTotal)}</div>
                </div>
                <div style={{ color: '#94a3b8', marginTop: '0.5rem', fontSize: '0.7rem' }}>
                  {t('tax.dueDateHint')}
                </div>
                <div style={{ color: '#94a3b8', fontSize: '0.7rem' }}>onlineservices.cdtfa.ca.gov</div>
              </div>
            </Card>

            {/* Monthly Breakdown */}
            <Card title={t('tax.monthlyBreakdown')}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                    {[
                      { key: 'month', label: t('tax.monthHeader') },
                      { key: 'transactions', label: t('tax.transactionsHeader') },
                      { key: 'gross', label: t('tax.grossSalesHeader') },
                      { key: 'taxable', label: t('tax.taxableAmountHeader') },
                      { key: 'tax', label: t('tax.taxCollectedHeader') },
                    ].map((h) => (
                      <th key={h.key} style={{ textAlign: h.key === 'month' ? 'left' : 'right', padding: '0.5rem 0.75rem', color: '#64748b', fontWeight: 600, fontSize: '0.7rem' }}>{h.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {caTax.monthly.map((m) => (
                    <tr key={m.month} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding: '0.625rem 0.75rem', color: '#e2e8f0', fontWeight: 600 }}>{t(m.month.toLowerCase())}</td>
                      <td style={{ textAlign: 'right', padding: '0.625rem 0.75rem', color: '#94a3b8' }}>{m.transactions}</td>
                      <td style={{ textAlign: 'right', padding: '0.625rem 0.75rem', color: '#e2e8f0' }}>{formatCurrency(m.gross)}</td>
                      <td style={{ textAlign: 'right', padding: '0.625rem 0.75rem', color: '#e2e8f0' }}>{formatCurrency(m.taxable)}</td>
                      <td style={{ textAlign: 'right', padding: '0.625rem 0.75rem', color: m.tax > 0 ? '#f87171' : '#475569', fontWeight: 600 }}>{formatCurrency(m.tax)}</td>
                    </tr>
                  ))}
                  <tr style={{ background: 'rgba(255,255,255,0.04)', fontWeight: 700 }}>
                    <td style={{ padding: '0.625rem 0.75rem', color: '#e2e8f0' }}>{t('tax.totalRow')}</td>
                    <td style={{ textAlign: 'right', padding: '0.625rem 0.75rem', color: '#e2e8f0' }}>{caTax.monthly.reduce((s,m)=>s+m.transactions,0)}</td>
                    <td style={{ textAlign: 'right', padding: '0.625rem 0.75rem', color: '#22c55e' }}>{formatCurrency(caTax.monthly.reduce((s,m)=>s+m.gross,0))}</td>
                    <td style={{ textAlign: 'right', padding: '0.625rem 0.75rem', color: '#22c55e' }}>{formatCurrency(caTax.monthly.reduce((s,m)=>s+m.taxable,0))}</td>
                    <td style={{ textAlign: 'right', padding: '0.625rem 0.75rem', color: '#f87171' }}>{formatCurrency(caTax.monthly.reduce((s,m)=>s+m.tax,0))}</td>
                  </tr>
                </tbody>
              </table>
            </Card>
          </div>
        )}

        {/* ═══════════════════════════════════════════════ */}
        {/* 1065 / K-1 / 1040                              */}
        {/* ═══════════════════════════════════════════════ */}
        {activeSection === 'f1065' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.875rem' }}>
              <div>
                <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#fff', marginBottom: '0.2rem' }}>1065 / K-1 / 1040</h1>
                <p style={{ fontSize: '0.8rem', color: '#64748b' }}>{t('tax.federalTaxYear', selectedYear)}</p>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button onClick={() => printSection('1065 / K-1 / 1040')} className="btn btn-secondary" style={{ fontSize: '0.78rem' }}>🖨️ {t('tax.printPackage')}</button>
                {/* r29b-1: removed dead "Export Year-End Package" button (had no onClick handler) */}
              </div>
            </div>

            {/* Horizontal tab bar */}
            <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginBottom: '1rem', padding: '0.35rem', background: 'rgba(255,255,255,0.03)', borderRadius: '0.625rem', border: '1px solid rgba(255,255,255,0.08)' }}>
              {F1065_TABS.map((t) => (
                <button key={t.id} onClick={() => setF1065Tab(t.id)} style={{
                  padding: '0.4rem 0.75rem', borderRadius: '0.4rem', fontSize: '0.75rem', fontWeight: 600,
                  border: 'none', cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap',
                  background: f1065Tab === t.id ? '#667eea' : 'transparent',
                  color: f1065Tab === t.id ? '#fff' : '#64748b',
                }}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* ── Overview tab ── */}
            {f1065Tab === 'overview' && (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '0.75rem', marginBottom: '1rem' }}>
                  <StatCard label={t('tax.posRevenue')} value={formatCurrency(annual.productGross + annual.phoneGross + annual.repairRevenue)} sub={t('tax.transactionsSub', annual.ySales.length)} color="#22c55e" />
                  <StatCard label={t('tax.posCogs')} value={formatCurrency(annual.productCOGS + annual.repairCOGS + annual.phonePaidToCarrier)} sub={t('tax.inventoryCarriersSub', ((annual.productCOGS + annual.repairCOGS) / 100).toFixed(0), (annual.phonePaidToCarrier / 100).toFixed(0))} color="#f87171" />
                  <StatCard label={t('tax.posProfit')} value={formatCurrency(annual.totalIncome)} sub={t('tax.revenueCostSub')} color="#60a5fa" />
                  <StatCard label={t('tax.manualIncome')} value={formatCurrency(annual.taxIncomeAdditional)} sub={t('tax.entriesSub', (settings.taxData?.byYear?.[String(selectedYear)]?.income ?? []).length)} color="#94a3b8" />
                </div>

                <Card title={t('tax.posRevenueBreakdown')}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '0.75rem' }}>
                    <div style={{ padding: '0.875rem', background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.15)', borderRadius: '0.625rem' }}>
                      <div style={{ fontSize: '0.7rem', color: '#fbbf24', fontWeight: 700, marginBottom: '0.35rem' }}>{t('tax.phonePaymentsCard')}</div>
                      <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#fff' }}>{formatCurrency(annual.phoneNetCommission)}</div>
                      <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.25rem' }}>{t('tax.grossCollected')} {formatCurrency(annual.phoneGross)}</div>
                      <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{t('tax.paidToCarrier')} {formatCurrency(annual.phonePaidToCarrier)}</div>
                      <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{t('tax.netCommissionKept')} {formatCurrency(annual.phoneNetCommission)}</div>
                    </div>
                    <div style={{ padding: '0.875rem', background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.15)', borderRadius: '0.625rem' }}>
                      <div style={{ fontSize: '0.7rem', color: '#22c55e', fontWeight: 700, marginBottom: '0.35rem' }}>{t('tax.repairProfitCard')}</div>
                      <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#fff' }}>{formatCurrency(annual.repairRevenue - annual.repairCOGS)}</div>
                      <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.25rem' }}>{t('tax.revenueLabel')} {formatCurrency(annual.repairRevenue)}</div>
                      <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{t('tax.partsCostLabel')} {formatCurrency(annual.repairCOGS)}</div>
                    </div>
                    <div style={{ padding: '0.875rem', background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.15)', borderRadius: '0.625rem' }}>
                      <div style={{ fontSize: '0.7rem', color: '#60a5fa', fontWeight: 700, marginBottom: '0.35rem' }}>{t('tax.productServiceProfit')}</div>
                      <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#fff' }}>{formatCurrency(annual.productProfit)}</div>
                      <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.25rem' }}>{t('tax.revenueLabel')} {formatCurrency(annual.productGross)}</div>
                      <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{t('tax.costLabel')} {formatCurrency(annual.productCOGS)}</div>
                    </div>
                  </div>
                </Card>

                <div style={{ textAlign: 'center', padding: '2rem', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.75rem' }}>
                  <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.5rem' }}>{t('tax.taxYearSummary', selectedYear)}</div>
                  <div style={{ display: 'flex', justifyContent: 'center', gap: '2.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{t('tax.totalIncomeLabel')}</div>
                      <div style={{ fontSize: '2rem', fontWeight: 800, color: '#22c55e' }}>{formatCurrency(annual.displayTotalIncome)}</div>
                      <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{t('tax.posPlusManual')}</div>
                    </div>
                    <div style={{ fontSize: '1.5rem', color: '#475569' }}>−</div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{t('tax.scheduleACogs')}</div>
                      <div style={{ fontSize: '2rem', fontWeight: 800, color: '#f87171' }}>{formatCurrency(annual.cogsV1)}</div>
                      <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{t('tax.taxCenterEntriesOnly')}</div>
                    </div>
                    <div style={{ fontSize: '1.5rem', color: '#475569' }}>−</div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{t('tax.operatingExpenses')}</div>
                      <div style={{ fontSize: '2rem', fontWeight: 800, color: '#f87171' }}>{formatCurrency(annual.operatingExpensesV1)}</div>
                      <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{t('tax.rentUtilitiesEtc')}</div>
                    </div>
                  </div>
                  <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                    <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>{t('tax.netProfitLoss')}</div>
                    <div style={{ fontSize: '2.5rem', fontWeight: 900, color: annual.netProfit >= 0 ? '#22c55e' : '#f87171' }}>{formatCurrency(annual.netProfit)}</div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{t('tax.taxableIncome')}</div>
                  </div>
                </div>

                <div style={{ marginTop: '0.75rem', padding: '0.75rem 1rem', background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.15)', borderRadius: '0.625rem' }}>
                  <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#cbd5e1', marginBottom: '0.35rem' }}>
                    {t('tax.howCogsCalculated')}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8', lineHeight: 1.5 }}>
                    {t('tax.cogsExplanation')}
                  </div>
                </div>
              </div>
            )}

            {/* ── Expenses tab ── */}
            {f1065Tab === 'expenses' && (
              <TaxExpensesTab year={selectedYear} />
            )}

            {/* ── Income tab (manual + POS auto + adjustments) ── */}
            {f1065Tab === 'income' && (
              <TaxIncomeTab year={selectedYear} posProfitCents={annual.totalIncome} />
            )}

            {/* ── Members / K-1 tab ── */}
            {f1065Tab === 'members' && (
              <PartnershipMembersTab netProfitCents={annual.netProfit} />
            )}

            {/* ── 1065 tab ── */}
            {f1065Tab === 'f1065' && (
              <div>
                <InfoBox color="blue">Form 1065 — U.S. Return of Partnership Income. EIN: {settings.partnership?.ein || t('tax.einSetInMembers')} · Due March 15 (ext. Sept 15 via Form 7004).</InfoBox>
                <Card title="Page 1 — Income">
                  <Row label={t('tax.line1aGross')} value={formatCurrency(annual.productGross + annual.repairRevenue)} />
                  {annual.taxAdjustments.returnsRefunds > 0 && (
                    <Row label={t('tax.line1bReturns')} value={`(${formatCurrency(annual.taxAdjustments.returnsRefunds)})`} color="#f87171" />
                  )}
                  <Row label={t('tax.line1cBalance')} value={formatCurrency(annual.productGross + annual.repairRevenue - annual.taxAdjustments.returnsRefunds)} />
                  <Row label={t('tax.line2COGS')} value={`(${formatCurrency(annual.productCOGS + annual.repairCOGS + Math.max(0, annual.taxCOGS))})`} color="#f87171" />
                  <Row label={t('tax.line3GrossProfit')} value={formatCurrency(annual.productGross + annual.repairRevenue - annual.taxAdjustments.returnsRefunds - annual.productCOGS - annual.repairCOGS - Math.max(0, annual.taxCOGS))} color="#22c55e" bold />
                  {(annual.phoneNetCommission > 0 || annual.taxIncomeAdditional > 0 || annual.taxAdjustments.otherIncome > 0) && (
                    <Row label={t('tax.line7OtherIncome')} value={formatCurrency(annual.phoneNetCommission + annual.taxIncomeAdditional + annual.taxAdjustments.otherIncome)} color="#22c55e" />
                  )}
                  <Row label={t('tax.line8TotalIncome')} value={formatCurrency(annual.adjustedTotalIncome)} color="#22c55e" bold />
                </Card>
                <Card title="Page 1 — Deductions">
                  {annual.yearExpenses.length === 0 && annual.taxExpensesDeductible === 0 && annual.guaranteedPaymentsTotal === 0 ? (
                    <div style={{ color: '#475569', fontSize: '0.8rem' }}>
                      {t('tax.noDeductionsHint')}
                    </div>
                  ) : (
                    <>
                      {annual.guaranteedPaymentsTotal > 0 && (
                        <Row
                          label={t('tax.line10GuaranteedPayments')}
                          value={formatCurrency(annual.guaranteedPaymentsTotal)}
                          color="#f87171"
                        />
                      )}
                      {annual.schedCLinesSorted.map((group) => (
                        <Row
                          key={group.line}
                          label={`Line ${group.line} — ${group.label} (sidebar Expenses)`}
                          value={formatCurrency(group.amount)}
                          color="#f87171"
                        />
                      ))}
                      {annual.taxExpensesDeductible > 0 && (
                        <Row
                          label={t('tax.taxCenterExpensesDeductible')}
                          value={formatCurrency(annual.taxExpensesDeductible)}
                          color="#f87171"
                        />
                      )}
                    </>
                  )}
                  <Row label={t('tax.totalDeductionsL21')} value={formatCurrency(annual.manualTotal + annual.guaranteedPaymentsTotal)} color="#f87171" bold />
                </Card>
                <Card title="Ordinary Business Income">
                  <Row label={t('tax.line23OrdinaryIncome')} value={formatCurrency(annual.netProfit)} color={annual.netProfit >= 0 ? '#22c55e' : '#f87171'} bold />
                </Card>
              </div>
            )}

            {/* ── K1 tab ── */}
            {f1065Tab === 'k1' && (
              <div>
                <InfoBox color="blue">Schedule K-1 (Form 1065) — Partner's Share of Income. Attach to each partner's Form 1040 on Schedule E.</InfoBox>
                {(() => {
                  const partnership = settings.partnership;
                  const realMembers = partnership?.members ?? [];

                  if (realMembers.length === 0) {
                    return (
                      <div style={{
                        background: 'rgba(251,191,36,0.08)',
                        border: '1px dashed rgba(251,191,36,0.4)',
                        borderRadius: '0.75rem',
                        padding: '1.5rem',
                        textAlign: 'center',
                      }}>
                        <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>👥</div>
                        <div style={{ fontSize: '0.9rem', color: '#fcd34d', fontWeight: 700, marginBottom: '0.4rem' }}>
                          {t('tax.noPartnershipMembers')}
                        </div>
                        <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: '0.875rem' }}>
                          {t('tax.addMembersForK1')}
                        </div>
                        <button
                          onClick={() => setF1065Tab('members')}
                          style={{
                            background: 'linear-gradient(135deg, #22d3ee, #0891b2)',
                            border: 'none',
                            borderRadius: '0.5rem',
                            padding: '0.6rem 1.25rem',
                            color: '#0f172a',
                            fontSize: '0.82rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          {t('tax.goToMembers')}
                        </button>
                      </div>
                    );
                  }

                  return realMembers.map((m) => {
                    // r29d-1 — use canonical calcMemberK1. Previously this was inline math
                    // duplicated from PartnershipMembersTab and ALSO had the Box 14 bug.
                    const k1 = calcMemberK1(m, annual.netProfit);
                    return (
                      <Card key={m.id} title={`K-1 — ${m.name}`}>
                        <Row label="Partner's SSN / ITIN" value={m.ssn || t('tax.notSet')} />
                        {m.ein && <Row label="Partner's EIN (entity)" value={m.ein} />}
                        <Row label="Partnership EIN" value={partnership?.ein || t('tax.setAbove')} />
                        <Row label="Partnership Name" value={partnership?.legalName || '(not set)'} />
                        <Row label="Profit sharing %" value={`${(m.ownershipPct ?? 0).toFixed(2)}%`} />
                        <Row label="Loss sharing %" value={`${(m.ownershipPct ?? 0).toFixed(2)}%`} />
                        <Row label="Capital sharing %" value={`${(m.ownershipPct ?? 0).toFixed(2)}%`} />
                        <Row label="Box 1 — Ordinary business income" value={formatCurrency(k1.ordinaryIncome)} color="#22c55e" bold />
                        {m.guaranteedPayments > 0 && (
                          <Row label="Box 4a — Guaranteed payments for services" value={formatCurrency(m.guaranteedPayments)} color="#fbbf24" />
                        )}
                        <Row label="Box 14 — Net SE earnings (Code A)" value={formatCurrency(k1.netSEEarnings)} />
                        <Row label="Item L — Beginning capital account" value={formatCurrency(m.beginningCapital)} />
                        <Row label="Item L — Capital contributed" value={formatCurrency(m.contributions)} />
                        <Row label="Item L — Current year income" value={formatCurrency(k1.ordinaryIncome)} color="#22c55e" />
                        <Row label="Item L — Withdrawals & distributions" value={`(${formatCurrency(m.distributions)})`} color="#f87171" />
                        <Row label="Item L — Ending capital account" value={formatCurrency(k1.endingCapital)} bold />
                      </Card>
                    );
                  });
                })()}
              </div>
            )}

            {/* ── R-TAX-MODULE-UI: editable tabs for the 4 new tax forms ── */}
            {f1065Tab === 'f1040' && (
              <Tax1040Tab year={selectedYear} />
            )}
            {f1065Tab === 'schedC' && (
              <TaxScheduleCTab year={selectedYear} />
            )}
            {f1065Tab === 'schedL' && (
              <TaxBalanceSheetTab year={selectedYear} />
            )}
            {f1065Tab === 'schedM' && (
              <TaxScheduleMTab year={selectedYear} />
            )}

            {/* ── Remaining read-only auto-calc tabs (SE / Schedule 1 / Schedule 2 / 1040 Sched C) ── */}
            {['schedSE','sched1','sched2','f1040C'].includes(f1065Tab) && (
              <div>
                <InfoBox color="amber">
                  {f1065Tab === 'schedSE' && '📋 Schedule SE — Self-Employment Tax. Each partner calculates SE tax on their K-1 Box 14 amount (net earnings × 92.35% × 15.3%).'}
                  {f1065Tab === 'sched1' && '📄 Schedule 1 — Additional Income and Adjustments. Partners attach K-1 income here via Schedule E, and deduct ½ SE tax.'}
                  {f1065Tab === 'sched2' && '📄 Schedule 2 — Additional Taxes. Self-employment tax from Schedule SE flows here.'}
                  {f1065Tab === 'f1040C' && '🧾 1040 Schedule C — Use this if business entity changes to sole prop. Currently N/A for partnerships — for sole proprietors only.'}
                </InfoBox>
                {f1065Tab === 'schedSE' && (() => {
                  const realMembers = settings.partnership?.members ?? [];
                  // r29b-1: removed bogus 50/50 fallback. If no members are configured,
                  // show the same CTA pattern used in the K-1 tab — honest > inventing data.
                  if (realMembers.length === 0) {
                    return (
                      <div style={{
                        background: 'rgba(251,191,36,0.08)',
                        border: '1px dashed rgba(251,191,36,0.4)',
                        borderRadius: '0.75rem',
                        padding: '1.5rem',
                        textAlign: 'center',
                      }}>
                        <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>👥</div>
                        <div style={{ fontSize: '0.9rem', color: '#fcd34d', fontWeight: 700, marginBottom: '0.4rem' }}>
                          {t('tax.noPartnershipMembers')}
                        </div>
                        <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: '0.875rem' }}>
                          {t('tax.scheduleSeHint')}
                        </div>
                        <button
                          onClick={() => setF1065Tab('members')}
                          style={{
                            background: 'linear-gradient(135deg, #22d3ee, #0891b2)',
                            border: 'none',
                            borderRadius: '0.5rem',
                            padding: '0.6rem 1.25rem',
                            color: '#0f172a',
                            fontSize: '0.82rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          {t('tax.goToMembers')}
                        </button>
                      </div>
                    );
                  }
                  return (
                    <Card title="Schedule SE — Per Partner">
                      {realMembers.map((m) => {
                        // r29d-1 — use canonical calcMemberK1. Previously inline math
                        // had the same Box 14 bug as the K-1 print render. The "Net SE
                        // earnings" row was showing the PRE-multiplication value.
                        const k1 = calcMemberK1(m, annual.netProfit);
                        return (
                          <div key={m.id} style={{ marginBottom: '0.875rem', paddingBottom: '0.5rem', borderBottom: '1px dashed rgba(255,255,255,0.08)' }}>
                            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#cbd5e1', marginBottom: '0.3rem' }}>
                              {m.name} ({(m.ownershipPct ?? 0).toFixed(2)}%)
                            </div>
                            <Row label="Box 1 — Ordinary income share" value={formatCurrency(k1.ordinaryIncome)} indent />
                            {m.guaranteedPayments > 0 && (
                              <Row label="+ Guaranteed payments" value={formatCurrency(m.guaranteedPayments)} indent />
                            )}
                            <Row label="Net SE earnings (K-1 Box 14, after × 92.35%)" value={formatCurrency(k1.netSEEarnings)} indent />
                            <Row label="× 15.3% SE Tax" value={formatCurrency(k1.seTax)} color="#f87171" bold indent />
                            <Row label="Deductible ½ SE" value={formatCurrency(k1.halfSE)} color="#22c55e" indent />
                          </div>
                        );
                      })}
                    </Card>
                  );
                })()}
              </div>
            )}

            {/* ── CA 540 tab (editable) ── */}
            {f1065Tab === 'ca540' && (
              <TaxCA540Tab year={selectedYear} netProfitCents={annual.netProfit} />
            )}

            {/* ── Inventory tab ── */}
            {f1065Tab === 'inventory' && (
              <TaxInventoryTab year={selectedYear} />
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════ */}
        {/* W-9 FORM                                        */}
        {/* ═══════════════════════════════════════════════ */}
        {activeSection === 'w9' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
              <div>
                <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#fff', marginBottom: '0.2rem' }}>📋 Form W-9</h1>
                <p style={{ fontSize: '0.8rem', color: '#64748b' }}>Request for Taxpayer Identification Number and Certification — Rev. March 2024</p>
              </div>
              <button onClick={handleW9Print} className="btn btn-primary">🖨️ Print W-9</button>
            </div>

            <div style={{ maxWidth: '680px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '0.875rem', padding: '1.5rem' }}>
              {/* Field 1 */}
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem' }}>1. Name of entity/individual (as shown on income tax return)</label>
                <input className="input" value={w9.name} onChange={(e) => setW9({...w9, name: e.target.value})} />
              </div>
              {/* Field 2 */}
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem' }}>2. Business name/disregarded entity name, if different from above</label>
                <input className="input" placeholder="Leave blank if same as above" value={w9.businessName} onChange={(e) => setW9({...w9, businessName: e.target.value})} />
              </div>
              {/* 3a Tax classification */}
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.5rem' }}>3a. Federal tax classification</label>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                  {['Individual/Sole Proprietor','C Corporation','S Corporation','Partnership','Trust/Estate','LLC','Other'].map((c) => (
                    <button key={c} onClick={() => setW9({...w9, classification: c})} style={{
                      padding: '0.35rem 0.75rem', borderRadius: '0.375rem', fontSize: '0.78rem', cursor: 'pointer',
                      border: `1px solid ${w9.classification === c ? '#667eea' : 'rgba(255,255,255,0.15)'}`,
                      background: w9.classification === c ? 'rgba(102,126,234,0.25)' : 'rgba(255,255,255,0.05)',
                      color: w9.classification === c ? '#a5b4fc' : '#94a3b8', fontWeight: w9.classification === c ? 700 : 400,
                    }}>{c}</button>
                  ))}
                </div>
                {w9.classification === 'LLC' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.78rem', color: '#94a3b8' }}>
                    <span>LLC tax classification:</span>
                    {[['C','C=C corp'],['S','S=S corp'],['P','P=Partnership']].map(([v, hint]) => (
                      <button key={v} onClick={() => setW9({...w9, llcType: v})} style={{ padding: '0.25rem 0.5rem', borderRadius: '0.25rem', border: `1px solid ${w9.llcType === v ? '#667eea' : 'rgba(255,255,255,0.15)'}`, background: w9.llcType === v ? 'rgba(102,126,234,0.25)' : 'transparent', color: w9.llcType === v ? '#a5b4fc' : '#94a3b8', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700 }}>{v}</button>
                    ))}
                    <span style={{ color: '#475569' }}>C=C corp, S=S corp, P=Partnership</span>
                  </div>
                )}
              </div>
              {/* Fields 4 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem' }}>4. Exempt payee code (if any)</label>
                  <input className="input" placeholder="Leave blank if none" value={w9.exemptPayee} onChange={(e) => setW9({...w9, exemptPayee: e.target.value})} />
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem' }}>Exemption from FATCA reporting code (if any)</label>
                  <input className="input" placeholder="Leave blank if none" value={w9.fatcaCode} onChange={(e) => setW9({...w9, fatcaCode: e.target.value})} />
                </div>
              </div>
              {/* Address */}
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem' }}>5. Address (number, street, apt. or suite no.)</label>
                <input className="input" value={w9.address} onChange={(e) => setW9({...w9, address: e.target.value})} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem' }}>6. City, state, and ZIP code</label>
                  <input className="input" value={w9.city} onChange={(e) => setW9({...w9, city: e.target.value})} />
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem' }}>7. Account number(s) (optional)</label>
                  <input className="input" placeholder="Optional" value={w9.accountNumbers} onChange={(e) => setW9({...w9, accountNumbers: e.target.value})} />
                </div>
              </div>

              {/* Part I — TIN */}
              <div style={{ background: 'rgba(102,126,234,0.08)', border: '1px solid rgba(102,126,234,0.2)', borderRadius: '0.625rem', padding: '1rem', marginBottom: '1rem' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#a5b4fc', marginBottom: '0.75rem' }}>Part I — Taxpayer Identification Number (TIN)</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                  <div>
                    <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.3rem' }}>Social Security Number (SSN)</label>
                    <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                      <input className="input" type="password" style={{ width: '60px', textAlign: 'center' }} maxLength={3} placeholder="•••" value={w9.ssn1} onChange={(e) => setW9({...w9, ssn1: e.target.value})} />
                      <span style={{ color: '#64748b' }}>–</span>
                      <input className="input" type="password" style={{ width: '50px', textAlign: 'center' }} maxLength={2} placeholder="••" value={w9.ssn2} onChange={(e) => setW9({...w9, ssn2: e.target.value})} />
                      <span style={{ color: '#64748b' }}>–</span>
                      <input className="input" type="password" style={{ width: '70px', textAlign: 'center' }} maxLength={4} placeholder="••••" value={w9.ssn3} onChange={(e) => setW9({...w9, ssn3: e.target.value})} />
                    </div>
                  </div>
                  <span style={{ color: '#64748b', fontWeight: 700 }}>OR</span>
                  <div>
                    <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.3rem' }}>Employer Identification Number (EIN)</label>
                    <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                      <input className="input" style={{ width: '50px', textAlign: 'center' }} maxLength={2} placeholder="••" value={w9.ein1} onChange={(e) => setW9({...w9, ein1: e.target.value})} />
                      <span style={{ color: '#64748b' }}>–</span>
                      <input className="input" type="password" style={{ width: '90px', textAlign: 'center' }} maxLength={7} placeholder="•••••••" value={w9.ein2} onChange={(e) => setW9({...w9, ein2: e.target.value})} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Part II — Certification */}
              <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '0.625rem', padding: '1rem', marginBottom: '1rem' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '0.5rem' }}>Part II — Certification</div>
                <p style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.75rem', lineHeight: 1.5 }}>
                  Under penalties of perjury, I certify that: (1) The number shown on this form is my correct TIN; (2) I am not subject to backup withholding; (3) I am a U.S. citizen or other U.S. person; and (4) The FATCA code(s) entered on this form (if any) are correct.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.3rem' }}>Signature of U.S. person ▶</label>
                    <input className="input" placeholder="Type full legal name as signature" value={w9.signature} onChange={(e) => setW9({...w9, signature: e.target.value})} style={{ fontStyle: 'italic' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.3rem' }}>Date ▶</label>
                    <input className="input" value={w9.date} onChange={(e) => setW9({...w9, date: e.target.value})} />
                  </div>
                </div>
              </div>

              {/* Requester */}
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem' }}>Requester's name and address (optional — for your records)</label>
                <input className="input" placeholder="Who is requesting this W-9?" value={w9.requester} onChange={(e) => setW9({...w9, requester: e.target.value})} />
              </div>

              <button onClick={handleW9Print} className="btn btn-primary" style={{ width: '100%' }}>🖨️ Print W-9</button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
