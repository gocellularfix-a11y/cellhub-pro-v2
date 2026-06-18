// ============================================================
// CellHub Pro — Repair Modal (full rewrite matching original)
// Features:
//   - First + Last name separate
//   - Quick Issue pills (15 EN/ES)
//   - Quick Diagnosis pills (12 EN/ES)
//   - Device Type, IMEI + Generate, Password, Carrier
//   - Parts from inventory + Labor
//   - Tax-formula totals (services = no tax)
//   - Status & Priority selectors
//   - Warranty + Estimated Completion
//   - Customer Notes + Internal Notes
//   - Quick Actions: Received/Complete/Cancel + Print Ticket
//   - Print Notes Only (no prices)
//   - Add to Cart button
// ============================================================

import { useState, useMemo } from 'react';
import { Modal, SearchInput, AutocompleteInput } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { useTranslation } from '@/i18n';
import { formatCurrency } from '@/utils/currency';
import { calcDepositTotals } from '@/utils/depositTax';
import { generateId } from '@/utils/dates';
import { usePrint } from '@/hooks/usePrint';
// R-RECEIPT-UNIFY-REPAIR-V1: reuse the POS payment-receipt barcode renderer +
// bundled QR lib so the repair ticket shares the same visual system.
import { renderBarcodeSvg, getReceiptBarcodeHeight } from '@/modules/pos/ReceiptModal';
import QRCode from 'qrcode';
import { normalizePhone } from '@/utils/normalize';
import { CARRIER_OPTIONS, DEVICE_MODEL_OPTIONS } from '@/config/autocompleteData';
import CustomerPicker from '@/components/shared/CustomerPicker';
import AdminPinGate from '@/components/shared/AdminPinGate';
import { usePinGate } from '@/hooks/usePinGate';
import ReasonSelectorModal from '@/components/ReasonSelectorModal';
import {
  computeDiff, hasMoneyChanges, checkEditHistoryStatus,
  REPAIR_MONEY_FIELDS, REPAIR_ALL_FIELDS,
  type FieldChange, type EditReason,
} from '@/services/editAudit';
import type { AutocompleteOption } from '@/hooks/useAutocomplete';
import type { Repair, RepairPart, Customer, InventoryItem, StoreSettings } from '@/store/types';
import { REPAIR_STATUS, normalizeRepairStatus, orderedRepairStatusOptions } from '@/utils/repairStatus';

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

// R-EDIT-AUDIT: audit metadata passed alongside payload when saving a locked
// ticket. RepairModule.handleSave uses this to apply side-effects + append
// the edit history entry + trigger a corrected receipt.
export interface RepairAuditMeta {
  reason: EditReason;
  changes: FieldChange[];
  note?: string;
}

interface Props {
  repair: Repair | null;
  customers: Customer[];
  inventory: InventoryItem[];
  settings: StoreSettings;
  allRepairs?: Repair[];
  onSave: (data: Partial<Repair>, auditMeta?: RepairAuditMeta) => void;
  onCollectBalance?: (repair: Repair) => void;
  onRequestCancel?: (repair: Repair) => void;
  onClose: () => void;
  lang: string;
}


function PillButton({ icon, label, selected, onToggle, color = '#a5b4fc' }: {
  icon: string; label: string; selected: boolean; onToggle: () => void; color?: string;
}) {
  return (
    <button type="button" onClick={onToggle} style={{
      padding: '0.35rem 0.7rem', borderRadius: '999px',
      border: selected ? `2px solid ${color}` : '1px solid rgba(255,255,255,0.15)',
      background: selected ? `${color}22` : 'rgba(255,255,255,0.05)',
      color: selected ? color : '#cbd5e1',
      fontSize: '0.78rem', fontWeight: selected ? 700 : 500,
      cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap',
      display: 'flex', alignItems: 'center', gap: '0.3rem',
    }}>
      <span>{icon}</span><span>{label}</span>
      {selected && <span style={{ fontSize: '0.7rem' }}>✓</span>}
    </button>
  );
}

// FIX Bug 6: use split/filter/join instead of string.replace to avoid stray commas
// and to handle cases where the value appears multiple times.
function togglePill(current: string, value: string): string {
  const parts = current.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.includes(value)) {
    return parts.filter((p) => p !== value).join(', ');
  }
  return [...parts, value].join(', ');
}

