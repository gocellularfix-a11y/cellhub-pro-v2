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
import { formatCurrency } from '@/utils/currency';
import { calcDepositTotals } from '@/utils/depositTax';
import { generateId } from '@/utils/dates';
import { usePrint } from '@/hooks/usePrint';
import { normalizePhone } from '@/utils/normalize';
import { CARRIER_OPTIONS, DEVICE_MODEL_OPTIONS } from '@/config/autocompleteData';
import CustomerSearchHeader from '@/components/shared/CustomerSearchHeader';
import AdminPinGate from '@/components/shared/AdminPinGate';
import { usePinGate } from '@/hooks/usePinGate';
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

interface Props {
  repair: Repair | null;
  customers: Customer[];
  inventory: InventoryItem[];
  settings: StoreSettings;
  allRepairs?: Repair[];
  onSave: (data: Partial<Repair>) => void;
  onCollectBalance?: (repair: Repair) => void;
  onRequestCancel?: (repair: Repair) => void;
  onClose: () => void;
  lang: string;
  L: Record<string, any>;
}

const ISSUES_EN = [
  { icon: '📱', label: 'Cracked Screen',  value: 'Cracked / broken screen' },
  { icon: '🔋', label: 'Battery',         value: 'Battery not charging / drains fast' },
  { icon: '💧', label: 'Water Damage',    value: 'Water / liquid damage' },
  { icon: '🔌', label: 'Charging Port',   value: 'Charging port not working' },
  { icon: '🔇', label: 'No Sound',        value: 'No sound / speaker not working' },
  { icon: '📷', label: 'Camera',          value: 'Camera not working / blurry photos' },
  { icon: '📶', label: 'No Signal',       value: 'No signal / not connecting to network' },
  { icon: '🔘', label: 'Buttons',         value: 'Buttons not responding (power/volume)' },
  { icon: '🌡️', label: 'Overheating',    value: 'Phone overheating' },
  { icon: '🖥️', label: "Won't Turn On",  value: "Won't turn on / black screen" },
  { icon: '📡', label: 'WiFi/Bluetooth', value: 'WiFi or Bluetooth not working' },
  { icon: '🔑', label: 'Unlock',          value: 'Account unlock / iCloud / FRP bypass' },
  { icon: '💾', label: 'Storage Full',    value: 'Storage full / no space' },
  { icon: '🎤', label: 'Microphone',      value: 'Microphone not working / no sound from mic' },
  { icon: '🔧', label: 'Diagnostic',      value: 'General device diagnostic' },
];

const ISSUES_ES = [
  { icon: '📱', label: 'Pantalla Rota',   value: 'Pantalla rota / agrietada' },
  { icon: '🔋', label: 'Batería',          value: 'Batería no carga / se agota rápido' },
  { icon: '💧', label: 'Daño de Agua',    value: 'Daño por agua / líquido' },
  { icon: '🔌', label: 'Puerto de Carga', value: 'Puerto de carga no funciona' },
  { icon: '🔇', label: 'Sin Sonido',      value: 'Sin sonido / bocina no funciona' },
  { icon: '📷', label: 'Cámara',           value: 'Cámara no funciona / fotos borrosas' },
  { icon: '📶', label: 'Sin Señal',        value: 'Sin señal / no conecta a red' },
  { icon: '🔘', label: 'Botones',          value: 'Botones no responden (power/volumen)' },
  { icon: '🌡️', label: 'Se Calienta',    value: 'Teléfono se sobrecalienta' },
  { icon: '🖥️', label: 'No Enciende',    value: 'No enciende / pantalla negra' },
  { icon: '📡', label: 'WiFi/Bluetooth', value: 'WiFi o Bluetooth no funciona' },
  { icon: '🔑', label: 'Desbloquear',     value: 'Desbloqueo de cuenta / iCloud / FRP' },
  { icon: '💾', label: 'Sin Espacio',     value: 'Sin espacio de almacenamiento' },
  { icon: '🎤', label: 'Micrófono',       value: 'Micrófono no funciona / no escuchan' },
  { icon: '🔧', label: 'Diagnóstico',     value: 'Diagnóstico general del dispositivo' },
];

