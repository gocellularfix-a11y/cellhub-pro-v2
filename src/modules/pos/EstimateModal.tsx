// ============================================================
// CellHub Pro — Estimate Modal (Cash Sale / Quick Estimate)
// NOT saved to system — receipt print only
// ============================================================

import { useState } from 'react';
import { useApp } from '@/store/AppProvider';
import { useTranslation } from '@/i18n';
import { formatCurrency, toCents } from '@/utils/currency';
import { forwardTaxFromBase } from '@/utils/depositTax';
import { escHtml } from '@/utils/escHtml';
import { Modal } from '@/components/ui';
import { usePrint } from '@/hooks/usePrint';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function EstimateModal({ open, onClose }: Props) {
  const { state: { settings } } = useApp();
  const { t } = useTranslation();

  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [taxable, setTaxable] = useState(true);

  const { printHtml } = usePrint();

  const handleClose = () => {
    setDescription('');
    setAmount('');
    setNotes('');
    setTaxable(true);
    onClose();
  };

  const subtotalCents = toCents(amount);
  const taxRate = settings.taxRate ?? 0.0925;
  const taxRatePercent = (taxRate * 100).toFixed(2);
  const fwd = forwardTaxFromBase(subtotalCents, taxRate, taxable);

  const handlePrint = () => {
    if (!description.trim()) return;
    if (subtotalCents <= 0) return;

    const now = new Date();
    const receiptNum = `EST-${now.toISOString().slice(2, 10).replace(/-/g, '')}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    const html = `<html><head><title>Estimate</title><style>
      @page { size: 4in auto; margin: 0.25in; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 4in; margin: 0; padding: 0; }
      body { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; padding: 0.25in; }
      .header { text-align: center; margin-bottom: 0.2in; padding-bottom: 0.15in; border-bottom: 2px solid #000; }
      .header h2 { margin: 0 0 0.05in 0; font-size: 18px; }
      .header div { margin: 0.03in 0; font-size: 12px; }
      .line { border-top: 1px dashed #000; margin: 0.15in 0; }
      .row { display: flex; justify-content: space-between; font-size: 14px; padding: 0.04in 0; }
      .total { font-size: 20px; font-weight: 800; }
      .footer { text-align: center; margin-top: 0.2in; font-size: 12px; }
    </style></head><body>
      <div class="header">
        <h2>${escHtml(settings.storeName || 'GO CELLULAR')}</h2>
        <div>${escHtml(settings.storeAddress || '')}</div>
        ${settings.storePhone ? `<div>${escHtml(settings.storePhone)}</div>` : ''}
      </div>
      <div class="row" style="font-size:16px;font-weight:700;justify-content:center"><span>*** ${t('estimateModal.title').toUpperCase()} ***</span></div>
      <div class="row"><span>${t('estimateModal.title').toUpperCase()} #:</span><span>${escHtml(receiptNum)}</span></div>
      <div class="row"><span>${t('estimateModal.dateLabel')}:</span><span>${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>
      <div class="line"></div>
      <div class="row"><span style="flex:1">${escHtml(description)}</span></div>
      ${notes ? `<div class="row" style="font-size:12px;color:#666"><span>${escHtml(notes)}</span></div>` : ''}
      <div class="line"></div>
      <div class="row"><span>Subtotal:</span><span>${formatCurrency(fwd.baseCents)}</span></div>
      ${taxable ? `<div class="row"><span>Tax (${taxRatePercent}%):</span><span>${formatCurrency(fwd.taxCents)}</span></div>` : ''}
      <div class="line"></div>
      <div class="row total"><span>TOTAL:</span><span>${formatCurrency(fwd.totalCents)}</span></div>
      <div class="footer">
        <div class="line"></div>
        <div style="font-size:14px;font-weight:700;margin:0.1in 0">*** ${t('estimateModal.notReceiptDisclaimer')} ***</div>
        <div>${t('estimateModal.thankYou')}</div>
      </div>
    </body></html>`;

    printHtml(html, {
      silent: false,
      printer: settings.detectedPrinters?.[0],
    });

    handleClose();
  };

  return (
    <Modal open={open} onClose={handleClose} title={`📋 ${t('estimateModal.title')}`} size="max-w-lg">
      {/* Info banner */}
      <div style={{
        background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.3)',
        borderRadius: '0.75rem', padding: '0.75rem', marginBottom: '1.5rem',
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        fontSize: '0.875rem', color: '#60a5fa',
      }}>
        <span style={{ fontSize: '1.25rem' }}>📋</span>
        <span>{t('estimateModal.notSavedBanner')}</span>
      </div>

      {/* Description */}
      <div style={{ marginBottom: '1rem' }}>
        <label className="text-sm text-slate-400 mb-1 block">{t('estimateModal.descriptionLabel')}</label>
        <input
          type="text"
          className="input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('estimateModal.descriptionPlaceholder')}
          autoFocus
        />
      </div>

      {/* Amount */}
      <div style={{ marginBottom: '1rem' }}>
        <label className="text-sm text-slate-400 mb-1 block">{t('estimateModal.amountLabel')}</label>
        <input
          type="number"
          step="0.01"
          min="0.01"
          className="input"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          style={{ fontSize: '1.5rem', fontWeight: 700, textAlign: 'center' }}
        />
      </div>

      {/* Tax toggle */}
      <div style={{ marginBottom: '1rem' }}>
        <label style={{
          display: 'flex', alignItems: 'center', gap: '0.75rem',
          padding: '0.75rem', background: 'var(--bg-input)',
          borderRadius: '0.5rem', cursor: 'pointer',
          border: '2px solid var(--border-default)',
        }}>
          <input
            type="checkbox"
            checked={taxable}
            onChange={(e) => setTaxable(e.target.checked)}
            style={{ width: '18px', height: '18px', cursor: 'pointer' }}
          />
          <div style={{ flex: 1 }}>
            <strong>💵 {t('estimateModal.chargeTax')}</strong>
            <br />
            <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              Tax rate: {taxRatePercent}%
            </span>
          </div>
        </label>
      </div>

      {/* Notes */}
      <div style={{ marginBottom: '1rem' }}>
        <label className="text-sm text-slate-400 mb-1 block">{t('estimateModal.notesLabel')}</label>
        <input
          type="text"
          className="input"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t('estimateModal.notesPlaceholder')}
        />
      </div>

      {/* Total Preview */}
      {subtotalCents > 0 && (
        <div style={{
          background: 'rgba(59, 130, 246, 0.08)', borderRadius: '1rem',
          padding: '1.25rem', marginBottom: '1rem',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.95rem', marginBottom: '0.4rem' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Subtotal:</span>
            <span style={{ fontWeight: 600 }}>{formatCurrency(fwd.baseCents)}</span>
          </div>
          {taxable && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.95rem', marginBottom: '0.4rem' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Tax ({taxRatePercent}%):</span>
              <span style={{ fontWeight: 600 }}>{formatCurrency(fwd.taxCents)}</span>
            </div>
          )}
          <div style={{
            borderTop: '1px solid var(--border-default)', paddingTop: '0.5rem',
            marginTop: '0.25rem', display: 'flex', justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: '1.25rem', fontWeight: 800, color: '#60a5fa' }}>TOTAL:</span>
            <span style={{ fontSize: '1.5rem', fontWeight: 800, color: '#22c55e' }}>{formatCurrency(fwd.totalCents)}</span>
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <button onClick={handleClose} className="btn btn-secondary" style={{ flex: 1 }}>
          {t('cancel')}
        </button>
        <button
          onClick={handlePrint}
          className="btn btn-primary"
          style={{ flex: 1 }}
          disabled={!description.trim() || subtotalCents <= 0}
        >
          🖨️ {t('estimateModal.printButton')}
        </button>
      </div>
    </Modal>
  );
}
