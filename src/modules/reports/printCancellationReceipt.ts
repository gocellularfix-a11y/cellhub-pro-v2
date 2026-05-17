// ============================================================
// CellHub Pro — Cancellation Receipt Print Helper
// Generates 4x6 thermal receipt HTML for cancellation records.
// ============================================================

import type { StoreSettings } from '@/store/types';

export interface CancellationRow {
  id: string;
  type: 'special_order' | 'repair' | 'unlock';
  typeLabel: string;
  reference: string;
  customerName: string;
  itemDescription: string;
  refundAmountCents: number;
  refundMethod: 'store_credit' | 'cash' | 'forfeit' | 'unknown';
  cancelledAt: string;
  cancellationNote: string;
}

function escHtml(s: unknown): string {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function buildCancellationReceiptHtml(
  row: CancellationRow,
  settings: StoreSettings,
  locale: string,
  employeeName?: string,
  paperSize?: string,
): string {
  const storeName = escHtml(settings.storeName || 'CellHub Pro');
  const storeAddr = escHtml((settings as any).storeAddress || '');
  const storePhone = escHtml((settings as any).storePhone || '');

  const methodLabels: Record<string, { en: string; es: string; pt: string }> = {
    store_credit: { en: 'STORE CREDIT',    es: 'CRÉDITO DE TIENDA',    pt: 'CRÉDITO DE LOJA' },
    cash:         { en: 'CASH REFUND',     es: 'REEMBOLSO EFECTIVO',   pt: 'REEMBOLSO DINHEIRO' },
    forfeit:      { en: 'FORFEITED',       es: 'RETENIDO',             pt: 'RETIDO' },
    unknown:      { en: 'UNKNOWN',         es: 'DESCONOCIDO',          pt: 'DESCONHECIDO' },
  };
  const methodLabel = methodLabels[row.refundMethod] || methodLabels.unknown;
  const methodText = locale === 'es' ? methodLabel.es : locale === 'pt' ? methodLabel.pt : methodLabel.en;

  const typeDisplayEn: Record<string, string> = {
    special_order: 'Special Order',
    repair: 'Repair',
    unlock: 'Unlock',
  };
  const typeDisplayEs: Record<string, string> = {
    special_order: 'Pedido Especial',
    repair: 'Reparación',
    unlock: 'Desbloqueo',
  };
  const typeDisplayPt: Record<string, string> = {
    special_order: 'Pedido Especial',
    repair: 'Reparo',
    unlock: 'Desbloqueio',
  };
  const typeDisplay = locale === 'es'
    ? typeDisplayEs[row.type] || row.typeLabel
    : locale === 'pt'
      ? typeDisplayPt[row.type] || row.typeLabel
      : typeDisplayEn[row.type] || row.typeLabel;

  const dateStr = new Date(row.cancelledAt).toLocaleString(locale === 'es' ? 'es-MX' : locale === 'pt' ? 'pt-BR' : 'en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });

  const isForfeit = row.refundMethod === 'forfeit';
  const amountPrefix = isForfeit ? '' : '-';
  const amountColor = isForfeit ? '#000' : '#c00';
  const is80mm = paperSize === '80mm';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Cancellation Receipt</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Courier New', Courier, monospace;
    font-size: 11px;
    line-height: 1.35;
    color: #000;
    background: #fff;
    padding: ${is80mm ? '2mm 4mm' : '8px'};
    width: ${is80mm ? '80mm' : '4in'};
  }
  .header { text-align: center; margin-bottom: 10px; }
  .store-name { font-size: 14px; font-weight: bold; letter-spacing: 0.5px; }
  .store-info { font-size: 10px; margin-top: 2px; }
  .title {
    font-size: 13px; font-weight: bold; text-align: center;
    padding: 6px 0; margin: 6px 0;
    border-top: 2px solid #000; border-bottom: 2px solid #000;
    letter-spacing: 1px;
  }
  .row { display: flex; justify-content: space-between; padding: 2px 0; }
  .label { font-weight: bold; }
  .section { margin: 8px 0; padding: 6px 0; border-top: 1px dashed #000; }
  .amount-section {
    text-align: center; padding: 10px 0; margin: 10px 0;
    border-top: 2px solid #000; border-bottom: 2px solid #000;
  }
  .amount-label { font-size: 11px; font-weight: bold; }
  .amount-value { font-size: 22px; font-weight: bold; margin-top: 4px; color: ${amountColor}; }
  .method-badge {
    display: inline-block; padding: 3px 10px; margin-top: 4px;
    border: 2px solid #000; font-weight: bold; letter-spacing: 0.5px;
  }
  .note-section { padding: 6px; margin: 6px 0; border: 1px dashed #000; font-size: 10px; }
  .note-label { font-weight: bold; margin-bottom: 3px; }
  .signature-block { margin-top: 18px; padding-top: 8px; }
  .signature-line {
    border-top: 1px solid #000; padding-top: 2px;
    margin-top: 24px; font-size: 9px; text-align: center;
  }
  .footer { margin-top: 12px; padding-top: 8px; border-top: 1px dashed #000; text-align: center; font-size: 9px; }
  @media print { body { padding: 0; } @page { size: ${is80mm ? '80mm auto' : '4in 6in'}; margin: ${is80mm ? '0' : '0.1in'}; } }
</style>
</head>
<body>

<div class="header">
  <div class="store-name">${storeName}</div>
  ${storeAddr ? `<div class="store-info">${storeAddr}</div>` : ''}
  ${storePhone ? `<div class="store-info">${storePhone}</div>` : ''}
</div>

<div class="title">${locale === 'es' ? 'RECIBO DE CANCELACI\u00d3N' : 'CANCELLATION RECEIPT'}</div>

<div class="row"><span class="label">${locale === 'es' ? 'Fecha:' : 'Date:'}</span><span>${escHtml(dateStr)}</span></div>
<div class="row"><span class="label">Ref:</span><span>${escHtml(row.reference)}</span></div>
<div class="row"><span class="label">${locale === 'es' ? 'Tipo:' : 'Type:'}</span><span>${escHtml(typeDisplay)}</span></div>

<div class="section">
  <div class="row"><span class="label">${locale === 'es' ? 'Cliente:' : 'Customer:'}</span><span>${escHtml(row.customerName)}</span></div>
  ${row.itemDescription ? `<div style="margin-top:4px"><div class="label">${locale === 'es' ? 'Art\u00edculo:' : 'Item:'}</div><div style="padding-left:4px;margin-top:2px">${escHtml(row.itemDescription)}</div></div>` : ''}
</div>

<div class="amount-section">
  <div class="amount-label">${locale === 'es' ? 'MONTO REEMBOLSADO' : 'AMOUNT REFUNDED'}</div>
  <div class="amount-value">${amountPrefix}${formatMoney(row.refundAmountCents)}</div>
  <div class="method-badge">${escHtml(methodText)}</div>
</div>

${row.cancellationNote ? `<div class="note-section"><div class="note-label">${locale === 'es' ? 'Raz\u00f3n:' : 'Reason:'}</div><div>${escHtml(row.cancellationNote)}</div></div>` : ''}

<div class="signature-block">
  <div><div class="signature-line">${locale === 'es' ? 'Firma del Cliente' : 'Customer Signature'}</div></div>
  <div><div class="signature-line">${locale === 'es' ? 'Firma del Empleado' : 'Employee Signature'}${employeeName ? ` — ${escHtml(employeeName)}` : ''}</div></div>
</div>

<div class="footer">${locale === 'es' ? 'Gracias por su preferencia' : 'Thank you for your business'}</div>

</body>
</html>`;
}