const DIAG_EN = [
  { icon: '🔄', label: 'Replace Screen',    value: 'Replace screen' },
  { icon: '🔋', label: 'Replace Battery',   value: 'Replace battery' },
  { icon: '🔌', label: 'Clean Port',        value: 'Clean / repair charging port' },
  { icon: '💧', label: 'Board Cleaning',    value: 'Board cleaning for water damage' },
  { icon: '🎵', label: 'Replace Speaker',   value: 'Replace speaker / earpiece' },
  { icon: '📷', label: 'Replace Camera',    value: 'Replace camera module' },
  { icon: '🔘', label: 'Fix Button',        value: 'Repair power / volume button' },
  { icon: '🖥️', label: 'Full Diagnostic', value: 'Full device diagnostic' },
  { icon: '🔑', label: 'Remove Account',    value: 'Remove iCloud / Google FRP account' },
  { icon: '💾', label: 'Free Storage',      value: 'Free up storage / delete files' },
  { icon: '⚙️', label: 'Restore SW',       value: 'Software restore / OS update' },
  { icon: '🎤', label: 'Replace Mic',       value: 'Replace microphone' },
];

const DIAG_ES = [
  { icon: '🔄', label: 'Reemplazar Pantalla', value: 'Reemplazar pantalla' },
  { icon: '🔋', label: 'Cambiar Batería',      value: 'Cambiar batería' },
  { icon: '🔌', label: 'Limpiar Puerto',       value: 'Limpiar/reparar puerto de carga' },
  { icon: '💧', label: 'Limpiar Placa',        value: 'Limpieza de placa por daño de agua' },
  { icon: '🎵', label: 'Cambiar Bocina',       value: 'Cambiar bocina / altavoz' },
  { icon: '📷', label: 'Cambiar Cámara',       value: 'Reemplazar módulo de cámara' },
  { icon: '🔘', label: 'Reparar Botón',        value: 'Reparar botón de encendido/volumen' },
  { icon: '🖥️', label: 'Diagnóstico',        value: 'Diagnóstico completo del dispositivo' },
  { icon: '🔑', label: 'Eliminar Cuenta',      value: 'Eliminar cuenta iCloud / Google FRP' },
  { icon: '💾', label: 'Liberar Espacio',      value: 'Liberar espacio / eliminar archivos' },
  { icon: '⚙️', label: 'Restaurar SW',        value: 'Restaurar software / actualizar sistema' },
  { icon: '🎤', label: 'Cambiar Micrófono',    value: 'Reemplazar micrófono' },
];

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