export default function RepairModal({ repair, customers, inventory, settings, allRepairs = [], onSave, onCollectBalance, onRequestCancel, onClose, lang }: Props) {
  const { t } = useTranslation();
  const isEdit = !!repair;
  const { printHtml } = usePrint();
  const { toast } = useToast();

  const r = repair as any;

  // FIX Bug 5: laborCost and deposit are stored as cents in Firestore/state.
  // When loading into form for display we must convert to dollars.
  // On a NEW repair r is null so these default to 0 (no conversion needed).
  const toDisplay = (cents: number) => (cents || 0) / 100;

  const [form, setForm] = useState({
    firstName:           r?.firstName || (r?.customerName?.split(' ')[0] || ''),
    lastName:            r?.lastName  || (r?.customerName?.split(' ').slice(1).join(' ') || ''),
    ticketNumber:       (r as any)?.ticketNumber || '',   // r-new-3: preserve ticket number for print
    customerPhone:       r?.customerPhone || '',
    deviceType:          r?.deviceType || 'Phone',
    brand:               r?.brand || r?.device || '',
    model:               r?.model || r?.deviceModel || '',
    imei:                r?.imei || '',
    carrier:             r?.carrier || '',
    password:            r?.password || '',
    issue:               r?.issue || '',
    diagnosis:           r?.diagnosis || '',
    status:              normalizeRepairStatus(r?.status) || REPAIR_STATUS.RECEIVED,
    priority:            r?.priority || 'Normal',
    parts:               (r?.parts || []) as any[],
    laborCost:           toDisplay(r?.laborCost),   // cents → dollars for display
    deposit:             toDisplay(r?.depositAmount ?? r?.deposit), // cents → dollars
    estimatedCompletion: r?.estimatedCompletion || '',
    warranty:            r?.warranty ?? 30,
    notes:               r?.notes || r?.techNotes || '',
    internalNotes:       r?.internalNotes || '',
    diagnosisOutcome:    r?.diagnosisOutcome || '',
    devicePhoto:         r?.devicePhoto || '',
    taxable:             r?.taxable || false,
  });

  const upd = (field: string, val: any) => setForm((f) => ({ ...f, [field]: val }));

  // R-EDIT-AUDIT F3.1: lock money fields on completed tickets.
  // totalPaid = what customer has paid so far (derived, not a stored field).
  // Lock when fully paid AND at least one payment made,
  // OR when ticket is already refunded (terminal, no more edits).
  const totalPaid = (repair?.estimatedCost || 0) - (repair?.balance || 0);
  const isLocked = !!repair && (
    (repair.balance === 0 && totalPaid > 0)
    || normalizeRepairStatus(repair.status) === 'refunded'
  );

  // R-EDIT-AUDIT F3.3: PIN gate for unlocking money fields post-completion.
  const pin = usePinGate(settings?.adminPin);

  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(
    () => customers.find(c => c.id === (r as any)?.customerId) ?? null
  );

  // Wrap onClose so closing the modal (X, Cancel, etc.) clears the PIN unlock.
  const handleClose = () => {
    pin.resetLock();
    setIsSaving(false);
    setSelectedCustomer(null);
    onClose();
  };

  const [validationError, setValidationError] = useState<string | null>(null);

  // ── Autocomplete option sets ─────────────────────────────
  // Customer first names from known customers
  const firstNameOptions = useMemo<AutocompleteOption[]>(() =>
    customers.map((c) => {
      const parts = c.name.trim().split(' ');
      return { value: parts[0] || '', label: parts[0] || '', sublabel: c.phone, data: c };
    }).filter((o) => o.value.length > 0),
    [customers],
  );

  // Customer last names (filtered when first name typed)
  const lastNameOptions = useMemo<AutocompleteOption[]>(() => {
    const base = customers
      .filter((c) => !form.firstName || c.name.toLowerCase().startsWith(form.firstName.toLowerCase()))
      .map((c) => {
        const parts = c.name.trim().split(' ');
        const last = parts.slice(1).join(' ');
        return { value: last, label: last, sublabel: c.phone, data: c };
      })
      .filter((o) => o.value.length > 0);
    // deduplicate by label
    return base.filter((o, i, arr) => arr.findIndex((x) => x.label === o.label) === i);
  }, [customers, form.firstName]);

  // Phone numbers from known customers
  const phoneOptions = useMemo<AutocompleteOption[]>(() =>
    customers.map((c) => ({ value: c.phone || '', label: c.phone || '', sublabel: c.name, data: c }))
      .filter((o) => o.value.length > 0),
    [customers],
  );

  // ── Phone match hint ─────────────────────────────────────
  const phoneMatch = useMemo(() => {
    const digits = normalizePhone(form.customerPhone);
    if (digits.length < 7) return null;
    return customers.find((c) => normalizePhone(c.phone) === digits) || null;
  }, [form.customerPhone, customers]);

  // Totals — all calculated in cents to avoid floating point drift
  const partsTotalCents = form.parts.reduce(
    (sum, p) => sum + Math.round((parseFloat(p.price) || 0) * 100) * (parseInt(p.quantity) || 1),
    0,
  );
  const laborCostCents = Math.round((parseFloat(String(form.laborCost)) || 0) * 100);
  const subtotalCents = partsTotalCents + laborCostCents;
  const depositCents = Math.round((parseFloat(String(form.deposit)) || 0) * 100);
  const taxRate = settings.taxRate ?? 0.0925;
  const _t = calcDepositTotals(subtotalCents, depositCents, taxRate, !!form.taxable);
  const taxCents = _t.taxCents;
  const totalCents = _t.totalWithTaxCents;
  const balanceCents = _t.balanceCents;

  // Dollar equivalents for display only
  const partsTotal = partsTotalCents / 100;
  const laborCost  = laborCostCents / 100;
  const subtotal   = subtotalCents / 100;
  const taxAmt     = taxCents / 100;
  const total      = totalCents / 100;
  const depositAmt = depositCents / 100;
  const balance    = balanceCents / 100;

  // Parts helpers
  const addPart = () => upd('parts', [...form.parts, { partId: '', name: '', cost: 0, price: 0, quantity: 1 }]);
  const removePart = (i: number) => upd('parts', form.parts.filter((_, idx) => idx !== i));
  const updatePart = (i: number, field: string, val: any) => {
    const updated = [...form.parts];
    updated[i] = { ...updated[i], [field]: val };
    if (field === 'partId' && val) {
      const item = inventory.find((inv) => inv.id === val);
      if (item) { updated[i].name = item.name; updated[i].price = item.price / 100; }
    }
    upd('parts', updated);
  };

  // Generate dummy IMEI
  const generateIMEI = () => {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const rand = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
    upd('imei', `999${yy}${mm}${dd}${rand}`);
  };

  // Build full payload
  const buildPayload = (override: any = {}): any => ({
    ...form,
    ...override,
    customerId: selectedCustomer?.id ?? (r as any)?.customerId ?? undefined,
    customerName: `${form.firstName} ${form.lastName}`.trim(),
    device: `${form.brand} ${form.model}`.trim(),
    deviceModel: form.model,
    partsTotal: partsTotalCents,
    subtotal: subtotalCents,
    taxAmount: taxCents,
    taxable: !!form.taxable,
    taxRate: form.taxable ? taxRate : 0,
    total: totalCents,
    estimatedCost: totalCents,
    depositAmount: depositCents,
    balance: balanceCents,
    laborCost: laborCostCents,
    techNotes: form.notes,
    diagnosisOutcome: form.diagnosisOutcome,
    updatedAt: new Date().toISOString(),
  });

  // Print ticket — premium 4×6 HTML receipt (replaces old monospace template)
  const printTicket = async (payload: any = buildPayload(), notesOnly = false) => {
    const storeName  = settings.storeName  || 'GO CELLULAR';
    const storeAddr  = settings.storeAddress || '';
    const storePhone = settings.storePhone  || '';
    const safe  = (v: any) => v == null ? '' : String(v);
    const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
    const ticketNum  = safe(payload.ticketNumber || r?.id?.slice(-8).toUpperCase() || '');
    // R-RECEIPT-UNIFY-REPAIR-V1: barcode (ticket #) + Google Reviews QR — same
    // generators the payment receipt uses, so scan + QR behaviour is identical.
    const barcodeSvg = renderBarcodeSvg(ticketNum, getReceiptBarcodeHeight(settings.paperSize));
    let qrSvg = '';
    if (settings.showReviewQr && settings.googleReviewUrl) {
      try { qrSvg = await QRCode.toString(settings.googleReviewUrl, { type: 'svg', margin: 1, width: 80 }); }
      catch { /* QR optional — template falls back to a remote img */ }
    }
    const partsCents = (payload.subtotal || 0) - (payload.laborCost || 0);
    const deviceLabel = safe(payload.device || `${safe(payload.brand)} ${safe(payload.model)}`.trim());

    const financialSection = notesOnly ? '' : `
<div class="solid"></div>
<div class="sec totals">
  ${partsCents > 0 ? `<div class="row"><span class="lbl">Parts</span><span class="val">${money(partsCents)}</span></div>` : ''}
  ${(payload.laborCost || 0) > 0 ? `<div class="row"><span class="lbl">Labor</span><span class="val">${money(payload.laborCost)}</span></div>` : ''}
  <div class="row"><span class="lbl">Subtotal</span><span class="val">${money(payload.subtotal || 0)}</span></div>
  ${payload.taxable && (payload.taxAmount || 0) > 0 ? `<div class="row"><span class="lbl">Tax (${((payload.taxRate || 0) * 100).toFixed(2)}%)</span><span class="val">${money(payload.taxAmount)}</span></div>` : ''}
  <div class="row grand" style="border-top:1px solid #000;padding-top:2px;margin-top:2px">
    <span class="lbl">TOTAL</span><span class="val">${money(payload.total || 0)}</span>
  </div>
  <div class="dash" style="margin:3px 0"></div>
  <div class="row"><span class="lbl">Deposit</span><span class="val">${money(payload.depositAmount || 0)}</span></div>
  <div class="row balance-due"><span class="lbl">Balance Due</span><span class="val">${money(payload.balance || 0)}</span></div>
</div>
${payload.warranty ? `<div class="wbox">WARRANTY: ${escHtml(safe(payload.warranty))} days</div>` : ''}
<div class="sig-sec">
  <div class="sig-line"></div>
  <div class="sig-lbl">Customer Signature / Pickup Authorization</div>
</div>`;

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Repair Ticket ${escHtml(ticketNum)}</title><style>
@page{size:4in 6in;margin:0}*{box-sizing:border-box;margin:0;padding:0}
html,body{width:4in;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#000;background:#fff}
body{padding:.1in .15in;overflow-x:hidden}
.hdr{text-align:center;padding-bottom:6px;border-bottom:2px solid #000;margin-bottom:6px}
.store{font-size:14px;font-weight:800;letter-spacing:.04em;text-transform:uppercase}
.store-sub{font-size:9px;color:#444;margin-top:1px}
.title-bar{text-align:center;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:3px 0;border-bottom:1.5px solid #000;margin-bottom:5px}
.sec{margin-bottom:5px}
.sec-lbl{font-size:7.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:#555;border-bottom:.5px solid #ccc;padding-bottom:1px;margin-bottom:3px}
.row{display:flex;justify-content:space-between;align-items:baseline;margin:1.5px 0;gap:4px}
.lbl{font-size:9px;color:#444;white-space:nowrap;flex-shrink:0}
.val{font-size:9px;font-weight:500;text-align:right;word-break:break-word;min-width:0}
.tkt{font-family:monospace;font-size:12px;font-weight:800;letter-spacing:.06em}
.badge{display:inline-block;font-size:7.5px;font-weight:700;padding:1px 5px;border:1px solid #000;border-radius:2px;text-transform:uppercase;letter-spacing:.04em}
.dash{border-top:.5px dashed #bbb;margin:4px 0}
.solid{border-top:1px solid #000;margin:4px 0}
.totals .lbl{font-size:9.5px;font-weight:600}
.totals .val{font-size:9.5px;font-weight:700}
.grand .lbl,.grand .val{font-size:11px;font-weight:800}
.balance-due .val{color:#c00;font-weight:800}
.wbox{text-align:center;border:1px dashed #888;padding:2px 8px;margin:4px auto;width:fit-content;font-size:9px;font-weight:700;letter-spacing:.05em}
.sig-sec{border-top:.5px solid #bbb;padding-top:5px;margin-top:5px}
.sig-line{border-bottom:.5px solid #000;margin:12px 0 2px}
.sig-lbl{font-size:8px;color:#666}
.ftr{text-align:center;font-size:8px;color:#888;border-top:.5px solid #ddd;padding-top:3px;margin-top:5px;line-height:1.5}
@media print{*{-webkit-print-color-adjust:exact;print-color-adjust:exact}body,body *{color:#000!important;border-color:#000!important}}
</style></head><body>
<div style="width:100%;box-sizing:border-box;margin-bottom:4px;border-bottom:2px solid #000;padding-bottom:4px;overflow:hidden;text-align:center"><div style="font-size:18px;font-weight:900;line-height:1.1;letter-spacing:0.02em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(storeName)}</div>${storeAddr ? `<div style="font-size:10px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(storeAddr)}</div>` : ''}${storePhone ? `<div style="font-size:10px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(storePhone)}</div>` : ''}</div>
<div style="width:100%;box-sizing:border-box;text-align:center;margin:0 0 6px 0;overflow:hidden">${barcodeSvg ? barcodeSvg.replace('<svg', '<svg style="display:inline-block;max-width:100%"') : ''}</div>
<div style="text-align:center;font-size:13px;font-weight:900;letter-spacing:0.14em;text-transform:uppercase;margin-bottom:4px">${escHtml(t('repairs.print.repairTicket'))}</div>
<div class="sec">
  <div class="row"><span class="lbl">Ticket #</span><span class="val tkt">${escHtml(ticketNum)}</span></div>
  <div class="row"><span class="lbl">Date</span><span class="val">${new Date().toLocaleDateString()}</span></div>
  <div class="row"><span class="lbl">Status</span><span class="val"><span class="badge">${escHtml(safe(payload.status))}</span></span></div>
</div>
<div class="dash"></div>
<div class="sec">
  <div class="sec-lbl">Customer</div>
  <div class="row"><span class="lbl">Name</span><span class="val">${escHtml(safe(payload.customerName))}</span></div>
  ${payload.customerPhone ? `<div class="row"><span class="lbl">Phone</span><span class="val">${escHtml(safe(payload.customerPhone))}</span></div>` : ''}
</div>
<div class="dash"></div>
<div class="sec">
  <div class="sec-lbl">Device</div>
  <div class="row"><span class="lbl">Device</span><span class="val">${escHtml(deviceLabel)}</span></div>
  ${payload.imei ? `<div class="row"><span class="lbl">IMEI</span><span class="val" style="font-family:monospace;font-size:9px">${escHtml(safe(payload.imei))}</span></div>` : ''}
</div>
<div class="dash"></div>
<div class="sec">
  <div class="sec-lbl">Issue / Service</div>
  <div style="font-size:9px;line-height:1.4;word-break:break-word">${escHtml(safe(payload.issue))}</div>
  ${payload.notes ? `<div style="font-size:8.5px;color:#555;margin-top:3px;word-break:break-word">${escHtml(safe(payload.notes))}</div>` : ''}
</div>
${financialSection}
<div class="ftr" style="text-align:center;font-size:11px;font-weight:600;line-height:1.3;color:#000;border-top:none">${escHtml(t('repairs.print.thankYou'))}<br>${escHtml(storeName)}${settings.showReviewQr && settings.googleReviewUrl ? `<div style="text-align:center;margin-top:8px;padding-top:6px;border-top:1px dashed #ccc"><div style="font-size:10px;font-weight:700;margin-bottom:4px">${escHtml(t('repairs.print.reviewPrompt'))}</div>${qrSvg ? `<div style="width:72px;height:72px;margin:0 auto">${qrSvg}</div>` : `<img src="https://api.qrserver.com/v1/create-qr-code/?size=72x72&data=${encodeURIComponent(settings.googleReviewUrl)}" width="72" height="72" style="display:block;margin:0 auto" />`}<div style="font-size:8px;color:#555;margin-top:3px">&#9733;&#9733;&#9733;&#9733;&#9733; Google</div></div>` : ''}</div>
</body></html>`;

    printHtml(html, {
      silent: false,
      printer: settings.detectedPrinters?.[0],
    });
  };

  // ── Print Warranty Certificate ─────────────────────────
  const printWarranty = (payload: any = buildPayload()) => {
    const storeName  = settings.storeName  || 'CellHub Pro';
    const storeAddr  = settings.storeAddress || '';
    const storePhone = settings.storePhone  || '';
    const storeEmail = settings.storeEmail  || '';
    const warrantyDays = Number(payload.warranty) || 30;
    const completedDate = new Date();
    const expiryDate    = new Date(completedDate);
    expiryDate.setDate(expiryDate.getDate() + warrantyDays);

    const fmt = (v: any) => v == null ? '' : String(v);
    const fmtDate = (d: Date) => d.toLocaleDateString(lang === 'es' ? 'es-MX' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const money   = (v: number) => `$${(v / 100).toFixed(2)}`;

    const ticketNum  = escHtml(fmt(payload.ticketNumber || r?.id?.slice(-8).toUpperCase() || ''));
    const custName   = escHtml(fmt(payload.customerName));
    const device     = escHtml(`${fmt(payload.brand)} ${fmt(payload.model)}`.trim());
    const issue      = escHtml(fmt(payload.issue));
    const imei       = escHtml(fmt(payload.imei));
    const techNotes  = escHtml(fmt(payload.notes));
    const totalAmt   = escHtml(money(payload.total || 0));
    const storeNameUpperEsc = escHtml(storeName.toUpperCase());
    const storeAddrEsc  = escHtml(storeAddr);
    const storePhoneEsc = escHtml(storePhone);
    const storeEmailEsc = escHtml(storeEmail);

    const warrantyBody = escHtml(settings.warrantyText || t('repairs.print.warrantyText'));

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${t('repairs.warranty.repairWarranty')}</title>
<style>
  @page { size: 4in 6in; margin: 0; }
  html, body { width: 4in; height: 6in; margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; font-size: 10px; color: #000; background: #fff; }
  body { padding: 0.15in 0.18in; box-sizing: border-box; }
  .center { text-align: center; }
  .bold { font-weight: 900; }
  .sep { border: none; border-top: 1px dashed #999; margin: 5px 0; }
  .sep-solid { border: none; border-top: 2px solid #000; margin: 5px 0; }
  .row { display: flex; justify-content: space-between; margin: 2px 0; }
  .badge {
    display: inline-block;
    border: 2px solid #000;
    border-radius: 4px;
    padding: 2px 8px;
    font-size: 11px;
    font-weight: 900;
    letter-spacing: 0.05em;
  }
  @media print { html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } body, body * { color: #000 !important; border-color: #000 !important; } }
</style>
</head>
<body>

  <!-- Store header -->
  <div class="center" style="margin-bottom:5px;border-bottom:2px solid #000;padding-bottom:5px">
    <div class="bold" style="font-size:15px;letter-spacing:0.03em">${storeNameUpperEsc}</div>
    ${storeAddrEsc  ? `<div style="font-size:9px">${storeAddrEsc}</div>` : ''}
    ${storePhoneEsc ? `<div style="font-size:9px">${storePhoneEsc}</div>` : ''}
    ${storeEmailEsc ? `<div style="font-size:9px">${storeEmailEsc}</div>` : ''}
  </div>

  <!-- Title -->
  <div class="center" style="margin:6px 0">
    <div class="bold" style="font-size:13px;letter-spacing:0.05em">
      🛡️ ${t('repairs.warranty.certificate')}
    </div>
    <div style="font-size:9px;color:#555;margin-top:2px">
      ${t('repairs.warranty.repairWarranty')}
    </div>
  </div>
  <hr class="sep-solid">

  <!-- Ticket + customer -->
  <div style="margin:4px 0">
    <div class="row">
      <span class="bold">${t('repairs.warranty.ticket')}:</span>
      <span class="bold" style="font-family:monospace">#${ticketNum}</span>
    </div>
    <div class="row">
      <span class="bold">${t('repairs.print.customer')}:</span>
      <span>${custName}</span>
    </div>
    <div class="row">
      <span class="bold">${t('repairs.print.device')}:</span>
      <span>${device}</span>
    </div>
    ${imei ? `<div class="row"><span class="bold">IMEI:</span><span style="font-family:monospace;font-size:9px">${imei}</span></div>` : ''}
    <div class="row">
      <span class="bold">${t('repairs.warranty.service')}:</span>
      <span style="max-width:2.2in;text-align:right">${issue}</span>
    </div>
    ${techNotes ? `<div style="font-size:8.5px;color:#444;margin-top:2px">${t('repairs.print.notesLower')}: ${techNotes}</div>` : ''}
    <div class="row" style="margin-top:3px">
      <span class="bold">Total:</span>
      <span class="bold">${totalAmt}</span>
    </div>
  </div>
  <hr class="sep">

  <!-- Warranty period -->
  <div style="margin:4px 0;background:#f5f5f5;border:1px solid #ccc;border-radius:4px;padding:5px 7px">
    <div class="center bold" style="font-size:11px;margin-bottom:3px">
      ${t('repairs.print.warranty')}: ${warrantyDays} ${t('repairs.print.days').toUpperCase()}
    </div>
    <div class="row" style="font-size:9.5px">
      <span>${t('repairs.warranty.serviceDate')}:</span>
      <span class="bold">${fmtDate(completedDate)}</span>
    </div>
    <div class="row" style="font-size:9.5px">
      <span>${t('repairs.print.expiresOn')}:</span>
      <span class="bold" style="color:#000">${fmtDate(expiryDate)}</span>
    </div>
  </div>
  <hr class="sep">

  <!-- Terms -->
  <div style="font-size:8px;line-height:1.35;color:#333;margin:3px 0">
    ${warrantyBody}
  </div>
  <hr class="sep">

  <!-- Signature -->
  <div style="margin-top:4px">
    <div class="row" style="font-size:9px">
      <div style="flex:1">
        <div style="border-bottom:1px solid #000;height:18px;margin-bottom:2px"></div>
        <div>${t('repairs.warranty.customerSignature')}</div>
      </div>
      <div style="width:12px"></div>
      <div style="flex:1">
        <div style="border-bottom:1px solid #000;height:18px;margin-bottom:2px"></div>
        <div>${t('repairs.warranty.technicianStore')}</div>
      </div>
    </div>
  </div>

  <!-- Footer -->
  <div class="center" style="font-size:8px;color:#666;margin-top:5px;border-top:1px dashed #ccc;padding-top:4px">
    ${t('repairs.print.thankYouTrust')}
    ${storePhoneEsc ? `<br>${t('repairs.print.questions')}? ${storePhoneEsc}` : ''}
  </div>

</body>
</html>`;

    printHtml(html, {
      silent: false,
      printer: settings.detectedPrinters?.[0],
    });
  };

  const validateForm = (): boolean => {
    setValidationError(null);
    if (!form.firstName.trim() || !form.lastName.trim() || !form.customerPhone.trim()) {
      setValidationError(t('repairs.errFirstLastPhone'));
      return false;
    }
    const phoneLen = form.customerPhone.replace(/\D/g, '').length;
    if (phoneLen > 0 && phoneLen !== 10) {
      setValidationError(t('repairs.errPhone10'));
      return false;
    }
    if (!form.model.trim()) { setValidationError(t('repairs.errModelRequired')); return false; }
    if (!form.issue.trim()) { setValidationError(t('repairs.errIssueRequired')); return false; }
    if (depositAmt > total && total > 0) {
      setValidationError(t('repairs.errDepositExceedsTotal', `$${total.toFixed(2)}`));
      return false;
    }
    return true;
  };

  // R-EDIT-AUDIT F3.4-5: reason selector state for locked-ticket edits.
  const [showReasonSelector, setShowReasonSelector] = useState(false);
  const [pendingAuditPayload, setPendingAuditPayload] = useState<{
    payload: Partial<Repair>;
    changes: FieldChange[];
  } | null>(null);
  // R-EDIT-AUDIT F6-FIX: double-submit guard (parity with Unlocks/SO). Prevents
  // rapid clicks on the info-only typo_correction path from creating duplicate
  // editHistory entries. Reset in every early-return + handleClose + reason
  // selector resolution paths.
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = () => {
    if (isSaving) return;
    if (!validateForm()) return;
    const payload = buildPayload();

    // Non-locked path (new ticket, or unlocked existing ticket): save as before.
    if (!isLocked || !repair) {
      onSave(payload);
      return;
    }

    setIsSaving(true);

    // R-EDIT-AUDIT F3.4: locked ticket — stale check + H2 guard against the
    // freshest repairs list we have access to (allRepairs prop, React state).
    const fresh = (allRepairs || []).find((r) => r.id === repair.id);
    if (!fresh) {
      toast(t('repairs.errTicketDeletedExternal'), 'error');
      handleClose();
      return;
    }
    const freshNorm = normalizeRepairStatus(fresh.status);
    if (freshNorm === REPAIR_STATUS.CANCELLED || freshNorm === 'refunded') {
      toast(t('repairs.errTicketCancelledRefunded'), 'error');
      handleClose();
      return;
    }
    // R-REPAIRS-STALE-CHECK-NORMALIZATION-B1: String(date_object) is
    // locale-dependent and differs from String(iso_string) even for the same
    // instant — allowing concurrent edits to slip past the stale guard when
    // storage format is mixed (Date vs ISO string vs Firestore Timestamp).
    // Normalize to epoch millis before comparing.
    const normalizeUpdatedAt = (v: unknown): number => {
      if (v instanceof Date) return v.getTime();
      if (v != null && typeof (v as any).toDate === 'function') return (v as any).toDate().getTime();
      if (typeof v === 'string') return Date.parse(v);
      if (typeof v === 'number') return v;
      return 0;
    };
    if (fresh.updatedAt && repair.updatedAt && normalizeUpdatedAt(fresh.updatedAt) !== normalizeUpdatedAt(repair.updatedAt)) {
      toast(t('repairs.errTicketModifiedOtherStation'), 'error');
      handleClose();
      return;
    }

    // Edit-history cap check
    const historyStatus = checkEditHistoryStatus(fresh.editHistory);
    if (historyStatus === 'full') {
      toast(t('repairs.errHistoryFull'), 'error');
      setIsSaving(false);
      return;
    }
    if (historyStatus === 'warning') {
      toast(t('repairs.warningHistoryStatus', fresh.editHistory?.length || 0), 'warning');
    }

    // R-EDIT-AUDIT F3.5: diff against FRESH entity (not originalSnapshot).
    // Form stores dollars; entity stores cents — compare in cents.
    // depositAmount is excluded because deposit input stays locked post-completion
    // (r-deposit-integrity-1 invariant — managed only by POS/cancellation paths).
    const reference: Record<string, unknown> = {
      laborCost: fresh.laborCost ?? 0,
      estimatedCost: fresh.estimatedCost ?? 0,
      taxable: (fresh as any).taxable ?? false,
      customerName: fresh.customerName ?? '',
      customerPhone: fresh.customerPhone ?? '',
      device: fresh.device ?? '',
      deviceModel: fresh.deviceModel ?? '',
      imei: fresh.imei ?? '',
      issue: fresh.issue ?? '',
      techNotes: fresh.techNotes ?? '',
      priority: fresh.priority ?? '',
      warranty: fresh.warranty ?? '',
      estimatedCompletion: fresh.estimatedCompletion ?? '',
      employeeName: fresh.employeeName ?? '',
      notes: (fresh as any).notes ?? fresh.techNotes ?? '',
    };
    const current: Record<string, unknown> = {
      laborCost: laborCostCents,
      estimatedCost: totalCents,
      taxable: !!form.taxable,
      customerName: `${form.firstName} ${form.lastName}`.trim(),
      // R-PHONE-SANITIZE-SWEEP: 10-digit form on repair record.
      customerPhone: normalizePhone(form.customerPhone || ''),
      device: `${form.brand} ${form.model}`.trim(),
      deviceModel: form.model ?? '',
      imei: form.imei ?? '',
      issue: form.issue ?? '',
      techNotes: form.notes ?? '',
      priority: form.priority ?? '',
      warranty: form.warranty ?? '',
      estimatedCompletion: form.estimatedCompletion ?? '',
      employeeName: fresh.employeeName ?? '', // not in form — keep reference
      notes: form.notes ?? '',
    };

    const fieldsToCheck = (REPAIR_ALL_FIELDS as readonly string[])
      .filter((f) => f !== 'depositAmount');
    const changes = computeDiff(reference, current, fieldsToCheck);

    if (changes.length === 0) {
      handleClose();
      return;
    }

    const moneyChanged = hasMoneyChanges(changes, REPAIR_MONEY_FIELDS as unknown as string[]);
    if (moneyChanged) {
      setPendingAuditPayload({ payload, changes });
      setShowReasonSelector(true);
      // Keep isSaving=true until reason selector resolves (handled in
      // handleReasonSelected / ReasonSelectorModal.onCancel).
      return;
    }

    // Info-only: save as typo_correction, no reason prompt.
    onSave(payload, { reason: 'typo_correction', changes, note: '' });
    handleClose();
  };

  const handleReasonSelected = (reason: EditReason, note: string) => {
    if (!pendingAuditPayload) return;
    const { payload, changes } = pendingAuditPayload;
    setShowReasonSelector(false);
    setPendingAuditPayload(null);
    setIsSaving(false);
    onSave(payload, { reason, changes, note });
    handleClose();
  };

  const setStatusAndPrint = (status: string) => {
    if (!validateForm()) return;
    const payload = buildPayload({ status });
    printTicket(payload);
    upd('status', status);
    onSave(payload);
  };

  // Parts inventory (only parts/accessories)
  const partsInventory = useMemo(() =>
    inventory.filter((i) => ['part', 'accessory', 'Parts', 'Screen', 'Battery'].some((c) => i.category?.toLowerCase().includes(c.toLowerCase()))),
    [inventory]
  );

  const issues = [
    { icon: '📱', label: t('repair.issue.crackedScreen.label'),  value: t('repair.issue.crackedScreen.value') },
    { icon: '🔋', label: t('repair.issue.battery.label'),        value: t('repair.issue.battery.value') },
    { icon: '💧', label: t('repair.issue.waterDamage.label'),    value: t('repair.issue.waterDamage.value') },
    { icon: '🔌', label: t('repair.issue.chargingPort.label'),   value: t('repair.issue.chargingPort.value') },
    { icon: '🔇', label: t('repair.issue.noSound.label'),        value: t('repair.issue.noSound.value') },
    { icon: '📷', label: t('repair.issue.camera.label'),         value: t('repair.issue.camera.value') },
    { icon: '📶', label: t('repair.issue.noSignal.label'),       value: t('repair.issue.noSignal.value') },
    { icon: '🔘', label: t('repair.issue.buttons.label'),        value: t('repair.issue.buttons.value') },
    { icon: '🌡️', label: t('repair.issue.overheating.label'),   value: t('repair.issue.overheating.value') },
    { icon: '🖥️', label: t('repair.issue.wontTurnOn.label'),    value: t('repair.issue.wontTurnOn.value') },
    { icon: '📡', label: t('repair.issue.wifiBluetooth.label'),  value: t('repair.issue.wifiBluetooth.value') },
    { icon: '🔑', label: t('repair.issue.unlock.label'),         value: t('repair.issue.unlock.value') },
    { icon: '💾', label: t('repair.issue.storageFull.label'),    value: t('repair.issue.storageFull.value') },
    { icon: '🎤', label: t('repair.issue.microphone.label'),     value: t('repair.issue.microphone.value') },
    { icon: '🔧', label: t('repair.issue.diagnostic.label'),     value: t('repair.issue.diagnostic.value') },
  ];
  const diagOptions = [
    { icon: '🔄', label: t('repair.diag.replaceScreen.label'),   value: t('repair.diag.replaceScreen.value') },
    { icon: '🔋', label: t('repair.diag.replaceBattery.label'),  value: t('repair.diag.replaceBattery.value') },
    { icon: '🔌', label: t('repair.diag.cleanPort.label'),       value: t('repair.diag.cleanPort.value') },
    { icon: '💧', label: t('repair.diag.boardCleaning.label'),   value: t('repair.diag.boardCleaning.value') },
    { icon: '🎵', label: t('repair.diag.replaceSpeaker.label'),  value: t('repair.diag.replaceSpeaker.value') },
    { icon: '📷', label: t('repair.diag.replaceCamera.label'),   value: t('repair.diag.replaceCamera.value') },
    { icon: '🔘', label: t('repair.diag.fixButton.label'),       value: t('repair.diag.fixButton.value') },
    { icon: '🖥️', label: t('repair.diag.fullDiagnostic.label'), value: t('repair.diag.fullDiagnostic.value') },
    { icon: '🔑', label: t('repair.diag.removeAccount.label'),   value: t('repair.diag.removeAccount.value') },
    { icon: '💾', label: t('repair.diag.freeStorage.label'),     value: t('repair.diag.freeStorage.value') },
    { icon: '⚙️', label: t('repair.diag.restoreSW.label'),      value: t('repair.diag.restoreSW.value') },
    { icon: '🎤', label: t('repair.diag.replaceMic.label'),      value: t('repair.diag.replaceMic.value') },
  ];

  return (
    <Modal open onClose={handleClose}
      title={isEdit ? t('repairs.editTicketTitle', (r?.id || '').slice(-8).toUpperCase()) : t('repairs.newTicketTitle')}
      size="max-w-4xl"
    >
      <div style={{ maxHeight: '75vh', overflowY: 'auto', paddingRight: '2px', display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>

        {/* R-EDIT-AUDIT F3.3: banner when admin unlocks money fields post-completion. */}
        {isLocked && pin.editUnlocked && (
          <div style={{
            background: 'rgba(251, 191, 36, 0.15)',
            border: '1px solid rgba(251, 191, 36, 0.4)',
            borderRadius: '0.5rem',
            padding: '0.75rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.85rem',
          }}>
            <span>⚠️</span>
            <span>
              {t('repairs.editingCompletedBanner')}
            </span>
          </div>
        )}

        {/* ── Customer Info ─────────────────────────────────── */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.75rem', padding: '1rem' }}>
          <CustomerPicker
            customers={customers}
            selectedCustomer={selectedCustomer}
            lang={lang === 'es' ? 'es' : lang === 'pt' ? 'pt' : 'en'}
            allowClear
            onSelect={(c) => {
              setSelectedCustomer(c);
              if (c) {
                const parts = c.name.trim().split(' ');
                if (!form.firstName) upd('firstName', parts[0] || '');
                if (!form.lastName) upd('lastName', parts.slice(1).join(' ') || '');
                if (!form.customerPhone) upd('customerPhone', c.phone || '');
              }
            }}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginTop: '0.75rem' }}>
            <div>
              <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>{t('repairs.firstNameStarLabel')}</label>
              <AutocompleteInput
                value={form.firstName}
                onChange={(val) => upd('firstName', val)}
                onSelect={(opt) => {
                  upd('firstName', opt.value);
                  if (opt.data) {
                    const parts = (opt.data as Customer).name.trim().split(' ');
                    if (!form.lastName) upd('lastName', parts.slice(1).join(' ') || '');
                    if (!form.customerPhone) upd('customerPhone', (opt.data as Customer).phone || '');
                  }
                }}
                options={firstNameOptions}
                placeholder={t('repairs.firstNamePlaceholder')}
                maxResults={6}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>{t('repairs.lastNameStarLabel')}</label>
              <AutocompleteInput
                value={form.lastName}
                onChange={(val) => upd('lastName', val)}
                onSelect={(opt) => {
                  upd('lastName', opt.value);
                  if (opt.data) {
                    const parts = (opt.data as Customer).name.trim().split(' ');
                    if (!form.firstName) upd('firstName', parts[0] || '');
                    if (!form.customerPhone) upd('customerPhone', (opt.data as Customer).phone || '');
                  }
                }}
                options={lastNameOptions}
                placeholder={t('repairs.lastNamePlaceholder')}
                maxResults={6}
              />
            </div>
            <div style={{ position: 'relative' }}>
              <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>{t('repairs.phoneStarLabel')}</label>
              <AutocompleteInput
                type="tel"
                value={form.customerPhone}
                onChange={(val) => upd('customerPhone', val)}
                onSelect={(opt) => {
                  upd('customerPhone', opt.value);
                  if (opt.data) {
                    const parts = (opt.data as Customer).name.trim().split(' ');
                    if (!form.firstName) upd('firstName', parts[0] || '');
                    if (!form.lastName) upd('lastName', parts.slice(1).join(' ') || '');
                  }
                }}
                options={phoneOptions}
                placeholder={t('repairs.phonePlaceholder')}
                maxResults={6}
                matchHint={phoneMatch ? (
                  <div
                    style={{ fontSize: '0.72rem', color: '#34d399', display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}
                    onClick={() => {
                      const parts = phoneMatch.name.split(' ');
                      if (!form.firstName) upd('firstName', parts[0] || '');
                      if (!form.lastName) upd('lastName', parts.slice(1).join(' ') || '');
                    }}
                  >
                    ✅ {t('repairs.foundCustomerHint', phoneMatch.name)}
                    {` · ${phoneMatch.loyaltyPoints || 0} pts`}
                  </div>
                ) : undefined}
              />
            </div>
          </div>
        </div>

        {/* ── Device Info ───────────────────────────────────── */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.75rem', padding: '1rem' }}>
          <h4 style={{ fontSize: '0.875rem', fontWeight: 700, color: '#94a3b8', margin: '0 0 0.75rem 0' }}>
            📱 {t('repairs.deviceInfoHeader')}
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>{t('repairs.deviceTypeLabel')}</label>
              <select className="select" value={form.deviceType} onChange={(e) => upd('deviceType', e.target.value)}>
                {['Phone','Tablet','Watch','Laptop','Other'].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>{t('repairs.modelStarLabel')}</label>
              <AutocompleteInput
                value={form.model}
                onChange={(val) => upd('model', val)}
                onSelect={(opt) => upd('model', opt.value)}
                options={DEVICE_MODEL_OPTIONS}
                placeholder={t('repairs.devicePlaceholder')}
                maxResults={8}
              />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>{t('imei')}</label>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <input className="input" style={{ flex: 1, fontFamily: 'monospace' }} value={form.imei}
                  onChange={(e) => upd('imei', e.target.value)} placeholder={t('repairs.imeiPlaceholder')} maxLength={15} />
                <button type="button" onClick={generateIMEI} className="btn btn-secondary" title={t('repairs.generateImei')}
                  style={{ padding: '0 0.625rem', flexShrink: 0 }}>🔄</button>
              </div>
              <div style={{ fontSize: '0.65rem', color: '#475569', marginTop: '0.2rem' }}>{t('repairs.imeiAutoGenHint')}</div>
            </div>
            <div>
              <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>{t('repairs.devicePasswordLabel')}</label>
              <input className="input" value={form.password} onChange={(e) => upd('password', e.target.value)} placeholder={t('repairs.passwordPlaceholder')} />
            </div>
            <div>
              <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>{t('carrier')}</label>
              <AutocompleteInput
                value={form.carrier}
                onChange={(val) => upd('carrier', val)}
                onSelect={(opt) => upd('carrier', opt.value)}
                options={CARRIER_OPTIONS}
                placeholder={t('repairs.carrierPlaceholder')}
                maxResults={8}
              />
            </div>
          </div>

          {/* ── Device Photo ───────────────────────────────────── */}
          <div style={{ marginTop: '0.75rem' }}>
            <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>
              📷 {t('repairs.devicePhotoLabel')} <span style={{ color: '#475569', fontWeight: 400 }}>({t('repairs.optional')})</span>
            </label>

            {form.devicePhoto ? (
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <img
                  src={form.devicePhoto}
                  alt="Device"
                  style={{ width: '160px', height: '120px', objectFit: 'cover', borderRadius: '0.5rem', border: '1px solid rgba(255,255,255,0.12)', display: 'block' }}
                />
                <button
                  type="button"
                  onClick={() => upd('devicePhoto', '')}
                  style={{
                    position: 'absolute', top: '4px', right: '4px',
                    background: 'rgba(0,0,0,0.7)', border: 'none', borderRadius: '50%',
                    width: '22px', height: '22px', cursor: 'pointer',
                    color: '#fff', fontSize: '0.75rem', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                  }}
                  title={t('repairs.removePhotoTitle')}
                >✕</button>
              </div>
            ) : (
              <label
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                  padding: '0.5rem 1rem', borderRadius: '0.5rem', cursor: 'pointer',
                  background: 'rgba(255,255,255,0.05)', border: '1px dashed rgba(255,255,255,0.15)',
                  color: '#94a3b8', fontSize: '0.82rem', fontWeight: 500,
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.09)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; }}
              >
                <span>📷</span>
                <span>{t('repairs.takeUploadPhoto')}</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    // Round R1 F7: size + MIME guard. Protects shop PC memory
                    // from malicious/oversized files before FileReader reads.
                    if (file.size > 5 * 1024 * 1024) {
                      toast(t('repairs.imageTooLarge'), 'error');
                      (e.target as HTMLInputElement).value = '';
                      return;
                    }
                    if (!file.type.startsWith('image/')) {
                      toast(t('repairs.invalidFileImagesOnly'), 'error');
                      (e.target as HTMLInputElement).value = '';
                      return;
                    }
                    // Resize + convert to base64 (max 800px wide)
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                      const img = new Image();
                      img.onload = () => {
                        const maxW = 800;
                        const scale = img.width > maxW ? maxW / img.width : 1;
                        const canvas = document.createElement('canvas');
                        canvas.width  = img.width  * scale;
                        canvas.height = img.height * scale;
                        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
                        upd('devicePhoto', canvas.toDataURL('image/jpeg', 0.75));
                      };
                      img.src = ev.target?.result as string;
                    };
                    reader.readAsDataURL(file);
                    e.target.value = '';
                  }}
                />
              </label>
            )}
          </div>
        </div>

        {/* ── IMEI Device History ───────────────────────────── */}
        {(() => {
          const normImei = (s: string) => (s || '').replace(/\s+/g, '').trim();
          const imei = normImei(form.imei || '');
          if (!imei || imei.length < 10) return null;
          const history = allRepairs.filter(
            (r) => normImei(r.imei || '') === imei && r.id !== repair?.id,
          ).sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime());
          if (history.length === 0) return null;
          return (
            <div style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: '0.75rem', padding: '0.875rem' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#fbbf24', marginBottom: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                📋 {t('repairs.deviceHistoryHeader', history.length)}
              </div>
              {history.slice(0, 4).map((r) => (
                <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem 0', borderBottom: '1px solid rgba(251,191,36,0.1)', fontSize: '0.78rem' }}>
                  <div>
                    <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{r.issue}</span>
                    <span style={{ color: '#94a3b8', marginLeft: '0.5rem' }}>— {r.customerName}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                    <span style={{ color: normalizeRepairStatus(r.status) === REPAIR_STATUS.PICKED_UP ? '#34d399' : normalizeRepairStatus(r.status) === REPAIR_STATUS.CANCELLED ? '#f87171' : '#fbbf24', fontSize: '0.72rem' }}>{r.status}</span>
                    <span style={{ color: '#64748b', fontSize: '0.72rem' }}>{new Date(r.createdAt as string).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
              {history.length > 4 && (
                <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.4rem', textAlign: 'center' }}>
                  {t('repairs.moreShort', history.length - 4)}
                </div>
              )}
            </div>
          );
        })()}

        {/* ── Issue & Diagnosis ─────────────────────────────── */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.75rem', padding: '1rem' }}>
          <h4 style={{ fontSize: '0.875rem', fontWeight: 700, color: '#94a3b8', margin: '0 0 0.75rem 0' }}>
            🔍 {t('repairs.issueDiagnosisHeader')}
          </h4>

          {/* Issue pills */}
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.4rem', fontWeight: 600 }}>
              ⚡ {t('repairs.commonIssuesLabel')}
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.6rem' }}>
              {issues.map((issue) => (
                <PillButton key={issue.value} icon={issue.icon} label={issue.label}
                  selected={form.issue.includes(issue.value)}
                  onToggle={() => upd('issue', togglePill(form.issue, issue.value))} />
              ))}
            </div>
            <textarea className="textarea" rows={2}
              value={form.issue} onChange={(e) => upd('issue', e.target.value)}
              placeholder={t('repairs.issueTextarea')} />
          </div>

          {/* Diagnosis pills */}
          <div>
            <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.4rem', fontWeight: 600 }}>
              🔬 {t('repairs.diagnosisLabel')}
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.6rem' }}>
              {diagOptions.map((opt) => (
                <PillButton key={opt.value} icon={opt.icon} label={opt.label} color="#6ee7b7"
                  selected={form.diagnosis.includes(opt.value)}
                  onToggle={() => upd('diagnosis', togglePill(form.diagnosis, opt.value))} />
              ))}
            </div>
            <textarea className="textarea" rows={2}
              value={form.diagnosis} onChange={(e) => upd('diagnosis', e.target.value)}
              placeholder={t('repairs.diagnosisTextarea')} />
          </div>
        </div>

        {/* ── Parts & Labor ─────────────────────────────────── */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.75rem', padding: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h4 style={{ fontSize: '0.875rem', fontWeight: 700, color: '#94a3b8', margin: 0 }}>
              🔩 {t('repairs.partsLaborHeader')}
            </h4>
            <button type="button" onClick={addPart} className="btn btn-secondary btn-sm">
              + {t('repairs.addPart')}
            </button>
          </div>

          {form.parts.map((part, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 60px auto', gap: '0.5rem', marginBottom: '0.5rem', padding: '0.625rem', background: 'rgba(255,255,255,0.03)', borderRadius: '0.5rem', alignItems: 'center' }}>
              {/* Col 1: inventory selector */}
              <select className="select" value={part.partId || ''} onChange={(e) => updatePart(i, 'partId', e.target.value)} style={{ fontSize: '0.82rem' }}>
                <option value="">{t('repairs.selectPartCustom')}</option>
                {partsInventory.map((inv) => (
                  <option key={inv.id} value={inv.id}>{inv.name} — ${(inv.price / 100).toFixed(2)}</option>
                ))}
              </select>
              {/* Col 2: custom name — hidden when inventory item selected but keeps its column */}
              <input
                className="input"
                value={part.name || ''}
                onChange={(e) => updatePart(i, 'name', e.target.value)}
                placeholder={t('repairs.partNamePlaceholder')}
                style={{ fontSize: '0.82rem', visibility: part.partId ? 'hidden' : 'visible' }}
              />
              {/* Col 3: price */}
              <input type="number" className="input" value={part.price || ''} onChange={(e) => updatePart(i, 'price', e.target.value)}
                placeholder={t('repairs.partPricePlaceholder')} step="0.01" min="0" style={{ fontSize: '0.82rem' }} />
              {/* Col 4: qty */}
              <input type="number" className="input" value={part.quantity || 1} onChange={(e) => updatePart(i, 'quantity', e.target.value)}
                placeholder={t('repairs.qtyPlaceholder')} min="1" style={{ fontSize: '0.82rem' }} />
              {/* Col 5: remove */}
              <button type="button" onClick={() => removePart(i)} style={{ padding: '0 0.5rem', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '0.375rem', color: '#f87171', cursor: 'pointer', height: '36px' }}>✕</button>
            </div>
          ))}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.75rem', marginTop: '0.5rem' }}>
            <div>
              <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>
                {isLocked && !pin.editUnlocked && '🔒 '}{t('repairs.laborCostLabel')}
              </label>
              {/* R-EDIT-AUDIT F3.2: lock icon on laborCost when ticket is completed. */}
              <div style={{ position: 'relative' }}>
                <input
                  type="number"
                  className="input"
                  value={form.laborCost || ''}
                  onChange={(e) => upd('laborCost', parseFloat(e.target.value) || 0)}
                  placeholder={t('repairs.amountPlaceholder')}
                  step="0.01"
                  min="0"
                  disabled={isLocked && !pin.editUnlocked}
                  style={isLocked && !pin.editUnlocked ? { opacity: 0.6 } : undefined}
                />
                {isLocked && !pin.editUnlocked && (
                  <span
                    onClick={pin.requestUnlock}
                    style={{
                      position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                      cursor: 'pointer', fontSize: '1rem',
                    }}
                    title={t('repairs.unlockWithPin')}
                  >
                    🔒
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Cost breakdown */}
          <div style={{ marginTop: '0.875rem', padding: '0.875rem', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '0.625rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.3rem', color: '#94a3b8' }}>
              <span>{t('repairs.partsTotal')}</span><span>${partsTotal.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.3rem', color: '#94a3b8' }}>
              <span>{t('repairs.laborLabel')}</span><span>${laborCost.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.4rem', color: '#cbd5e1', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.4rem' }}>
              <span>{t('repairs.subtotal')}</span><span>${subtotal.toFixed(2)}</span>
            </div>
            {/* Tax toggle */}
            {/* R-EDIT-AUDIT F3.2: taxable is a money-impacting toggle — lock on completed tickets. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.5rem', background: 'rgba(255,255,255,0.03)', borderRadius: '0.4rem', border: '1px solid rgba(255,255,255,0.08)', marginBottom: '0.4rem', opacity: isLocked && !pin.editUnlocked ? 0.6 : 1 }}>
              <input
                type="checkbox"
                id="repair-taxable"
                checked={!!form.taxable}
                onChange={(e) => upd('taxable', e.target.checked)}
                disabled={isLocked && !pin.editUnlocked}
                style={{ cursor: isLocked && !pin.editUnlocked ? 'not-allowed' : 'pointer' }}
              />
              <label htmlFor="repair-taxable" style={{ fontSize: '0.78rem', color: '#cbd5e1', cursor: isLocked && !pin.editUnlocked ? 'not-allowed' : 'pointer' }}>
                {isLocked && !pin.editUnlocked && '🔒 '}
                {t('repairs.applyTaxLabel', (taxRate * 100).toFixed(2))}
              </label>
              {isLocked && !pin.editUnlocked ? (
                <span
                  onClick={pin.requestUnlock}
                  style={{ marginLeft: 'auto', cursor: 'pointer', fontSize: '0.9rem' }}
                  title={t('repairs.unlockWithPin')}
                >
                  🔒
                </span>
              ) : (
                <span style={{ fontSize: '0.68rem', color: '#64748b', marginLeft: 'auto' }}>
                  {t('repairs.defaultOff')}
                </span>
              )}
            </div>
            {form.taxable && taxCents > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.3rem', color: '#f59e0b' }}>
                <span>{t('repairs.taxLabel', (taxRate * 100).toFixed(2))}</span>
                <span>+${taxAmt.toFixed(2)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1rem', fontWeight: 800, color: '#22c55e', borderTop: '1px solid rgba(16,185,129,0.3)', paddingTop: '0.5rem' }}>
              <span>TOTAL:</span><span>${total.toFixed(2)}</span>
            </div>
            <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>
                {isEdit && '🔒 '}{t('repairs.depositLabel')}
              </label>
              <input type="number" className="input" value={form.deposit || ''} onChange={(e) => !isEdit && upd('deposit', parseFloat(e.target.value) || 0)}
                placeholder={t('repairs.depositPlaceholder')} step="0.01" min="0" max={total}
                disabled={isEdit}
                style={{ borderColor: depositAmt > total && total > 0 ? '#ef4444' : undefined, opacity: isEdit ? 0.6 : 1 }} />
              {/* Deposit paid display - always shown when there's a deposit */}
              {depositAmt > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem', padding: '0.5rem 0.75rem', background: 'rgba(34,197,94,0.1)', borderRadius: '0.375rem', fontSize: '0.875rem', fontWeight: 700 }}>
                  <span style={{ color: '#94a3b8' }}>{t('repairs.depositPaidShort')}</span>
                  <span style={{ color: '#22c55e' }}>${depositAmt.toFixed(2)}</span>
                </div>
              )}
              {balance > 0 && depositAmt > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.4rem', padding: '0.5rem 0.75rem', background: 'rgba(251,191,36,0.1)', borderRadius: '0.375rem', fontSize: '0.875rem', fontWeight: 700 }}>
                  <span style={{ color: '#94a3b8' }}>{t('repairs.remaining')}</span>
                  <span style={{ color: '#f59e0b' }}>${balance.toFixed(2)}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Status, Priority, Details ─────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
          <div>
            <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>{t('status')}</label>
            {/* Round R2: UI labels stay friendly; values persist as canonical snake_case. */}
            <select className="select" value={normalizeRepairStatus(form.status) || REPAIR_STATUS.RECEIVED} onChange={(e) => upd('status', e.target.value)}>
              {orderedRepairStatusOptions.map((s) => {
                const label = (() => {
                  switch (s) {
                    case REPAIR_STATUS.RECEIVED:      return t('repairs.statusReceived');
                    case REPAIR_STATUS.IN_PROGRESS:   return t('repairs.statusInProgress');
                    case REPAIR_STATUS.WAITING_PARTS: return t('repairs.statusWaitingParts');
                    case REPAIR_STATUS.READY:         return t('repairs.statusReady');
                    case REPAIR_STATUS.PICKED_UP:     return t('repairs.statusComplete');
                    case REPAIR_STATUS.CANCELLED:     return t('repairs.statusCancelled');
                    default: return s;
                  }
                })();
                return <option key={s} value={s}>{label}</option>;
              })}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>{t('priority')}</label>
            <select className="select" value={form.priority} onChange={(e) => upd('priority', e.target.value)}>
              {['Low','Normal','High','Urgent'].map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>{t('repairs.estCompletion')}</label>
            <input type="date" className="input" value={form.estimatedCompletion} onChange={(e) => upd('estimatedCompletion', e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>
              🛡️ {t('repairs.warrantyDays')}
            </label>
            <input
              type="number"
              className="input"
              min={0}
              max={365}
              value={form.warranty}
              onChange={(e) => upd('warranty', parseInt(e.target.value, 10) || 0)}
              placeholder={t('repairs.warrantyDaysPlaceholder')}
            />
          </div>
        </div>

        {/* ── Notes ────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div>
            <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>{t('repairs.customerNotes')}</label>
            <textarea className="textarea" rows={3} value={form.notes} onChange={(e) => upd('notes', e.target.value)}
              placeholder={t('repairs.customerNotesPlaceholder')} />
          </div>
          <div>
            <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>{t('repairs.internalNotes')}</label>
            <textarea className="textarea" rows={3} value={form.internalNotes} onChange={(e) => upd('internalNotes', e.target.value)}
              placeholder={t('repairs.internalNotesPlaceholder')} />
          </div>
          {/* Diagnosis outcome — conversion tracking */}
          <div>
            <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.4rem', fontWeight: 600 }}>
              📊 {t('repairs.diagnosisOutcome')}
            </label>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              {[
                { value: 'accepted', label: t('repairs.diagnosisAccepted'), color: '#22c55e' },
                { value: 'pending',  label: t('repairs.diagnosisPending'), color: '#f59e0b' },
                { value: 'declined', label: t('repairs.diagnosisDeclined'), color: '#ef4444' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => upd('diagnosisOutcome', form.diagnosisOutcome === opt.value ? '' : opt.value)}
                  style={{
                    flex: 1, padding: '0.4rem 0.5rem', borderRadius: '0.5rem', fontSize: '0.75rem',
                    border: `1px solid ${form.diagnosisOutcome === opt.value ? opt.color : 'rgba(255,255,255,0.1)'}`,
                    background: form.diagnosisOutcome === opt.value ? `${opt.color}22` : 'rgba(255,255,255,0.03)',
                    color: form.diagnosisOutcome === opt.value ? opt.color : '#64748b',
                    cursor: 'pointer', fontWeight: form.diagnosisOutcome === opt.value ? 700 : 400,
                    transition: 'all 0.15s',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Quick Actions (edit only) ─────────────────────── */}
        {isEdit && (
          <>
            {/* Tracking link */}
            {repair?.trackingToken && settings.repairStatusBaseUrl && (
              <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '0.625rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <span style={{ fontSize: '1.1rem' }}>🔗</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: '2px', fontWeight: 600 }}>
                    {t('repairs.repairTrackingLink')}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#34d399', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {`${settings.repairStatusBaseUrl}?t=${repair.trackingToken}`}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  style={{ flexShrink: 0, fontSize: '0.7rem', padding: '0.25rem 0.6rem' }}
                  onClick={() => {
                    navigator.clipboard.writeText(`${settings.repairStatusBaseUrl}?t=${repair.trackingToken}`).catch(() => {});
                    toast(t('repairs.linkCopied'), 'success');
                  }}
                >
                  📋 {t('repairs.copyLink')}
                </button>
              </div>
            )}
            <div style={{ padding: '0.75rem', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.625rem' }}>
              <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: '0.5rem', fontWeight: 600 }}>
                ⚡ {t('repairs.quickActions')}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {/* Round R2: canonical snake_case comparisons; setStatusAndPrint persists canonical. */}
                {normalizeRepairStatus(form.status) !== REPAIR_STATUS.RECEIVED && normalizeRepairStatus(form.status) !== REPAIR_STATUS.PICKED_UP && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setStatusAndPrint(REPAIR_STATUS.RECEIVED)}>
                    📥 {t('repairs.receivedAndPrint')}
                  </button>
                )}
                <button type="button"
                  className={`btn btn-sm ${normalizeRepairStatus(form.status) === REPAIR_STATUS.PICKED_UP ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setStatusAndPrint(REPAIR_STATUS.PICKED_UP)}
                  disabled={normalizeRepairStatus(form.status) === REPAIR_STATUS.PICKED_UP}
                  style={{ opacity: normalizeRepairStatus(form.status) === REPAIR_STATUS.PICKED_UP ? 0.7 : 1 }}>
                  ✅ {normalizeRepairStatus(form.status) === REPAIR_STATUS.PICKED_UP ? t('repairs.completedShortCheck') : t('repairs.completePrint')}
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => {
                  const depositCents = (repair as any)?.depositAmount || 0;
                  if (repair && depositCents > 0 && onRequestCancel) {
                    handleClose();
                    onRequestCancel(repair);
                  } else {
                    setStatusAndPrint(REPAIR_STATUS.CANCELLED);
                  }
                }}>
                  ❌ {t('repairs.cancelAndPrint')}
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => printTicket()}>
                  🖨️ {t('repairs.printShort')}
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => printWarranty()}
                  title={t('repairs.warrantyTitle')}
                  style={{ background: 'rgba(16,185,129,0.12)', borderColor: 'rgba(16,185,129,0.3)', color: '#34d399' }}>
                  🛡️ {t('repairs.warrantyShort')}
                </button>
                {balance > 0 && repair && onCollectBalance && (
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => {
                    onCollectBalance(repair);
                    handleClose();
                  }}>
                    💰 ${balance.toFixed(2)} {t('repairs.collect')}
                  </button>
                )}
              </div>
            </div>
            <div style={{ padding: '0.75rem', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.625rem' }}>
              <button type="button" className="btn btn-secondary" style={{ width: '100%' }} onClick={() => printTicket(buildPayload(), true)}>
                📝 {t('repairs.printNotesOnly')}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Validation error banner — replaces all alert() calls */}
      {validationError && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 0.75rem', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: '0.5rem', marginBottom: '0.5rem' }}>
          <span style={{ color: '#f87171', fontSize: '0.85rem', flex: 1 }}>⚠ {validationError}</span>
          <button type="button" onClick={() => setValidationError(null)} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '1rem', lineHeight: 1 }}>×</button>
        </div>
      )}

      {/* Footer */}
      <div style={{ display: 'flex', gap: '0.5rem', paddingTop: '1rem', marginTop: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <button type="button" onClick={handleClose} className="btn btn-secondary" style={{ flex: 1 }}>{t('repairs.cancel')}</button>
        {!isEdit && (
          <button type="button" onClick={() => {
            upd('firstName', ''); upd('lastName', ''); upd('customerPhone', '');
            upd('model', ''); upd('imei', ''); upd('issue', ''); upd('diagnosis', '');
            upd('parts', []); upd('laborCost', 0); upd('deposit', 0); upd('notes', ''); upd('internalNotes', '');
          }} className="btn btn-secondary" style={{ flex: 0.7 }}>
            🗑️ {t('repairs.clear')}
          </button>
        )}
        {!isEdit && (
          <button type="button" onClick={() => printTicket(buildPayload())} className="btn btn-secondary" style={{ flex: 0.7 }}>
            🖨️ {lang === 'es' ? 'Imprimir' : 'Print'}
          </button>
        )}
        <button type="button" onClick={handleSubmit} className="btn btn-primary" style={{ flex: 1 }}>
          ✓ {isEdit ? t('repairs.save') : t('repairs.createTicket')}
        </button>
      </div>

      {/* R-EDIT-AUDIT F3.5: reason selector when locked-ticket money fields change. */}
      <ReasonSelectorModal
        open={showReasonSelector}
        lang={lang}
        onSelect={handleReasonSelected}
        onCancel={() => {
          setShowReasonSelector(false);
          setPendingAuditPayload(null);
          setIsSaving(false);
        }}
      />

      {/* R-EDIT-AUDIT F3.3: admin PIN challenge for unlocking money fields. */}
      <AdminPinGate
        open={pin.showPinGate}
        adminPin={settings?.adminPin || ''}
        onSuccess={pin.handleSuccess}
        onCancel={pin.handleCancel}
      />
    </Modal>
  );
}
