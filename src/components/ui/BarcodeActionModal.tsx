// ============================================================
// CellHub Pro — Barcode Action Modal
//
// Shown when a receipt barcode is scanned anywhere in the app.
// Finds the sale by invoice number and presents action buttons:
//   🔍 Ver Detalles / View in Reports
//   ↩️ Procesar Devolución / Process Return
//   💰 Cobrar Saldo / Collect Balance  (only if balance > 0)
//   🖨️ Reimprimir / Reprint
//
// Triggered by useBarcodeScanner → SET_PENDING_BARCODE_INVOICE.
// ============================================================

import { useMemo } from 'react';
import { Modal } from '@/components/ui';
import { useApp } from '@/store/AppProvider';
import { formatCurrency } from '@/utils/currency';
import { usePrint } from '@/hooks/usePrint';
import { generateReceiptHtml, renderBarcodeSvg } from '@/modules/pos/ReceiptModal';
import { useTranslation } from '@/i18n';
import { openWhatsApp, buildWaMessage } from '@/services/whatsapp';
import { buildReceiptBarcodePayload, CH_CUST_PREFIX } from '@/services/barcode/receiptPayload';
import { normalizePhone } from '@/utils/normalize';

export default function BarcodeActionModal() {
  const { state, dispatch } = useApp();
  const {
    pendingBarcodeInvoice,
    sales,
    settings,
    cart,
    customers,
  } = state;

  const { printHtml } = usePrint();
  const { t, locale } = useTranslation();

  // R-PHONE-PAYMENT-RECEIPT-BARCODE-SCAN-V1: CH:CUST: barcodes from
  // phone-payment receipts open customer-history mode directly.
  const isChCustScan = !!pendingBarcodeInvoice && pendingBarcodeInvoice.startsWith(CH_CUST_PREFIX);
  const chCustomerId = isChCustScan ? pendingBarcodeInvoice.slice(CH_CUST_PREFIX.length) : undefined;
  const chCustomer = useMemo(() => {
    if (!chCustomerId) return null;
    return (customers || []).find((c) => c.id === chCustomerId) || null;
  }, [chCustomerId, customers]);

  // Find the sale matching the scanned invoice number (standard mode only)
  const sale = useMemo(() => {
    if (!pendingBarcodeInvoice || isChCustScan) return null;
    return (sales || []).find(
      (s) => s.invoiceNumber?.toLowerCase() === pendingBarcodeInvoice.toLowerCase()
    ) || null;
  }, [pendingBarcodeInvoice, isChCustScan, sales]);

  const isOpen = !!pendingBarcodeInvoice;

  const close = () => dispatch({ type: 'SET_PENDING_BARCODE_INVOICE', payload: '' });

  const navigate = (tab: string) => {
    dispatch({ type: 'SET_ACTIVE_TAB', payload: tab });
    close();
  };

  // R-BARCODE-MENU-CUSTOMER-HISTORY-AND-PHONE-PAYMENT-FIX: resolve the
  // customer linked to a scanned sale. Prefer the stored customerId; fall
  // back to a phone-tail match against the customer DB. Returns null when
  // the sale has no customer info at all — callers show a safe fallback.
  const resolveSaleCustomer = (s: typeof sale) => {
    if (!s) return null;
    const cid = (s as any).customerId as string | undefined;
    if (cid) {
      const byId = (customers || []).find((c) => c.id === cid);
      if (byId) return byId;
    }
    const phone = (s.customerPhone || '').trim();
    if (phone) {
      const phoneTail = normalizePhone(phone).slice(-10);
      if (phoneTail.length === 10) {
        const byPhone = (customers || []).find((c) => {
          const candidates = [c.phone, ...((c as { phones?: string[] }).phones || [])];
          return candidates.some((p) => normalizePhone(p || '').slice(-10) === phoneTail);
        });
        if (byPhone) return byPhone;
      }
    }
    return null;
  };

  // R-BARCODE-CUSTOMER-HISTORY-FIRST-CLICK-RACE-FIX-V1: switch from a
  // blind 80 ms CustomEvent dispatch (lost when CustomerModule has not
  // mounted yet on first click) to the canonical store-based pending
  // pattern, mirroring pendingPhonePaymentCustomerId. CustomerModule reads
  // pendingCustomerHistoryId on mount and opens the history modal, then
  // clears the pending id. Race-free regardless of current tab.
  const openCustomerHistory = (customerId: string) => {
    dispatch({ type: 'SET_PENDING_CUSTOMER_HISTORY', payload: customerId });
    dispatch({ type: 'SET_ACTIVE_TAB', payload: 'customers' });
    close();
  };

  // R-BARCODE-MENU-CUSTOMER-HISTORY-AND-PHONE-PAYMENT-FIX: prefill Phone
  // Payments with the scanned customer. Reuses the existing
  // SET_PENDING_PHONE_PAYMENT_CUSTOMER → POSModule auto-open pipeline
  // (AppShell.tsx:118 + POSModule.tsx:177). Modal autofills name / phone /
  // carrier / typical amount from the customer record. No auto-charge.
  const openPhonePaymentForCustomer = (customerId: string) => {
    dispatch({ type: 'SET_PENDING_PHONE_PAYMENT_CUSTOMER', payload: customerId });
    dispatch({ type: 'SET_ACTIVE_TAB', payload: 'pos' });
    close();
  };

  // ── Actions ───────────────────────────────────────────────

  const goToReports = () => {
    dispatch({ type: 'SET_GLOBAL_SEARCH', payload: pendingBarcodeInvoice });
    if (sale?.createdAt) {
      const d = new Date(sale.createdAt as string);
      if (!isNaN(d.getTime())) {
        const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        dispatch({ type: 'SET_PENDING_REPORT_DATE', payload: ymd });
      }
    }
    navigate('reports');
  };

  const goToReturns = () => {
    // Navigate to Returns — ReturnsModule watches pendingBarcodeInvoice
    // We close this modal first (clears pendingBarcodeInvoice),
    // then re-set it for ReturnsModule to pick up
    const inv = pendingBarcodeInvoice;
    dispatch({ type: 'SET_PENDING_BARCODE_INVOICE', payload: '' });
    dispatch({ type: 'SET_ACTIVE_TAB', payload: 'returns' });
    setTimeout(() => {
      dispatch({ type: 'SET_PENDING_BARCODE_INVOICE', payload: inv });
    }, 80);
  };

  const collectBalance = () => {
    if (!sale) return;
    const balance = (sale as any).balance || 0;
    if (balance <= 0) return;
    const balanceItem = {
      id: Math.random().toString(36).slice(2),
      name: `${t('barcode.balance')} — ${sale.invoiceNumber}`,
      category: 'service' as const,
      price: balance,
      qty: 1,
      taxable: false,
      cbeEligible: false,
      notes: sale.customerName || '',
    };
    dispatch({ type: 'SET_CART', payload: [...(cart || []), balanceItem] });
    navigate('pos');
  };

  const reprint = () => {
    if (!sale) return;
    // R-RECEIPT-BARCODE-SALE-CUSTOMER-LINK-V1: reprint encodes the
    // structured payload so the new copy is scan-equivalent to a fresh
    // print. Old reprints encoded only invoiceNumber.
    const bsvg = renderBarcodeSvg(buildReceiptBarcodePayload(sale));
    const html = generateReceiptHtml(sale, settings, locale, undefined, bsvg);
    // LAN-PRINT-BRIDGE-PRINTPREVIEW-BRIDGED-RECEIPT-FIX-V1: a scan→reprint is a
    // POS receipt — on a read-only LAN Secondary it must forward to the Primary
    // (which owns the printer), exactly like a fresh checkout receipt. Without
    // these flags the Secondary skipped the bridge early-return, opened
    // PrintPreviewModal, and greyed out Print (canBridge=false). On the
    // Primary/standalone the flags are ignored → unchanged local print.
    printHtml(html, {
      silent: false,
      printer: settings.detectedPrinters?.[0],
      bridgeReceipt: true,
      receiptType: 'pos_receipt',
    });
    close();
  };

  if (!isOpen) return null;

  const hasBalance = sale && (sale as any).balance > 0;

  return (
    <Modal
      open={isOpen}
      onClose={close}
      title={`📱 ${t('barcode.title')}`}
      size="max-w-sm"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>

        {/* CH:CUST: mode — customer-history scan */}
        {isChCustScan && (
          <>
            <div style={{
              textAlign: 'center',
              padding: '0.875rem',
              background: 'rgba(139,92,246,0.08)',
              border: '1px solid rgba(139,92,246,0.25)',
              borderRadius: '0.75rem',
            }}>
              <div style={{ fontSize: '0.72rem', color: '#64748b', marginBottom: '0.35rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                {t('barcode.customerScan')}
              </div>
              {chCustomer ? (
                <>
                  <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#c4b5fd' }}>{chCustomer.name}</div>
                  {chCustomer.phone && <div style={{ fontSize: '0.82rem', color: '#94a3b8', marginTop: '0.2rem' }}>{chCustomer.phone}</div>}
                </>
              ) : (
                <div style={{ fontSize: '0.82rem', color: '#ef4444', marginTop: '0.25rem' }}>
                  ⚠️ {locale === 'es' ? 'Cliente no encontrado' : 'Customer not found'}
                </div>
              )}
            </div>

            {chCustomer && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <button
                  onClick={() => {
                    // R-BARCODE-VIEW-CUSTOMER-EXACT-FIX-V1: dispatch the same
                    // event Intelligence uses (caught by AppShell coordinator
                    // which navigates + fires _intel-open-customer after the
                    // module mounts) so the exact customer profile opens —
                    // not a name-search that could match the wrong record.
                    // CUSTOMER-360-INTELLIGENCE-OPEN-HISTORY-V1: mode:'edit'
                    // keeps this button on the edit form — the sibling
                    // "Customer History" button below already covers history.
                    window.dispatchEvent(new CustomEvent('cellhub:open-customer', { detail: { customerId: chCustomer.id, mode: 'edit' } }));
                    close();
                  }}
                  style={actionStyle('#8B5CF6')}
                >
                  <span style={{ fontSize: '1.25rem' }}>👤</span>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{t('barcode.viewCustomer')}</div>
                    <div style={{ fontSize: '0.72rem', opacity: 0.7 }}>{chCustomer.name}</div>
                  </div>
                </button>
                <button
                  onClick={() => openCustomerHistory(chCustomer.id)}
                  style={actionStyle('#0EA5E9')}
                >
                  <span style={{ fontSize: '1.25rem' }}>📋</span>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{t('barcode.custHistory')}</div>
                    <div style={{ fontSize: '0.72rem', opacity: 0.7 }}>{t('barcode.allTx')}</div>
                  </div>
                </button>
                <button
                  onClick={() => openPhonePaymentForCustomer(chCustomer.id)}
                  style={actionStyle('#F97316')}
                >
                  <span style={{ fontSize: '1.25rem' }}>📞</span>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{t('barcode.makePhonePayment')}</div>
                    <div style={{ fontSize: '0.72rem', opacity: 0.7 }}>{t('barcode.makePhonePaymentSub')}</div>
                  </div>
                </button>
                <button
                  onClick={() => {
                    dispatch({ type: 'SET_PENDING_POS_CUSTOMER', payload: chCustomer.id });
                    navigate('pos');
                  }}
                  style={actionStyle('#22C55E')}
                >
                  <span style={{ fontSize: '1.25rem' }}>🛒</span>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{t('barcode.startSale')}</div>
                    <div style={{ fontSize: '0.72rem', opacity: 0.7 }}>{t('barcode.startSaleSub')}</div>
                  </div>
                </button>
                <button
                  onClick={() => {
                    dispatch({ type: 'SET_GLOBAL_SEARCH', payload: chCustomer.name || chCustomer.phone || '' });
                    navigate('repairs');
                  }}
                  style={actionStyle('#6366F1')}
                >
                  <span style={{ fontSize: '1.25rem' }}>🔧</span>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{t('barcode.checkRepairs')}</div>
                    <div style={{ fontSize: '0.72rem', opacity: 0.7 }}>{t('barcode.checkRepairsSub')}</div>
                  </div>
                </button>
                <button
                  onClick={() => {
                    dispatch({ type: 'SET_GLOBAL_SEARCH', payload: chCustomer.name || chCustomer.phone || '' });
                    navigate('layaways');
                  }}
                  style={actionStyle('#EC4899')}
                >
                  <span style={{ fontSize: '1.25rem' }}>📦</span>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{t('barcode.checkLayaways')}</div>
                    <div style={{ fontSize: '0.72rem', opacity: 0.7 }}>{t('barcode.checkLayawaysSub')}</div>
                  </div>
                </button>
                {chCustomer.phone && settings.waEnabled !== false && (
                  <button
                    onClick={() => {
                      const msg = buildWaMessage('thankYou', {
                        customerName: chCustomer.name || 'Customer',
                        storeName: settings.storeName || 'Go Cellular',
                        storePhone: settings.storePhone || '',
                      }, locale === 'es' ? 'es' : locale === 'pt' ? 'pt' : 'en', (settings as any).waTemplateThankYou || '');
                      openWhatsApp(chCustomer.phone!, msg);
                    }}
                    style={actionStyle('#25D366')}
                  >
                    <span style={{ fontSize: '1.25rem' }}>📲</span>
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>WhatsApp</div>
                      <div style={{ fontSize: '0.72rem', opacity: 0.7 }}>{t('barcode.waMessage')}</div>
                    </div>
                  </button>
                )}
              </div>
            )}

            <button onClick={close} className="btn btn-secondary" style={{ marginTop: '0.25rem' }}>
              {t('barcode.cancel')}
            </button>
          </>
        )}

        {/* Standard invoice-mode content */}
        {!isChCustScan && <>

        {/* Invoice badge */}
        <div style={{
          textAlign: 'center',
          padding: '0.875rem',
          background: 'rgba(102,126,234,0.08)',
          border: '1px solid rgba(102,126,234,0.25)',
          borderRadius: '0.75rem',
        }}>
          <div style={{ fontSize: '0.72rem', color: '#64748b', marginBottom: '0.35rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            {t('barcode.invoiceDetected')}
          </div>
          <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#a5b4fc', fontFamily: 'monospace', letterSpacing: '0.05em' }}>
            {pendingBarcodeInvoice}
          </div>

          {/* Sale summary if found */}
          {sale ? (
            <div style={{ marginTop: '0.625rem', fontSize: '0.8rem', color: '#94a3b8', lineHeight: 1.5 }}>
              {sale.customerName && <div style={{ fontWeight: 600, color: '#e2e8f0' }}>{sale.customerName}</div>}
              <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginTop: '0.25rem' }}>
                <span>{t('total')} <strong style={{ color: '#22c55e' }}>{formatCurrency(sale.total)}</strong></span>
                <span>{sale.paymentMethod}</span>
              </div>
              {hasBalance && (
                <div style={{
                  marginTop: '0.4rem', padding: '0.25rem 0.75rem',
                  background: 'rgba(251,191,36,0.12)', borderRadius: '999px',
                  color: '#f59e0b', fontWeight: 700, fontSize: '0.78rem',
                  display: 'inline-block',
                }}>
                  ⚠️ {t('barcode.balanceDue')}: {formatCurrency((sale as any).balance)}
                </div>
              )}
            </div>
          ) : (
            <div style={{ marginTop: '0.5rem', fontSize: '0.78rem', color: '#ef4444' }}>
              ⚠️ {t('barcode.notFound')}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>

          <button
            onClick={goToReports}
            style={actionStyle('#378ADD')}
          >
            <span style={{ fontSize: '1.25rem' }}>🔍</span>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{t('barcode.viewDetails')}</div>
              <div style={{ fontSize: '0.72rem', opacity: 0.7 }}>{t('barcode.openInReports')}</div>
            </div>
          </button>

          <button
            onClick={goToReturns}
            style={actionStyle('#E24B4A')}
          >
            <span style={{ fontSize: '1.25rem' }}>↩️</span>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{t('barcode.processReturn')}</div>
              <div style={{ fontSize: '0.72rem', opacity: 0.7 }}>{t('barcode.goToReturns')}</div>
            </div>
          </button>

          {hasBalance && (
            <button
              onClick={collectBalance}
              style={actionStyle('#BA7517')}
            >
              <span style={{ fontSize: '1.25rem' }}>💰</span>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>
                  {t('barcode.collectBalance')} — {formatCurrency((sale as any).balance)}
                </div>
                <div style={{ fontSize: '0.72rem', opacity: 0.7 }}>{t('barcode.addToCart')}</div>
              </div>
            </button>
          )}

          {sale && (
            <button
              onClick={reprint}
              style={actionStyle('#1D9E75')}
            >
              <span style={{ fontSize: '1.25rem' }}>🖨️</span>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{t('barcode.reprint')}</div>
                <div style={{ fontSize: '0.72rem', opacity: 0.7 }}>{t('barcode.printCopy')}</div>
              </div>
            </button>
          )}

          {/* Customer Profile — R-BARCODE-VIEW-CUSTOMER-EXACT-FIX-V1:
              resolve the sale's customer (by id, then phone-tail) and only
              render this button when a real customer record exists. Walk-in
              and unresolved sales hide the button so we never open the wrong
              profile via a name-search match. */}
          {(() => {
            if (!sale || !sale.customerName || sale.customerName === 'Walk-in') return null;
            const matched = resolveSaleCustomer(sale);
            if (!matched) return null;
            return (
              <button
                onClick={() => {
                  // CUSTOMER-360-INTELLIGENCE-OPEN-HISTORY-V1: mode:'edit' —
                  // same reasoning as the customer-history barcode branch above.
                  window.dispatchEvent(new CustomEvent('cellhub:open-customer', { detail: { customerId: matched.id, mode: 'edit' } }));
                  close();
                }}
                style={actionStyle('#8B5CF6')}
              >
                <span style={{ fontSize: '1.25rem' }}>👤</span>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{t('barcode.viewCustomer')}</div>
                  <div style={{ fontSize: '0.72rem', opacity: 0.7 }}>{matched.name}</div>
                </div>
              </button>
            );
          })()}

          {/* Customer History — R-BARCODE-MENU-CUSTOMER-HISTORY-AND-PHONE-PAYMENT-FIX:
              opens the actual CustomerHistoryModal instead of routing to Reports.
              Resolves the customer by customerId, then falls back to phone match. */}
          {sale && (() => {
            const matched = resolveSaleCustomer(sale);
            if (!matched) return null;
            return (
              <button
                onClick={() => openCustomerHistory(matched.id)}
                style={actionStyle('#0EA5E9')}
              >
                <span style={{ fontSize: '1.25rem' }}>📋</span>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{t('barcode.custHistory')}</div>
                  <div style={{ fontSize: '0.72rem', opacity: 0.7 }}>{t('barcode.allTx')}</div>
                </div>
              </button>
            );
          })()}

          {/* Make Phone Payment — R-BARCODE-MENU-CUSTOMER-HISTORY-AND-PHONE-PAYMENT-FIX:
              new menu option. Opens PhonePaymentModal prefilled with the
              scanned customer (name / phone / carrier / typical amount).
              No auto-charge — operator must confirm + submit inside the modal. */}
          {sale && (() => {
            const matched = resolveSaleCustomer(sale);
            if (!matched) return null;
            return (
              <button
                onClick={() => openPhonePaymentForCustomer(matched.id)}
                style={actionStyle('#F97316')}
              >
                <span style={{ fontSize: '1.25rem' }}>📞</span>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{t('barcode.makePhonePayment')}</div>
                  <div style={{ fontSize: '0.72rem', opacity: 0.7 }}>{t('barcode.makePhonePaymentSub')}</div>
                </div>
              </button>
            );
          })()}

          {/* WhatsApp */}
          {sale?.customerPhone && settings.waEnabled !== false && (
            <button
              onClick={() => {
                const msg = buildWaMessage('thankYou', {
                  customerName: sale.customerName || 'Customer',
                  storeName: settings.storeName || 'Go Cellular',
                  storePhone: settings.storePhone || '',
                }, locale === 'es' ? 'es' : locale === 'pt' ? 'pt' : 'en', (settings as any).waTemplateThankYou || '');
                openWhatsApp(sale.customerPhone!, msg);
              }}
              style={actionStyle('#25D366')}
            >
              <span style={{ fontSize: '1.25rem' }}>📲</span>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>WhatsApp</div>
                <div style={{ fontSize: '0.72rem', opacity: 0.7 }}>{t('barcode.waMessage')}</div>
              </div>
            </button>
          )}

        </div>

        <button
          onClick={close}
          className="btn btn-secondary"
          style={{ marginTop: '0.25rem' }}
        >
          {t('barcode.cancel')}
        </button>
        </>}

      </div>
    </Modal>
  );
}

// ── Shared button style ────────────────────────────────────
function actionStyle(accentColor: string): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: '0.875rem',
    padding: '0.75rem 1rem',
    background: `${accentColor}12`,
    border: `1px solid ${accentColor}35`,
    borderRadius: '0.625rem',
    cursor: 'pointer',
    color: '#e2e8f0',
    transition: 'all 0.15s',
    width: '100%',
    textAlign: 'left' as const,
  };
}