export default function RepairModal({ repair, customers, inventory, settings, allRepairs = [], onSave, onCollectBalance, onRequestCancel, onClose, lang, L }: Props) {
  const es = lang === 'es';
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

  // Wrap onClose so closing the modal (X, Cancel, etc.) clears the PIN unlock.
  const handleClose = () => {
    pin.resetLock();
    onClose();
  };

  // r-customer-picker-sweep: customer search state (showCustSearch, customerSearch,
  // custResults) was extracted into the CustomerSearchHeader component. The header
  // now manages its own search state and just calls back via onSelect when a
  // customer is picked. The 3 AutocompleteInputs below are kept as-is — they still
  // provide per-field autocomplete on top of the header search button.
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

  // Print ticket
  const printTicket = (payload: any = buildPayload(), notesOnly = false) => {
    const storeName = settings.storeName || 'CellHub Pro';
    const storeAddr = settings.storeAddress || '';
    const storePhone = settings.storePhone || '';
    const fmt = (v: any) => v == null ? '' : String(v);
    const money = (v: number) => `$${(v / 100).toFixed(2)}`;
    const lines = [
      storeName.toUpperCase(), storeAddr,
      storePhone, '----------------------------------------',
      `TICKET: ${fmt(payload.ticketNumber || r?.id?.slice(-8).toUpperCase() || '')}`,
      `STATUS: ${fmt(payload.status)}`,
      `DATE: ${new Date(payload.updatedAt || Date.now()).toLocaleString()}`,
      '----------------------------------------',
      `CUSTOMER: ${fmt(payload.customerName)}`,
      payload.customerPhone ? `PHONE: ${fmt(payload.customerPhone)}` : '',
      '----------------------------------------',
      `DEVICE: ${fmt(payload.brand)} ${fmt(payload.model)}`,
      payload.imei ? `IMEI: ${fmt(payload.imei)}` : '',
      '----------------------------------------',
      'ISSUE:', fmt(payload.issue),
      payload.notes ? '----------------------------------------' : '',
      payload.notes ? 'NOTES:' : '', payload.notes ? fmt(payload.notes) : '',
      '----------------------------------------',
      ...(() => {
        const partsCents = (payload.subtotal || 0) - (payload.laborCost || 0);
        const lines = [];
        if (partsCents > 0) lines.push(`PARTS: ${money(partsCents)}`);
        if (payload.laborCost) lines.push(`LABOR: ${money(payload.laborCost)}`);
        lines.push(`SUBTOTAL: ${money(payload.subtotal)}`);
        if (payload.taxable && payload.taxAmount > 0) lines.push(`TAX (${((payload.taxRate || 0) * 100).toFixed(2)}%): ${money(payload.taxAmount)}`);
        lines.push(`TOTAL: ${money(payload.total)}`);
        lines.push(`DEPOSIT: ${money(payload.depositAmount)}`);
        lines.push(`BALANCE: ${money(payload.balance)}`);
        lines.push('----------------------------------------');
        return lines;
      })(),
    ].filter(Boolean);
    const content = lines.join('\n');
    // Build self-contained HTML for the ticket
    const html = `<!DOCTYPE html><html><head><title>Repair Ticket ${escHtml(payload.ticketNumber || '')}</title><style>@page{size:4in 6in;margin:0}html,body{width:4in;height:6in;margin:0;padding:0}body{font-family:monospace}.paper{width:4in;height:6in;padding:.25in;box-sizing:border-box}pre{font-size:14px;line-height:1.5;white-space:pre-wrap;word-break:break-word;margin:0}</style></head><body><div class="paper"><pre>${content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre></div></body></html>`;
    // r-print-audit: unified Chromium print dialog via usePrint hook
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
    const fmtDate = (d: Date) => d.toLocaleDateString(es ? 'es-MX' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' });
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

    const warrantyBody = escHtml(settings.warrantyText ||
      (es
        ? `Esta garantía cubre defectos de mano de obra y piezas instaladas durante la reparación. No cubre daños físicos, daños por líquidos, software de terceros ni problemas no relacionados con la reparación original. Para hacer válida esta garantía, presente este documento en nuestra tienda.`
        : `This warranty covers defects in workmanship and parts installed during the repair. It does not cover physical damage, liquid damage, third-party software, or issues unrelated to the original repair. To claim this warranty, present this document at our store.`));

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${es ? 'Garantía de Reparación' : 'Repair Warranty'}</title>
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
  @media print { html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
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
      🛡️ ${es ? 'CERTIFICADO DE GARANTÍA' : 'WARRANTY CERTIFICATE'}
    </div>
    <div style="font-size:9px;color:#555;margin-top:2px">
      ${es ? 'Garantía de Reparación' : 'Repair Warranty'}
    </div>
  </div>
  <hr class="sep-solid">

  <!-- Ticket + customer -->
  <div style="margin:4px 0">
    <div class="row">
      <span class="bold">${es ? 'Ticket' : 'Ticket'}:</span>
      <span class="bold" style="font-family:monospace">#${ticketNum}</span>
    </div>
    <div class="row">
      <span class="bold">${es ? 'Cliente' : 'Customer'}:</span>
      <span>${custName}</span>
    </div>
    <div class="row">
      <span class="bold">${es ? 'Dispositivo' : 'Device'}:</span>
      <span>${device}</span>
    </div>
    ${imei ? `<div class="row"><span class="bold">IMEI:</span><span style="font-family:monospace;font-size:9px">${imei}</span></div>` : ''}
    <div class="row">
      <span class="bold">${es ? 'Servicio' : 'Service'}:</span>
      <span style="max-width:2.2in;text-align:right">${issue}</span>
    </div>
    ${techNotes ? `<div style="font-size:8.5px;color:#444;margin-top:2px">${es ? 'Notas' : 'Notes'}: ${techNotes}</div>` : ''}
    <div class="row" style="margin-top:3px">
      <span class="bold">Total:</span>
      <span class="bold">${totalAmt}</span>
    </div>
  </div>
  <hr class="sep">

  <!-- Warranty period -->
  <div style="margin:4px 0;background:#f5f5f5;border:1px solid #ccc;border-radius:4px;padding:5px 7px">
    <div class="center bold" style="font-size:11px;margin-bottom:3px">
      ${es ? `GARANTÍA: ${warrantyDays} DÍAS` : `WARRANTY: ${warrantyDays} DAYS`}
    </div>
    <div class="row" style="font-size:9.5px">
      <span>${es ? 'Fecha de servicio' : 'Service date'}:</span>
      <span class="bold">${fmtDate(completedDate)}</span>
    </div>
    <div class="row" style="font-size:9.5px">
      <span>${es ? 'Vence el' : 'Expires on'}:</span>
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
        <div>${es ? 'Firma del Cliente' : 'Customer Signature'}</div>
      </div>
      <div style="width:12px"></div>
      <div style="flex:1">
        <div style="border-bottom:1px solid #000;height:18px;margin-bottom:2px"></div>
        <div>${es ? 'Técnico / Tienda' : 'Technician / Store'}</div>
      </div>
    </div>
  </div>

  <!-- Footer -->
  <div class="center" style="font-size:8px;color:#666;margin-top:5px;border-top:1px dashed #ccc;padding-top:4px">
    ${es ? '¡Gracias por confiar en nosotros!' : 'Thank you for your business!'}
    ${storePhoneEsc ? `<br>${es ? 'Preguntas' : 'Questions'}? ${storePhoneEsc}` : ''}
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
      setValidationError(es ? 'Nombre, apellido y teléfono son requeridos' : 'First name, last name and phone are required');
      return false;
    }
    const phoneLen = form.customerPhone.replace(/\D/g, '').length;
    if (phoneLen > 0 && phoneLen !== 10) {
      setValidationError(es ? 'Teléfono debe ser 10 dígitos' : 'Phone must be 10 digits');
      return false;
    }
    if (!form.model.trim()) { setValidationError(es ? 'Modelo del dispositivo requerido' : 'Device model required'); return false; }
    if (!form.issue.trim()) { setValidationError(es ? 'Descripción del problema requerida' : 'Issue description required'); return false; }
    if (depositAmt > total && total > 0) {
      setValidationError(es ? `Depósito no puede exceder el total ($${total.toFixed(2)})` : `Deposit cannot exceed total ($${total.toFixed(2)})`);
      return false;
    }
    return true;
  };

  const handleSubmit = () => {
    if (!validateForm()) return;
    onSave(buildPayload());
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

  const issues = es ? ISSUES_ES : ISSUES_EN;
  const diagOptions = es ? DIAG_ES : DIAG_EN;

  return (
    <Modal open onClose={handleClose}
      title={isEdit ? `✏️ ${es ? 'Editar Ticket' : 'Edit Ticket'} #${(r?.id || '').slice(-8).toUpperCase()}` : `🔧 ${es ? 'Nuevo Ticket de Reparación' : 'New Repair Ticket'}`}
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
              {es
                ? 'Editando ticket completado. Los cambios se registrarán.'
                : 'Editing completed ticket. Changes will be logged.'}
            </span>
          </div>
        )}

        {/* ── Customer Info ─────────────────────────────────── */}
        {/* r-customer-picker-sweep: replaced inline header bar + dropdown
            with shared <CustomerSearchHeader>. The 3 AutocompleteInputs
            below are passed as children — they keep their per-field
            autocomplete behavior on top of the header search button. */}
        <CustomerSearchHeader
          customers={customers}
          lang={es ? 'es' : 'en'}
          onSelect={(c) => {
            const parts = c.name.trim().split(' ');
            upd('firstName', parts[0] || '');
            upd('lastName', parts.slice(1).join(' ') || '');
            upd('customerPhone', c.phone || '');
          }}
        >

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>{es ? 'Nombre *' : 'First Name *'}</label>
              <AutocompleteInput
                value={form.firstName}
                onChange={(val) => upd('firstName', val)}
                onSelect={(opt) => {
                  upd('firstName', opt.value);
                  if (opt.data) {
                    const parts = (opt.data as Customer).name.trim().split(' ');
                    upd('lastName', parts.slice(1).join(' ') || '');
                    upd('customerPhone', (opt.data as Customer).phone || '');
                  }
                }}
                options={firstNameOptions}
                placeholder={es ? 'Jorge' : 'John'}
                maxResults={6}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>{es ? 'Apellido *' : 'Last Name *'}</label>
              <AutocompleteInput
                value={form.lastName}
                onChange={(val) => upd('lastName', val)}
                onSelect={(opt) => {
                  upd('lastName', opt.value);
                  if (opt.data) {
                    const parts = (opt.data as Customer).name.trim().split(' ');
                    upd('firstName', parts[0] || form.firstName);
                    upd('customerPhone', (opt.data as Customer).phone || '');
                  }
                }}
                options={lastNameOptions}
                placeholder={es ? 'Ochoa' : 'Doe'}
                maxResults={6}
              />
            </div>
            <div style={{ position: 'relative' }}>
              <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>{es ? 'Teléfono *' : 'Phone *'}</label>
              <AutocompleteInput
                type="tel"
                value={form.customerPhone}
                onChange={(val) => upd('customerPhone', val)}
                onSelect={(opt) => {
                  upd('customerPhone', opt.value);
                  if (opt.data) {
                    const parts = (opt.data as Customer).name.trim().split(' ');
                    upd('firstName', parts[0] || '');
                    upd('lastName', parts.slice(1).join(' ') || '');
                  }
                }}
                options={phoneOptions}
                placeholder="(555) 123-4567"
                maxResults={6}
                matchHint={phoneMatch ? (
                  <div
                    style={{ fontSize: '0.72rem', color: '#34d399', display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}
                    onClick={() => {
                      const parts = phoneMatch.name.split(' ');
                      upd('firstName', parts[0] || '');
                      upd('lastName', parts.slice(1).join(' ') || '');
                    }}
                  >
                    ✅ {es ? `Cliente: ${phoneMatch.name}` : `Found: ${phoneMatch.name}`}
                    {` · ${phoneMatch.loyaltyPoints || 0} pts`}
                  </div>
                ) : undefined}
              />
            </div>
          </div>
        </CustomerSearchHeader>

        {/* ── Device Info ───────────────────────────────────── */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.75rem', padding: '1rem' }}>
          <h4 style={{ fontSize: '0.875rem', fontWeight: 700, color: '#94a3b8', margin: '0 0 0.75rem 0' }}>
            📱 {es ? 'Información del Dispositivo' : 'Device Information'}
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>{es ? 'Tipo de Dispositivo' : 'Device Type'}</label>
              <select className="select" value={form.deviceType} onChange={(e) => upd('deviceType', e.target.value)}>
                {['Phone','Tablet','Watch','Laptop','Other'].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>{es ? 'Modelo *' : 'Model *'}</label>
              <AutocompleteInput
                value={form.model}
                onChange={(val) => upd('model', val)}
                onSelect={(opt) => upd('model', opt.value)}
                options={DEVICE_MODEL_OPTIONS}
                placeholder="iPhone 15 Pro"
                maxResults={8}
              />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>IMEI</label>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <input className="input" style={{ flex: 1, fontFamily: 'monospace' }} value={form.imei}
                  onChange={(e) => upd('imei', e.target.value)} placeholder="15 digits" maxLength={15} />
                <button type="button" onClick={generateIMEI} className="btn btn-secondary" title={es ? 'Generar IMEI de prueba' : 'Generate dummy IMEI'}
                  style={{ padding: '0 0.625rem', flexShrink: 0 }}>🔄</button>
              </div>
              <div style={{ fontSize: '0.65rem', color: '#475569', marginTop: '0.2rem' }}>{es ? 'Auto-generar si no disponible' : 'Auto-generate if unavailable'}</div>
            </div>
            <div>
              <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>{es ? 'Contraseña' : 'Device Password'}</label>
              <input className="input" value={form.password} onChange={(e) => upd('password', e.target.value)} placeholder="Optional" />
            </div>
            <div>
              <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>Carrier</label>
              <AutocompleteInput
                value={form.carrier}
                onChange={(val) => upd('carrier', val)}
                onSelect={(opt) => upd('carrier', opt.value)}
                options={CARRIER_OPTIONS}
                placeholder="AT&T, T-Mobile..."
                maxResults={8}
              />
            </div>
          </div>

          {/* ── Device Photo ───────────────────────────────────── */}
          <div style={{ marginTop: '0.75rem' }}>
            <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>
              📷 {es ? 'Foto del Dispositivo' : 'Device Photo'} <span style={{ color: '#475569', fontWeight: 400 }}>({es ? 'opcional' : 'optional'})</span>
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
                  title={es ? 'Eliminar foto' : 'Remove photo'}
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
                <span>{es ? 'Tomar / subir foto' : 'Take / upload photo'}</span>
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
                      toast(
                        es ? 'Imagen demasiado grande (máx 5MB)' : 'Image too large (max 5MB)',
                        'error',
                      );
                      (e.target as HTMLInputElement).value = '';
                      return;
                    }
                    if (!file.type.startsWith('image/')) {
                      toast(
                        es ? 'Archivo inválido. Solo imágenes.' : 'Invalid file. Images only.',
                        'error',
                      );
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
                📋 {es ? `Historial del dispositivo — ${history.length} reparación${history.length > 1 ? 'es' : ''} previa${history.length > 1 ? 's' : ''}` : `Device history — ${history.length} previous repair${history.length > 1 ? 's' : ''}`}
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
                  {es ? `+ ${history.length - 4} más` : `+ ${history.length - 4} more`}
                </div>
              )}
            </div>
          );
        })()}

        {/* ── Issue & Diagnosis ─────────────────────────────── */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.75rem', padding: '1rem' }}>
          <h4 style={{ fontSize: '0.875rem', fontWeight: 700, color: '#94a3b8', margin: '0 0 0.75rem 0' }}>
            🔍 {es ? 'Problema y Diagnóstico' : 'Issue & Diagnosis'}
          </h4>

          {/* Issue pills */}
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.4rem', fontWeight: 600 }}>
              ⚡ {es ? 'Problemas Comunes — toca para agregar' : 'Common Issues — tap to add'}
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
              placeholder={es ? 'Toca los botones arriba o escribe el problema aquí...' : 'Tap buttons above or type the issue here...'} />
          </div>

          {/* Diagnosis pills */}
          <div>
            <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.4rem', fontWeight: 600 }}>
              🔬 {es ? 'Diagnóstico / Trabajo a Realizar' : 'Diagnosis / Work to be Done'}
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
              placeholder={es ? 'Toca los botones arriba o escribe el diagnóstico aquí...' : 'Tap buttons above or type diagnosis here...'} />
          </div>
        </div>

        {/* ── Parts & Labor ─────────────────────────────────── */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.75rem', padding: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h4 style={{ fontSize: '0.875rem', fontWeight: 700, color: '#94a3b8', margin: 0 }}>
              🔩 {es ? 'Partes y Mano de Obra' : 'Parts & Labor'}
            </h4>
            <button type="button" onClick={addPart} className="btn btn-secondary btn-sm">
              + {es ? 'Agregar Parte' : 'Add Part'}
            </button>
          </div>

          {form.parts.map((part, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 60px auto', gap: '0.5rem', marginBottom: '0.5rem', padding: '0.625rem', background: 'rgba(255,255,255,0.03)', borderRadius: '0.5rem', alignItems: 'center' }}>
              {/* Col 1: inventory selector */}
              <select className="select" value={part.partId || ''} onChange={(e) => updatePart(i, 'partId', e.target.value)} style={{ fontSize: '0.82rem' }}>
                <option value="">{es ? 'Seleccionar parte / personalizado' : 'Select part or custom'}</option>
                {partsInventory.map((inv) => (
                  <option key={inv.id} value={inv.id}>{inv.name} — ${(inv.price / 100).toFixed(2)}</option>
                ))}
              </select>
              {/* Col 2: custom name — hidden when inventory item selected but keeps its column */}
              <input
                className="input"
                value={part.name || ''}
                onChange={(e) => updatePart(i, 'name', e.target.value)}
                placeholder={es ? 'Nombre parte' : 'Part name'}
                style={{ fontSize: '0.82rem', visibility: part.partId ? 'hidden' : 'visible' }}
              />
              {/* Col 3: price */}
              <input type="number" className="input" value={part.price || ''} onChange={(e) => updatePart(i, 'price', e.target.value)}
                placeholder={es ? 'Precio' : 'Price'} step="0.01" min="0" style={{ fontSize: '0.82rem' }} />
              {/* Col 4: qty */}
              <input type="number" className="input" value={part.quantity || 1} onChange={(e) => updatePart(i, 'quantity', e.target.value)}
                placeholder="Qty" min="1" style={{ fontSize: '0.82rem' }} />
              {/* Col 5: remove */}
              <button type="button" onClick={() => removePart(i)} style={{ padding: '0 0.5rem', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '0.375rem', color: '#f87171', cursor: 'pointer', height: '36px' }}>✕</button>
            </div>
          ))}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.75rem', marginTop: '0.5rem' }}>
            <div>
              <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>
                {isLocked && !pin.editUnlocked && '🔒 '}{es ? 'Mano de Obra ($)' : 'Labor Cost ($)'}
              </label>
              {/* R-EDIT-AUDIT F3.2: lock icon on laborCost when ticket is completed. */}
              <div style={{ position: 'relative' }}>
                <input
                  type="number"
                  className="input"
                  value={form.laborCost || ''}
                  onChange={(e) => upd('laborCost', parseFloat(e.target.value) || 0)}
                  placeholder="0.00"
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
                    title={es ? 'Desbloquear con PIN' : 'Unlock with PIN'}
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
              <span>{es ? 'Partes:' : 'Parts total:'}</span><span>${partsTotal.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.3rem', color: '#94a3b8' }}>
              <span>{es ? 'Labor:' : 'Labor:'}</span><span>${laborCost.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.4rem', color: '#cbd5e1', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.4rem' }}>
              <span>{es ? 'Subtotal:' : 'Subtotal:'}</span><span>${subtotal.toFixed(2)}</span>
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
                {es ? `Aplicar impuesto (${(taxRate * 100).toFixed(2)}%)` : `Apply tax (${(taxRate * 100).toFixed(2)}%)`}
              </label>
              {isLocked && !pin.editUnlocked ? (
                <span
                  onClick={pin.requestUnlock}
                  style={{ marginLeft: 'auto', cursor: 'pointer', fontSize: '0.9rem' }}
                  title={es ? 'Desbloquear con PIN' : 'Unlock with PIN'}
                >
                  🔒
                </span>
              ) : (
                <span style={{ fontSize: '0.68rem', color: '#64748b', marginLeft: 'auto' }}>
                  {es ? 'Por defecto OFF' : 'Default OFF'}
                </span>
              )}
            </div>
            {form.taxable && taxCents > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.3rem', color: '#f59e0b' }}>
                <span>{es ? `Impuesto (${(taxRate * 100).toFixed(2)}%):` : `Tax (${(taxRate * 100).toFixed(2)}%):`}</span>
                <span>+${taxAmt.toFixed(2)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1rem', fontWeight: 800, color: '#22c55e', borderTop: '1px solid rgba(16,185,129,0.3)', paddingTop: '0.5rem' }}>
              <span>TOTAL:</span><span>${total.toFixed(2)}</span>
            </div>
            <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>
                {isEdit && '🔒 '}{es ? 'Depósito ($)' : 'Deposit Amount ($)'}
              </label>
              <input type="number" className="input" value={form.deposit || ''} onChange={(e) => !isEdit && upd('deposit', parseFloat(e.target.value) || 0)}
                placeholder="0.00" step="0.01" min="0" max={total}
                disabled={isEdit}
                style={{ borderColor: depositAmt > total && total > 0 ? '#ef4444' : undefined, opacity: isEdit ? 0.6 : 1 }} />
              {/* Deposit paid display - always shown when there's a deposit */}
              {depositAmt > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem', padding: '0.5rem 0.75rem', background: 'rgba(34,197,94,0.1)', borderRadius: '0.375rem', fontSize: '0.875rem', fontWeight: 700 }}>
                  <span style={{ color: '#94a3b8' }}>{es ? 'Depósito pagado:' : 'Deposit paid:'}</span>
                  <span style={{ color: '#22c55e' }}>${depositAmt.toFixed(2)}</span>
                </div>
              )}
              {balance > 0 && depositAmt > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.4rem', padding: '0.5rem 0.75rem', background: 'rgba(251,191,36,0.1)', borderRadius: '0.375rem', fontSize: '0.875rem', fontWeight: 700 }}>
                  <span style={{ color: '#94a3b8' }}>{es ? 'Restante:' : 'Remaining:'}</span>
                  <span style={{ color: '#f59e0b' }}>${balance.toFixed(2)}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Status, Priority, Details ─────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
          <div>
            <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>Status</label>
            {/* Round R2: UI labels stay friendly; values persist as canonical snake_case. */}
            <select className="select" value={normalizeRepairStatus(form.status) || REPAIR_STATUS.RECEIVED} onChange={(e) => upd('status', e.target.value)}>
              {orderedRepairStatusOptions.map((s) => {
                const label = (() => {
                  switch (s) {
                    case REPAIR_STATUS.RECEIVED:      return es ? 'Recibido' : 'Received';
                    case REPAIR_STATUS.IN_PROGRESS:   return es ? 'En progreso' : 'In Progress';
                    case REPAIR_STATUS.WAITING_PARTS: return es ? 'Esperando partes' : 'Waiting Parts';
                    case REPAIR_STATUS.READY:         return es ? 'Listo' : 'Ready';
                    case REPAIR_STATUS.PICKED_UP:     return es ? 'Completado' : 'Complete';
                    case REPAIR_STATUS.CANCELLED:     return es ? 'Cancelado' : 'Cancelled';
                    default: return s;
                  }
                })();
                return <option key={s} value={s}>{label}</option>;
              })}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>Priority</label>
            <select className="select" value={form.priority} onChange={(e) => upd('priority', e.target.value)}>
              {['Low','Normal','High','Urgent'].map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>{es ? 'Entrega estimada' : 'Est. Completion'}</label>
            <input type="date" className="input" value={form.estimatedCompletion} onChange={(e) => upd('estimatedCompletion', e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>
              🛡️ {es ? 'Garantía (días)' : 'Warranty (days)'}
            </label>
            <input
              type="number"
              className="input"
              min={0}
              max={365}
              value={form.warranty}
              onChange={(e) => upd('warranty', parseInt(e.target.value, 10) || 0)}
              placeholder="30"
            />
          </div>
        </div>

        {/* ── Notes ────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div>
            <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>{es ? 'Notas del Cliente' : 'Customer Notes'}</label>
            <textarea className="textarea" rows={3} value={form.notes} onChange={(e) => upd('notes', e.target.value)}
              placeholder={es ? 'Notas del cliente...' : 'Customer-facing notes...'} />
          </div>
          <div>
            <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>{es ? 'Notas Internas' : 'Internal Notes'}</label>
            <textarea className="textarea" rows={3} value={form.internalNotes} onChange={(e) => upd('internalNotes', e.target.value)}
              placeholder={es ? 'Solo visible al personal...' : 'Staff-only notes...'} />
          </div>
          {/* Diagnosis outcome — conversion tracking */}
          <div>
            <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.4rem', fontWeight: 600 }}>
              📊 {es ? '¿El cliente aceptó la reparación?' : 'Did customer accept the repair?'}
            </label>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              {[
                { value: 'accepted', label: es ? '✅ Sí, aceptó' : '✅ Accepted', color: '#22c55e' },
                { value: 'pending',  label: es ? '⏳ Pensando' : '⏳ Thinking', color: '#f59e0b' },
                { value: 'declined', label: es ? '❌ No aceptó' : '❌ Declined', color: '#ef4444' },
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
                    {L.repairTrackingLink || 'Customer Tracking Link'}
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
                    toast(L.linkCopied || 'Link copied!', 'success');
                  }}
                >
                  📋 {L.copyLink || 'Copy'}
                </button>
              </div>
            )}
            <div style={{ padding: '0.75rem', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.625rem' }}>
              <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: '0.5rem', fontWeight: 600 }}>
                ⚡ {es ? 'Acciones Rápidas' : 'Quick Actions'}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {/* Round R2: canonical snake_case comparisons; setStatusAndPrint persists canonical. */}
                {normalizeRepairStatus(form.status) !== REPAIR_STATUS.RECEIVED && normalizeRepairStatus(form.status) !== REPAIR_STATUS.PICKED_UP && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setStatusAndPrint(REPAIR_STATUS.RECEIVED)}>
                    📥 {es ? 'Recibido + Imprimir' : 'Received + Print'}
                  </button>
                )}
                <button type="button"
                  className={`btn btn-sm ${normalizeRepairStatus(form.status) === REPAIR_STATUS.PICKED_UP ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setStatusAndPrint(REPAIR_STATUS.PICKED_UP)}
                  disabled={normalizeRepairStatus(form.status) === REPAIR_STATUS.PICKED_UP}
                  style={{ opacity: normalizeRepairStatus(form.status) === REPAIR_STATUS.PICKED_UP ? 0.7 : 1 }}>
                  ✅ {normalizeRepairStatus(form.status) === REPAIR_STATUS.PICKED_UP ? (es ? '✓ Completado' : '✓ Completed') : (es ? 'Completado + Imprimir' : 'Complete + Print')}
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
                  ❌ {es ? 'Cancelar + Imprimir' : 'Cancel + Print'}
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => printTicket()}>
                  🖨️ {es ? 'Imprimir' : 'Print'}
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => printWarranty()}
                  title={es ? 'Imprimir garantía de reparación' : 'Print repair warranty certificate'}
                  style={{ background: 'rgba(16,185,129,0.12)', borderColor: 'rgba(16,185,129,0.3)', color: '#34d399' }}>
                  🛡️ {es ? 'Garantía' : 'Warranty'}
                </button>
                {balance > 0 && repair && onCollectBalance && (
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => {
                    onCollectBalance(repair);
                    handleClose();
                  }}>
                    💰 ${balance.toFixed(2)} {es ? 'Cobrar' : 'Collect'}
                  </button>
                )}
              </div>
            </div>
            <div style={{ padding: '0.75rem', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.625rem' }}>
              <button type="button" className="btn btn-secondary" style={{ width: '100%' }} onClick={() => printTicket(buildPayload(), true)}>
                📝 {es ? 'Imprimir Solo Notas (Sin Precios)' : 'Print Notes Only (No Prices)'}
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
        <button type="button" onClick={handleClose} className="btn btn-secondary" style={{ flex: 1 }}>{L.cancel || 'Cancel'}</button>
        {!isEdit && (
          <button type="button" onClick={() => {
            upd('firstName', ''); upd('lastName', ''); upd('customerPhone', '');
            upd('model', ''); upd('imei', ''); upd('issue', ''); upd('diagnosis', '');
            upd('parts', []); upd('laborCost', 0); upd('deposit', 0); upd('notes', ''); upd('internalNotes', '');
          }} className="btn btn-secondary" style={{ flex: 0.7 }}>
            🗑️ {es ? 'Limpiar' : 'Clear'}
          </button>
        )}
        <button type="button" onClick={handleSubmit} className="btn btn-primary" style={{ flex: 1 }}>
          ✓ {isEdit ? (L.save || 'Save') : (es ? 'Crear Ticket' : 'Create Ticket')}
        </button>
      </div>

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
