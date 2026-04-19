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
import { getLabels } from '@/config/i18n';
import { openWhatsApp, buildWaMessage } from '@/services/whatsapp';

export default function BarcodeActionModal() {
  const { state, dispatch } = useApp();
  const {
    pendingBarcodeInvoice,
    sales,
    settings,
    cart,
    lang,
  } = state;

  const { printHtml } = usePrint();
  const L = getLabels(lang);
  const es = lang === 'es';

  // Find the sale matching the scanned invoice number
  const sale = useMemo(() => {
    if (!pendingBarcodeInvoice) return null;
    return (sales || []).find(
      (s) => s.invoiceNumber?.toLowerCase() === pendingBarcodeInvoice.toLowerCase()
    ) || null;
  }, [pendingBarcodeInvoice, sales]);

  const isOpen = !!pendingBarcodeInvoice;

  const close = () => dispatch({ type: 'SET_PENDING_BARCODE_INVOICE', payload: '' });

  const navigate = (tab: string) => {
    dispatch({ type: 'SET_ACTIVE_TAB', payload: tab });
    close();
  };

  // ── Actions ───────────────────────────────────────────────

  const goToReports = () => {
    dispatch({ type: 'SET_GLOBAL_SEARCH', payload: pendingBarcodeInvoice });
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
      name: `${es ? 'Saldo' : 'Balance'} — ${sale.invoiceNumber}`,
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
    const bsvg = renderBarcodeSvg(sale.invoiceNumber);
    const html = generateReceiptHtml(sale, settings, lang, undefined, bsvg);
    printHtml(html, { silent: false, printer: settings.detectedPrinters?.[0] });
    close();
  };

  if (!isOpen) return null;

  const hasBalance = sale && (sale as any).balance > 0;

  return (
    <Modal
      open={isOpen}
      onClose={close}
      title={`📱 ${es ? 'Código Escaneado' : 'Barcode Scanned'}`}
      size="max-w-sm"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>

        {/* Invoice badge */}
        <div style={{
          textAlign: 'center',
          padding: '0.875rem',
          background: 'rgba(102,126,234,0.08)',
          border: '1px solid rgba(102,126,234,0.25)',
          borderRadius: '0.75rem',
        }}>
          <div style={{ fontSize: '0.72rem', color: '#64748b', marginBottom: '0.35rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            {es ? 'Factura detectada' : 'Invoice detected'}
          </div>
          <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#a5b4fc', fontFamily: 'monospace', letterSpacing: '0.05em' }}>
            {pendingBarcodeInvoice}
          </div>

          {/* Sale summary if found */}
          {sale ? (
            <div style={{ marginTop: '0.625rem', fontSize: '0.8rem', color: '#94a3b8', lineHeight: 1.5 }}>
              {sale.customerName && <div style={{ fontWeight: 600, color: '#e2e8f0' }}>{sale.customerName}</div>}
              <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginTop: '0.25rem' }}>
                <span>{es ? 'Total' : 'Total'}: <strong style={{ color: '#22c55e' }}>{formatCurrency(sale.total)}</strong></span>
                <span>{sale.paymentMethod}</span>
              </div>
              {hasBalance && (
                <div style={{
                  marginTop: '0.4rem', padding: '0.25rem 0.75rem',
                  background: 'rgba(251,191,36,0.12)', borderRadius: '999px',
                  color: '#f59e0b', fontWeight: 700, fontSize: '0.78rem',
                  display: 'inline-block',
                }}>
                  ⚠️ {es ? 'Saldo pendiente' : 'Balance due'}: {formatCurrency((sale as any).balance)}
                </div>
              )}
            </div>
          ) : (
            <div style={{ marginTop: '0.5rem', fontSize: '0.78rem', color: '#ef4444' }}>
              ⚠️ {es ? 'Factura no encontrada en el sistema' : 'Invoice not found in system'}
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
              <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{es ? 'Ver Detalles' : 'View Details'}</div>
              <div style={{ fontSize: '0.72rem', opacity: 0.7 }}>{es ? 'Abrir en Reportes' : 'Open in Reports'}</div>
            </div>
          </button>

          <button
            onClick={goToReturns}
            style={actionStyle('#E24B4A')}
          >
            <span style={{ fontSize: '1.25rem' }}>↩️</span>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{es ? 'Procesar Devolución' : 'Process Return'}</div>
              <div style={{ fontSize: '0.72rem', opacity: 0.7 }}>{es ? 'Ir al módulo de Devoluciones' : 'Go to Returns module'}</div>
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
                  {es ? 'Cobrar Saldo' : 'Collect Balance'} — {formatCurrency((sale as any).balance)}
                </div>
                <div style={{ fontSize: '0.72rem', opacity: 0.7 }}>{es ? 'Agregar saldo al carrito' : 'Add balance to cart'}</div>
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
                <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{es ? 'Reimprimir Recibo' : 'Reprint Receipt'}</div>
                <div style={{ fontSize: '0.72rem', opacity: 0.7 }}>{es ? 'Imprimir copia del recibo 4×6' : 'Print 4×6 receipt copy'}</div>
              </div>
            </button>
          )}

          {/* Customer Profile */}
          {sale?.customerName && sale.customerName !== 'Walk-in' && (
            <button
              onClick={() => {
                dispatch({ type: 'SET_GLOBAL_SEARCH', payload: sale.customerName || '' });
                navigate('customers');
              }}
              style={actionStyle('#8B5CF6')}
            >
              <span style={{ fontSize: '1.25rem' }}>👤</span>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{es ? 'Ver Cliente' : 'View Customer'}</div>
                <div style={{ fontSize: '0.72rem', opacity: 0.7 }}>{sale.customerName}</div>
              </div>
            </button>
          )}

          {/* Customer History */}
          {sale?.customerId && (
            <button
              onClick={() => {
                dispatch({ type: 'SET_GLOBAL_SEARCH', payload: sale.customerName || '' });
                navigate('reports');
              }}
              style={actionStyle('#0EA5E9')}
            >
              <span style={{ fontSize: '1.25rem' }}>📋</span>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{es ? 'Historial del Cliente' : 'Customer History'}</div>
                <div style={{ fontSize: '0.72rem', opacity: 0.7 }}>{es ? 'Todas las transacciones' : 'All transactions'}</div>
              </div>
            </button>
          )}

          {/* WhatsApp */}
          {sale?.customerPhone && settings.waEnabled !== false && (
            <button
              onClick={() => {
                const msg = buildWaMessage('thankYou', {
                  customerName: sale.customerName || 'Customer',
                  storeName: settings.storeName || 'Go Cellular',
                  storePhone: settings.storePhone || '',
                }, es ? 'es' : 'en', (settings as any).waTemplateThankYou || '');
                openWhatsApp(sale.customerPhone!, msg);
              }}
              style={actionStyle('#25D366')}
            >
              <span style={{ fontSize: '1.25rem' }}>📲</span>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>WhatsApp</div>
                <div style={{ fontSize: '0.72rem', opacity: 0.7 }}>{es ? 'Enviar mensaje al cliente' : 'Message customer'}</div>
              </div>
            </button>
          )}

        </div>

        <button
          onClick={close}
          className="btn btn-secondary"
          style={{ marginTop: '0.25rem' }}
        >
          {es ? 'Cancelar' : 'Cancel'}
        </button>
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
