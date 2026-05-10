// ============================================================
// CellHub Pro — Receipt Modal (4×6 thermal)
// Patches applied from GOCELLULARAPP_updated.html:
//   - Barcode (CODE128) top-right in header
//   - JsBarcode injected into print window
//   - SMS consent compressed to 2 compact lines
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { useTranslation } from '@/i18n';
import { formatDate } from '@/utils/dates';
import { usePrint } from '@/hooks/usePrint';
import { openWhatsApp } from '@/services/whatsapp';
// R-COMMS-SMS-HARD-DISABLE: sendSms + buildReceiptSmsMessage imports removed
// (post-sale SMS button retired; WhatsApp button is now the sole comm channel
// from this modal). Service files deleted in next round.
import { matchesSearch } from '@/utils/fuzzyMatch';
import { normalizePhone } from '@/utils/normalize';
import { persist } from '@/services/persist';
import { generateId } from '@/utils/dates';
import { escHtml } from '@/utils/escHtml';
import type { Sale, StoreSettings, Customer } from '@/store/types';
import { buildReceiptBarcodePayload } from '@/services/barcode/receiptPayload';

// r-batch-a (3a): JsBarcode and qrcode are now bundled via npm instead of
// loaded from cdn.jsdelivr.net at runtime. The old ensureJsBarcode() and
// ensureQrLib() helpers injected <script src="..."> tags into document.head
// on mount, which meant: (1) the app couldn't print receipts offline on
// first run without a network connection, (2) the CDN version was pinned to
// 3.11.5 while package.json already said 3.11.6, silently running the wrong
// version, (3) a reliable CDN outage would break the barcode in the preview.
//
// NOTE: this round only fixes the REACT PREVIEW path. The printed receipt
// HTML template (see the `<script src="...cdnjs...">` tag ~line 599) still
// loads jsbarcode from CDN in the print window because the print window is
// a separate document created by window.open() and has no access to the
// Vite bundle. Inlining the jsbarcode source into the template string is a
// separate, larger decision deferred to its own round.
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';

// Generate a QR SVG string from a URL via the bundled qrcode lib.
async function generateQrSvg(url: string): Promise<string> {
  try {
    return await QRCode.toString(url, { type: 'svg', margin: 1, width: 80 });
  } catch {
    return '';
  }
}

/**
 * Pre-render a barcode to an SVG string using the bundled JsBarcode.
 * Creates a temporary DOM element, renders into it, extracts outerHTML.
 * Used to inject barcode into the print window template without CDN.
 * Exported so ReportsModule and BarcodeActionModal can also use it.
 */
export function renderBarcodeSvg(value: string): string {
  if (!value) return '';
  try {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    // R-RECEIPT-BARCODE-WIDTH-FIX: width 1.0 → 0.8 so the structured
    // CHP|SALE|...|CUST|... payload (~45 chars) fits inside the 4×6
    // receipt's printable area without overflowing on screen preview
    // OR thermal print. CODE128 still scans cleanly at 0.8 × 203 DPI.
    JsBarcode(svg, value, {
      format: 'CODE128', width: 0.8, height: 26,
      displayValue: false, margin: 1,
      background: '#ffffff', lineColor: '#000000',
    });
    return svg.outerHTML;
  } catch {
    return '';
  }
}

interface ReceiptModalProps {
  open: boolean;
  sale: Sale | null;
  settings: StoreSettings;
  onClose: () => void;
  customers: Customer[];
  setCustomers: (c: Customer[]) => void;
  setSales: (s: Sale[]) => void;
  sales: Sale[];
  lang: string;
  L: Record<string, any>;
}

export default function ReceiptModal({ open, sale, settings, onClose, customers, setCustomers, setSales, sales, lang, L }: ReceiptModalProps) {
  const { t } = useTranslation();
  const { printHtml } = usePrint();
  const { toast } = useToast();
  // lang and L kept vestigial — parent compat; helper generateReceiptHtml still uses lang
  const [qrSvg, setQrSvg] = useState<string>('');
  // R-COMMS-SMS-HARD-DISABLE: removed `sending` state and `smsConfigured`
  // derived flag — both were used exclusively by the post-sale SMS button.

  // ── Retroactive customer assignment state ─────────────────
  const [assignSearch, setAssignSearch] = useState('');
  const [assignedCustomer, setAssignedCustomer] = useState<Customer | null>(null);
  const [assignDone, setAssignDone] = useState(false);

  // Refs to avoid stale closures in assign/create handlers (multi-station Firestore sync)
  const customersRef = useRef(customers);
  const salesRef = useRef(sales);
  useEffect(() => { customersRef.current = customers; }, [customers]);
  useEffect(() => { salesRef.current = sales; }, [sales]);

  // Reset assignment state when a new sale opens
  useEffect(() => {
    setAssignSearch('');
    setAssignedCustomer(null);
    setAssignDone(false);
  }, [sale?.id]);

  // Customer search results for assignment
  const assignResults = assignSearch.trim().length >= 2
    ? customers.filter((c) => matchesSearch(assignSearch, c.name, c.phone, c.customerNumber)).slice(0, 6)
    : [];

  // Is this a walk-in sale that hasn't been assigned yet?
  const isWalkIn = sale && !sale.customerId;
  const loyaltyEnabled = settings.loyaltyEnabled;

  // Compute pts for this sale (same formula as POSModule)
  const salePoints = sale
    ? Math.trunc(
        sale.items
          .filter((i) => i.category !== 'phone_payment' && i.category !== 'top_up')
          .reduce((s, i) => s + i.price * i.qty, 0) / 100
      )
    : 0;

  // Core assign logic. Accepts an optional `baseCustomers` override so that
  // handleCreateAndAssign can pass the array that already includes the newly
  // created customer — otherwise the closure-captured `customers` would not
  // contain `newCust` and the subsequent setCustomers would wipe it out.
  const handleAssignCustomer = (customer: Customer, baseCustomers?: Customer[]) => {
    if (!sale) return;

    // --- Sales update (use ref to avoid stale array from multi-station sync) ---
    const updatedSale: Sale = {
      ...sale,
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: customer.phone,
    };
    const nextSales = salesRef.current.map((s) => s.id === sale.id ? updatedSale : s);
    salesRef.current = nextSales;
    setSales(nextSales);
    persist.sale(updatedSale.id, updatedSale as unknown as Record<string, unknown>);

    // --- Customer update (single pass, optionally starting from override) ---
    // If caller provided baseCustomers (e.g. handleCreateAndAssign passing the
    // array with the freshly-created customer), use that. Otherwise use the
    // ref which reflects the latest committed state.
    const startingCustomers = baseCustomers ?? customersRef.current;
    let workingCustomer = customer;

    if (loyaltyEnabled && salePoints > 0) {
      workingCustomer = {
        ...customer,
        loyaltyPoints: (customer.loyaltyPoints || 0) + salePoints,
      };
    }

    const nextCustomers = startingCustomers.map((c) =>
      c.id === customer.id ? workingCustomer : c,
    );
    customersRef.current = nextCustomers;
    setCustomers(nextCustomers);
    persist.customer(workingCustomer.id, workingCustomer as unknown as Record<string, unknown>);

    setAssignedCustomer(workingCustomer);
    setAssignSearch('');
    setAssignDone(true);
  };

  const handleCreateAndAssign = () => {
    if (!sale || !assignSearch.trim()) return;
    const name = assignSearch.trim();
    // Try to detect if it looks like a phone number
    const looksLikePhone = /^[\d\s\-()+]{7,}$/.test(name);
    const displayName = looksLikePhone ? 'Cliente' : name;
    const parts = displayName.trim().split(/\s+/);
    const firstName = parts[0] || '';
    const lastName = parts.slice(1).join(' ');
    // FIX: customer number uses full timestamp + random suffix (not .slice(-4))
    // to avoid collisions in multi-station environments. Same pattern as PaymentModal
    // invoice numbers. 4-digit slice collided every ~10 seconds between two stations.
    const ts = Date.now().toString().slice(-8);
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    const newCust: Customer = {
      id: generateId(),
      firstName,
      lastName,
      name: displayName,
      phone: looksLikePhone ? normalizePhone(name) : '',
      email: '',
      loyaltyPoints: 0,
      storeCredit: 0,
      customerNumber: `${settings.customerNumberPrefix || 'GC'}-${ts}-${rand}`,
      notes: '',
      communicationConsent: false,
      createdAt: new Date().toISOString(),
    };
    // FIX stale closure: build the combined array ourselves and pass it to
    // handleAssignCustomer so BOTH updates see newCust. Previously, the inner
    // handleAssignCustomer called setCustomers(customers.map(...)) on the
    // closure-captured `customers` (which did not yet include newCust), and
    // that setter overwrote the create call above — newCust disappeared from
    // local state until the next Firestore sync.
    const combined = [...customersRef.current, newCust];
    customersRef.current = combined;
    persist.customer(newCust.id, newCust as unknown as Record<string, unknown>);
    handleAssignCustomer(newCust, combined);
  };

  // r-batch-a (3a): the ensureJsBarcode/ensureQrLib useEffect is gone —
  // JsBarcode and QRCode are now bundled ESM imports at the top of the file
  // so they're available synchronously. No mount-time loader needed.

  // Generate QR SVG for Google Reviews
  useEffect(() => {
    if (!settings.showReviewQr || !settings.googleReviewUrl || !sale) {
      setQrSvg('');
      return;
    }
    generateQrSvg(settings.googleReviewUrl).then(setQrSvg);
  }, [sale?.id, settings.showReviewQr, settings.googleReviewUrl]);

  // Barcode SVG — sync, same helper the print path uses.
  // R-RECEIPT-BARCODE-SALE-CUSTOMER-LINK-V1: encodes the structured
  // CHP|SALE|{invoiceNumber}[|CUST|{customerId}] payload so a scan can
  // recover both the sale reference and (when present) the customer
  // reference. The visible text under the barcode stays as the
  // human-readable invoiceNumber — only the bars change.
  const barcodePayload = useMemo(() => buildReceiptBarcodePayload(sale), [sale?.invoiceNumber, sale?.id, sale?.customerId]);
  const barcodeSvg = useMemo(() => renderBarcodeSvg(barcodePayload), [barcodePayload]);

  // ── Deps extraction: primitive fields that generateReceiptHtml reads ──
  const storeName = settings.storeName;
  const storeAddress = settings.storeAddress;
  const storePhone = settings.storePhone;
  const utilityUsersTax = settings.utilityUsersTax;
  const receiptFooter = settings.receiptFooter;
  const warrantyText = settings.warrantyText;
  const returnPolicy = settings.returnPolicy;
  const showReviewQr = settings.showReviewQr;
  const googleReviewUrl = settings.googleReviewUrl;
  const showSmsConsent = (settings as unknown as { showSmsConsent?: boolean }).showSmsConsent;

  // Single source of truth: identical HTML for preview iframe AND print output.
  // Deps are primitives so the memo only recalculates when a receipt-relevant
  // field actually changes — not on every settings reference swap.
  const previewHtml = useMemo(
    () => sale ? generateReceiptHtml(sale, settings, lang, qrSvg, barcodeSvg) : '',
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sale, lang, qrSvg, barcodeSvg,
     storeName, storeAddress, storePhone, utilityUsersTax,
     receiptFooter, warrantyText, returnPolicy,
     showReviewQr, googleReviewUrl, showSmsConsent]
  );

  // ── Inline printer picker (r-receipt-inline-picker) ──
  const [printers, setPrinters] = useState<Array<{ name: string; displayName?: string; isDefault: boolean; status: number }>>([]);
  const [selectedPrinter, setSelectedPrinter] = useState<string>('');
  const [copies, setCopies] = useState<number>(1);
  const [optionsExpanded, setOptionsExpanded] = useState<boolean>(() => {
    // First time: expanded. Subsequent: remember user's last state.
    try {
      const saved = localStorage.getItem('receiptModal.printOptionsExpanded');
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });

  // Load printers when modal opens
  useEffect(() => {
    if (!sale) return;
    if (typeof window === 'undefined' || !window.electronAPI?.getPrinters) return;
    window.electronAPI.getPrinters()
      .then((list) => {
        if (!Array.isArray(list)) return;
        setPrinters(list);
        // Default: last used printer from localStorage, else first detected
        let defaultPrinter = '';
        try {
          const lastUsed = localStorage.getItem('receiptModal.lastPrinter');
          if (lastUsed && list.some((p) => p.name === lastUsed)) {
            defaultPrinter = lastUsed;
          }
        } catch { /* ignore */ }
        if (!defaultPrinter && list.length > 0) {
          defaultPrinter = list[0].name;
        }
        setSelectedPrinter(defaultPrinter);
      })
      .catch(() => {
        // Silently fail — handlePrint will fallback gracefully
      });
  }, [sale?.id]);

  // Persist expanded/collapsed state
  const toggleOptionsExpanded = () => {
    setOptionsExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('receiptModal.printOptionsExpanded', String(next));
      } catch { /* ignore */ }
      return next;
    });
  };

  if (!sale) return null;

  const handlePrint = () => {
    // What you see IS what you print — previewHtml is the single source of truth.
    // silent: true → path 1 de usePrint (window.electronAPI.printRun),
    // bypasses PrintPreviewModal. Receipt preview already shown in this modal via iframe.
    // Si no hay printer seleccionado, usePrint cae a modal como fallback.

    // Persist selected printer for next time
    if (selectedPrinter) {
      try {
        localStorage.setItem('receiptModal.lastPrinter', selectedPrinter);
      } catch { /* ignore */ }
    }

    printHtml(previewHtml, {
      silent: false,
      printer: selectedPrinter || settings.detectedPrinters?.[0],
      copies: Math.max(1, copies),
    });
  };

  return (
    <Modal open={open} onClose={onClose} title={`🧾 ${t('receiptModal.modalTitle')} — ${sale.invoiceNumber}`} size="max-w-md">
      {/* 4×6 Preview — single source of truth via generateReceiptHtml */}
      <iframe
        srcDoc={previewHtml}
        title="Receipt preview"
        sandbox=""
        style={{
          width: '4in',
          maxWidth: '100%',
          height: '60vh',
          border: '1px solid #333',
          borderRadius: '4px',
          background: '#fff',
          display: 'block',
          margin: '0 auto',
          overflow: 'auto',
        }}
      />

      {/* ── Retroactive Customer Assignment ─────────────── */}
      {isWalkIn && loyaltyEnabled && salePoints > 0 && (
        <div style={{
          marginTop: '0.875rem',
          padding: '0.875rem',
          background: assignDone ? 'rgba(34,197,94,0.08)' : 'rgba(251,191,36,0.08)',
          border: `1px solid ${assignDone ? 'rgba(34,197,94,0.3)' : 'rgba(251,191,36,0.3)'}`,
          borderRadius: '0.75rem',
        }}>
          {assignDone && assignedCustomer ? (
            // Success state
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
              <span style={{ fontSize: '1.25rem' }}>✅</span>
              <div>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#22c55e' }}>
                  {t('receiptModal.pointsAssignedTo')} {assignedCustomer.name}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  +{salePoints} pts · {t('total')}: {(assignedCustomer.loyaltyPoints || 0) + salePoints} pts
                </div>
              </div>
            </div>
          ) : (
            // Assignment prompt
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.625rem' }}>
                <span style={{ fontSize: '1rem' }}>🎁</span>
                <div style={{ fontSize: '0.82rem', color: '#fbbf24', fontWeight: 600 }}>
                  {t('receiptModal.assignSalePrompt', salePoints)}
                </div>
              </div>

              <div style={{ position: 'relative' }}>
                <input
                  className="input"
                  style={{ fontSize: '0.85rem' }}
                  placeholder={t('receiptModal.searchCustomerPlaceholder')}
                  value={assignSearch}
                  onChange={(e) => setAssignSearch(e.target.value)}
                  autoComplete="off"
                />

                {/* Dropdown results */}
                {assignResults.length > 0 && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                    background: 'var(--bg-secondary)', border: '1px solid var(--border-strong)',
                    borderRadius: '0.5rem', marginTop: '0.25rem', overflow: 'hidden',
                  }}>
                    {assignResults.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => handleAssignCustomer(c)}
                        style={{
                          width: '100%', textAlign: 'left', padding: '0.5rem 0.875rem',
                          background: 'transparent', border: 'none', cursor: 'pointer',
                          color: 'var(--text-primary)', fontSize: '0.82rem',
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          borderBottom: '1px solid var(--border-default)',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(102,126,234,0.15)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      >
                        <span style={{ fontWeight: 600 }}>{c.name}</span>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                          {c.phone} · {c.loyaltyPoints || 0} pts
                        </span>
                      </button>
                    ))}
                    {/* Create new customer option */}
                    <button
                      onClick={handleCreateAndAssign}
                      style={{
                        width: '100%', textAlign: 'left', padding: '0.5rem 0.875rem',
                        background: 'rgba(102,126,234,0.1)', border: 'none', cursor: 'pointer',
                        color: '#a5b4fc', fontSize: '0.82rem', fontWeight: 600,
                      }}
                    >
                      + {t('receiptModal.createAndAssign', assignSearch)}
                    </button>
                  </div>
                )}

                {/* Show create button when no results but has input */}
                {assignSearch.trim().length >= 2 && assignResults.length === 0 && (
                  <button
                    onClick={handleCreateAndAssign}
                    style={{
                      marginTop: '0.375rem', width: '100%', padding: '0.5rem 0.875rem',
                      background: 'rgba(102,126,234,0.1)', border: '1px solid rgba(102,126,234,0.3)',
                      borderRadius: '0.5rem', cursor: 'pointer', color: '#a5b4fc',
                      fontSize: '0.82rem', fontWeight: 600, textAlign: 'left',
                    }}
                  >
                    + {t('receiptModal.createCustomerAndAssign', assignSearch)}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Print options (collapsible) ── */}
      <div style={{
        borderTop: '1px solid var(--border-default)',
        paddingTop: 12,
        marginTop: 12,
      }}>
        <button
          type="button"
          onClick={toggleOptionsExpanded}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-primary)',
            fontSize: '0.85rem',
            fontWeight: 600,
            cursor: 'pointer',
            padding: '4px 0',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            width: '100%',
            textAlign: 'left',
          }}
        >
          <span style={{ display: 'inline-block', width: 12, transition: 'transform 0.2s', transform: optionsExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>▸</span>
          {t('receiptModal.printOptions')}
        </button>
        {optionsExpanded && (
          <div style={{
            marginTop: 8,
            padding: 12,
            background: 'var(--bg-input)',
            border: '1px solid var(--border-default)',
            borderRadius: 6,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}>
            {/* Printer dropdown */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                {t('receiptModal.printer')}
              </label>
              <select
                value={selectedPrinter}
                onChange={(e) => setSelectedPrinter(e.target.value)}
                style={{
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 4,
                  padding: '6px 8px',
                  fontSize: '0.85rem',
                }}
              >
                {printers.length === 0 ? (
                  <option value="">{t('receiptModal.noPrinters')}</option>
                ) : (
                  printers.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.displayName || p.name}{p.isDefault ? ` ${t('receiptModal.systemDefault')}` : ''}
                    </option>
                  ))
                )}
              </select>
            </div>
            {/* Copies input */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                {t('receiptModal.copies')}
              </label>
              <input
                type="number"
                min={1}
                max={99}
                value={copies}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  setCopies(isNaN(n) || n < 1 ? 1 : Math.min(99, n));
                }}
                style={{
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 4,
                  padding: '6px 8px',
                  fontSize: '0.85rem',
                  width: 80,
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-3 mt-4">
        <button onClick={onClose} className="btn btn-secondary flex-1">{t('close')}</button>
        {settings.waEnabled !== false && (
          <button
            onClick={() => {
              // R-RECEIPT-WHATSAPP-SEND-V1: manual receipt send via wa.me.
              // No WhatsApp API; no auto-send; no PDF/image attachment. The
              // owner clicks → wa.me opens with prefilled receipt text →
              // owner manually presses Send. Phone-missing path shows a
              // localized toast instead of silently no-oping.
              const phone = sale?.customerPhone || assignedCustomer?.phone || '';
              if (!phone.trim()) {
                toast(t('receiptWa.missingPhone'), 'warning');
                return;
              }
              const fmtCents = (c: number) => `$${(c / 100).toFixed(2)}`;
              const msg = t(
                'receiptWa.message',
                settings.storeName || 'Go Cellular',
                sale.invoiceNumber,
                formatDate(sale.createdAt),
                fmtCents(sale.total),
                sale.paymentMethod || '',
              );
              openWhatsApp(phone, msg);
            }}
            className="btn flex-1"
            style={{ background: '#25D366', color: '#fff', fontWeight: 700, border: 'none' }}
          >
            📲 {t('receiptWa.buttonLabel')}
          </button>
        )}
        {/* R-COMMS-SMS-HARD-DISABLE: post-sale SMS button removed.
            WhatsApp button above is now the sole comm channel here. */}
        <button onClick={handlePrint} className="btn btn-primary flex-1">
          🖨️ {t('receiptModal.printReceipt')}
        </button>
      </div>
    </Modal>
  );
}

/** Generate standalone 4×6 receipt HTML with barcode.
 *  Optional `qrSvg` is an inline SVG string from the qrcode lib; when provided
 *  it is used instead of the external api.qrserver.com URL (which would fail
 *  offline). Fall back to the external URL if qrSvg is empty. */
export function generateReceiptHtml(sale: Sale, settings: StoreSettings, lang: string, qrSvg?: string, barcodeSvg?: string): string {
  const es = lang === 'es';
  const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  // R-RECEIPT-DISCOUNT-LINE: derive discount locally without touching Sale.
  // Sale.subtotal is pre-discount; subtotalAfterDiscount is the post value
  // (optional). When no discount applied, subtotalAfterDiscount is undefined
  // and the difference is 0 → row hidden.
  const discountAmount = sale.subtotal - (sale.subtotalAfterDiscount ?? sale.subtotal);

  // R-RECEIPT-LINE-DISCOUNT-DISPLAY-FIX: distribute the sale-wide discount
  // proportionally across discountable line items so each printed line
  // reflects the EFFECTIVE amount the customer paid before tax. Pure
  // presentation — no totals/tax/cart math touched. Phone payments and
  // top-ups are excluded from discount (matches calculateCartTotals).
  // Rounding residue is absorbed by the last discountable item so the
  // sum of effective lines exactly equals subtotalAfterDiscount.
  const perItemDiscount: Record<string, number> = {};
  if (discountAmount > 0) {
    let discountableTotal = 0;
    const discountableIds: string[] = [];
    for (const item of sale.items) {
      if (item.category === 'phone_payment' || item.category === 'top_up') continue;
      discountableTotal += item.price * item.qty;
      discountableIds.push(item.id);
    }
    if (discountableTotal > 0 && discountableIds.length > 0) {
      let allocated = 0;
      for (const item of sale.items) {
        if (!discountableIds.includes(item.id)) continue;
        const share = Math.round((item.price * item.qty / discountableTotal) * discountAmount);
        perItemDiscount[item.id] = share;
        allocated += share;
      }
      const residue = discountAmount - allocated;
      if (residue !== 0) {
        const lastId = discountableIds[discountableIds.length - 1];
        perItemDiscount[lastId] = (perItemDiscount[lastId] || 0) + residue;
      }
    }
  }

  // R-RECEIPT-HYBRID-DISCOUNT-DISPLAY-V1 + R-CART-LINE-DISCOUNT-PRICE-OVERRIDE-V1:
  // the right column anchors on the ORIGINAL line amount (item.originalPrice * qty
  // when set, else item.price * qty). The annotation combines BOTH per-line
  // discount (originalPrice - effective price) AND the cart-distributed share
  // from perItemDiscount — single "Discount Applied: -$X" line so the customer
  // sees one consolidated savings number, not a double-counted set.
  const itemRows = sale.items.map((item) => {
    const orig = (item.originalPrice ?? item.price) * item.qty;     // anchor
    const lineTotal = item.price * item.qty;                        // post-line-discount
    const lineSavings = Math.max(0, orig - lineTotal);              // per-line discount baked into item.price
    const cartShare = perItemDiscount[item.id] || 0;                // global cart-discount allocation
    const totalDiscount = lineSavings + cartShare;
    const discountAnnotation = totalDiscount > 0
      ? `<br><span style="font-size:9px;font-style:italic;color:#c00;font-weight:500">${es ? 'Descuento aplicado' : 'Discount Applied'}: -${fmt(totalDiscount)}</span>`
      : '';
    // R-RECEIPT-ID-V1: surface the most-specific identifier per line
    // with priority IMEI > SKU. Replaces the prior IMEI-only line so
    // accessories/parts (SKU but no IMEI) also show their identifier.
    // Single "ID:" label keeps it generic — the cashier/customer can
    // tell from context which kind it is. SaleItem doesn't carry a
    // separate barcode field (per types.ts:645), so the chain stops at
    // sku; if neither is present nothing is rendered.
    const itemIdValue = item.imei || item.sku || '';
    const idLine = itemIdValue
      ? `<br><small style="color:#555;font-family:'Courier New',monospace;font-weight:700;font-size:10px;letter-spacing:0.04em">ID: ${escHtml(itemIdValue)}</small>`
      : '';
    return `
    <tr>
      <td style="padding:2px 0;font-size:11px">${escHtml(item.name)}${item.qty > 1 ? ` ×${item.qty}` : ''}${item.notes ? `<br><small style="color:#888">${escHtml(item.notes)}</small>` : ''}${idLine}</td>
      <td style="text-align:right;padding:2px 0;font-size:11px;font-weight:600;vertical-align:top">${fmt(orig)}${discountAnnotation}</td>
    </tr>`;
  }).join('');

  // R-COMMS-SMS-HARD-DISABLE: TCPA disclaimer block removed from receipt
  // template. With SMS sending disabled, the printed opt-in checkboxes
  // had no backing send path. Restored if SMS comms return in a future round.

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>Receipt</title>
<style>
  @page { size: 4in 6in; margin: 0; }
  html, body { width: 4in; height: 6in; margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #000; background: #fff; }
  body { padding: 0.1in 0.15in; box-sizing: border-box; }
  table { width: 100%; border-collapse: collapse; }
  .sep { border-top: 1px dashed #999; margin: 5px 0; }
  @media print { html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head><body>
  <!-- Header: store left, barcode right.
       R-RECEIPT-BARCODE-PAGEWIDTH-FIX: every flex item has min-width:0
       so an oversized child (long store name, dense barcode) cannot
       force the parent past the 4 in page. Right column flex:0 1 1.9in
       lets it shrink instead of pushing layout. overflow:hidden +
       box-sizing:border-box clamp every level against the page. -->
  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;width:100%;box-sizing:border-box;margin-bottom:6px;border-bottom:2px solid #000;padding-bottom:5px;overflow:hidden">
    <div style="flex:1 1 auto;min-width:0;overflow:hidden">
      <div style="font-size:18px;font-weight:900;line-height:1;letter-spacing:0.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(settings.storeName || 'GO CELLULAR')}</div>
      <div style="font-size:10px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(settings.storeAddress || '')}</div>
      <div style="font-size:10px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(settings.storePhone || '')}</div>
    </div>
    <div style="text-align:right;flex:0 1 1.9in;min-width:0;max-width:1.9in;overflow:hidden;display:block;box-sizing:border-box">
      ${barcodeSvg ? barcodeSvg.replace('<svg', '<svg style="width:100%;max-width:100%;height:auto;display:block"') : '<svg style="display:block"></svg>'}
      <div style="font-size:11px;font-family:'Courier New',monospace;font-weight:800;letter-spacing:0.06em;text-align:center;margin-top:3px;color:#000;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(sale.invoiceNumber)}</div>
    </div>
  </div>

  <!-- Invoice info -->
  <table style="margin-bottom:5px">
    <tr>
      <td style="font-size:11px">${formatDate(sale.createdAt)}</td>
      <td style="text-align:right;font-size:12px;font-weight:900">${escHtml(sale.invoiceNumber)}</td>
    </tr>
    ${sale.customerName ? `<tr><td colspan="2" style="font-size:11px">${es ? 'Cliente' : 'Customer'}: <strong>${escHtml(sale.customerName)}</strong>${sale.customerPhone ? ` · ${escHtml(sale.customerPhone)}` : ''}</td></tr>` : ''}
    ${sale.employeeName ? `<tr><td colspan="2" style="font-size:10px">${es ? 'Cajero' : 'Cashier'}: ${escHtml(sale.employeeName)}</td></tr>` : ''}
  </table>
  <div class="sep"></div>

  <!-- Items -->
  <table style="margin-bottom:5px">${itemRows}</table>
  <div class="sep"></div>

  <!-- Totals -->
  <table style="margin-bottom:5px">
    <!-- R-RECEIPT-LINE-DISCOUNT-DISPLAY-FIX: Subtotal now shows the post-
         discount value because each item line above already reflects its
         effective per-item price. Standalone Discount row removed to avoid
         the double-subtraction look ($279 line + $4 discount = $275 paid).
         When a discount is present, render an italic "Saved" annotation
         under the subtotal so the customer still sees the savings call-out. -->
    <tr><td>Subtotal:</td><td style="text-align:right">${fmt(sale.subtotalAfterDiscount ?? sale.subtotal)}</td></tr>
    ${(() => {
      // R-CART-LINE-DISCOUNT-PRICE-OVERRIDE-V1: total savings = cart-level
      // discount + sum of per-line discounts (originalPrice - effective price).
      // Keeps the "Saved" callout aligned with the per-item annotations above.
      let lineSavingsTotal = 0;
      for (const it of sale.items) {
        const o = (it.originalPrice ?? it.price) * it.qty;
        const p = it.price * it.qty;
        if (o > p) lineSavingsTotal += (o - p);
      }
      const totalSaved = discountAmount + lineSavingsTotal;
      return totalSaved > 0
        ? `<tr><td colspan="2" style="font-size:9px;font-style:italic;color:#16a34a;padding-top:1px">${es ? 'Ahorro' : 'Saved'}: ${fmt(totalSaved)}</td></tr>`
        : '';
    })()}
    ${(sale.salesTax !== undefined || sale.utilityTax !== undefined || sale.mobileSurcharge !== undefined) ? `
      ${(sale.salesTax || 0) > 0 ? `<tr><td>${es ? 'Impuesto de Venta' : 'Sales Tax'}:</td><td style="text-align:right">${fmt(sale.salesTax!)}</td></tr>` : ''}
      ${(sale.utilityTax || 0) > 0 ? `<tr><td>${es ? 'Impuesto de Servicios' : 'Utility Users Tax'} (${((settings.utilityUsersTax || 0.055) * 100).toFixed(2)}%):</td><td style="text-align:right">${fmt(sale.utilityTax!)}</td></tr>` : ''}
      ${(sale.mobileSurcharge || 0) > 0 ? `<tr><td>${es ? 'Cargo de Movilidad CDTFA' : 'CDTFA Mobility Fee'}:</td><td style="text-align:right">${fmt(sale.mobileSurcharge!)}</td></tr>` : ''}
    ` : `${(sale.taxAmount || 0) > 0 ? `<tr><td>${es ? 'Impuesto' : 'Tax'}:</td><td style="text-align:right">${fmt(sale.taxAmount)}</td></tr>` : ''}`}
    ${(sale.cbeTotal || 0) > 0 ? `<tr><td>${es ? 'Cuota CBE:' : 'CBE Fee:'}</td><td style="text-align:right">${fmt(sale.cbeTotal!)}</td></tr>` : ''}
    ${(sale.screenFeeTotal || 0) > 0 ? `<tr><td>${es ? 'Cuota Pantalla:' : 'Screen Fee:'}</td><td style="text-align:right">${fmt(sale.screenFeeTotal!)}</td></tr>` : ''}
    <tr style="border-top:1px solid #000">
      <td style="font-size:14px;font-weight:900;padding-top:4px">TOTAL:</td>
      <td style="text-align:right;font-size:16px;font-weight:900;padding-top:4px">${fmt(sale.total)}</td>
    </tr>
    <tr><td style="font-size:12px;font-weight:600">${es ? 'Pago' : 'Payment'}:</td><td style="text-align:right;font-size:12px;font-weight:900">${escHtml(sale.paymentMethod)}</td></tr>
    ${sale.cashReceived ? `
      <tr><td>${es ? 'Efectivo' : 'Cash'}:</td><td style="text-align:right">${fmt(sale.cashReceived)}</td></tr>
      <tr><td style="font-weight:900">${es ? 'Cambio' : 'Change'}:</td><td style="text-align:right;font-weight:900">${fmt(sale.changeDue || 0)}</td></tr>
    ` : ''}
  </table>
  <div class="sep"></div>

  <!-- Footer -->
  <div style="text-align:center;font-size:11px;font-weight:600;line-height:1.3">
    ${settings.receiptFooter ? escHtml(settings.receiptFooter) : (es ? '¡Gracias por su compra!' : 'Thank you for your purchase!')}
    ${settings.warrantyText ? `<div style="font-size:9px;font-weight:400;margin-top:3px">${escHtml(settings.warrantyText)}</div>` : ''}
    ${settings.returnPolicy ? `<div style="font-size:9px;font-weight:400;margin-top:3px">${escHtml(settings.returnPolicy)}</div>` : ''}
    ${settings.showReviewQr && settings.googleReviewUrl ? `
    <div style="text-align:center;margin-top:8px;padding-top:6px;border-top:1px dashed #ccc">
      <div style="font-size:10px;font-weight:700;margin-bottom:4px">${es ? '¡Déjanos tu reseña!' : 'Leave us a review!'}</div>
      ${qrSvg
        ? `<div style="width:72px;height:72px;margin:0 auto">${qrSvg}</div>`
        : `<img src="https://api.qrserver.com/v1/create-qr-code/?size=72x72&data=${encodeURIComponent(settings.googleReviewUrl)}" width="72" height="72" style="display:block;margin:0 auto" />`}
      <div style="font-size:8px;color:#555;margin-top:3px">&#9733;&#9733;&#9733;&#9733;&#9733; Google</div>
    </div>` : ''}
  </div>

</body></html>`;
}
