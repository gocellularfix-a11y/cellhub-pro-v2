// ============================================================
// CellHub Pro — Label Printer Modal
// Paste text OR image (Ctrl+V) → preview 4×6 → print thermal sticker.
// Use case: Amazon/eBay return labels, shipping labels, etc.
// ============================================================

import { useState, useRef, useCallback } from 'react';
import { useApp } from '@/store/AppProvider';
import { useTranslation } from '@/i18n';
import { Modal } from '@/components/ui';
import { usePrint } from '@/hooks/usePrint';
import { escHtml } from '@/utils/escHtml';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function LabelPrinterModal({ open, onClose }: Props) {
  const { state: { settings } } = useApp();
  const { t } = useTranslation();
  const { printHtml } = usePrint();

  const [text, setText] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [mode, setMode] = useState<'text' | 'image'>('text');
  const textRef = useRef<HTMLTextAreaElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const handleClose = () => {
    setText('');
    setImage(null);
    setMode('text');
    onClose();
  };

  // Handle paste — detect image vs text automatically
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const imageItem = items.find((i) => i.type.startsWith('image/'));
    if (imageItem) {
      e.preventDefault();
      const blob = imageItem.getAsFile();
      if (!blob) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        setImage(ev.target?.result as string);
        setMode('image');
      };
      reader.readAsDataURL(blob);
      return;
    }
    // Text paste — let default behavior handle it
  }, []);

  // Handle file upload (drag & drop or button)
  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setImage(ev.target?.result as string);
      setMode('image');
    };
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handlePrint = () => {
    if (mode === 'image' && image) {
      const html = `<!DOCTYPE html><html><head><title>Label</title><style>
        @page { size: 4in 6in; margin: 0; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { width: 4in; height: 6in; margin: 0; padding: 0; }
        body { display: flex; align-items: center; justify-content: center; }
        img { max-width: 4in; max-height: 6in; width: auto; height: auto; object-fit: contain; }
      </style></head><body><img src="${image}" /></body></html>`;
      printHtml(html, { silent: false, printer: settings.detectedPrinters?.[0] });
    } else if (mode === 'text' && text.trim()) {
      const escaped = escHtml(text);
      const html = `<!DOCTYPE html><html><head><title>Label</title><style>
        @page { size: 4in 6in; margin: 0; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { width: 4in; height: 6in; margin: 0; padding: 0; }
        body { font-family: Arial, Helvetica, sans-serif; padding: 0.2in; }
        pre { font-size: 11px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; margin: 0; font-family: inherit; }
      </style></head><body><pre>${escaped}</pre></body></html>`;
      printHtml(html, { silent: false, printer: settings.detectedPrinters?.[0] });
    }
  };

  const hasContent = (mode === 'image' && image) || (mode === 'text' && text.trim());

  if (!open) return null;

  return (
    <Modal open={open} onClose={handleClose} title={`🏷️ ${t('labelPrinterModal.title')}`} size="max-w-lg">
      {/* Mode toggle */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button
          onClick={() => setMode('text')}
          style={{
            flex: 1, padding: '0.5rem', borderRadius: '8px', border: 'none', cursor: 'pointer',
            fontSize: '0.85rem', fontWeight: 600,
            background: mode === 'text' ? 'rgba(59,130,246,0.2)' : 'var(--bg-input)',
            color: mode === 'text' ? '#60a5fa' : 'var(--text-muted)',
            outline: mode === 'text' ? '1px solid rgba(59,130,246,0.4)' : 'none',
          }}
        >
          📝 {t('labelPrinterModal.textTab')}
        </button>
        <button
          onClick={() => setMode('image')}
          style={{
            flex: 1, padding: '0.5rem', borderRadius: '8px', border: 'none', cursor: 'pointer',
            fontSize: '0.85rem', fontWeight: 600,
            background: mode === 'image' ? 'rgba(16,185,129,0.2)' : 'var(--bg-input)',
            color: mode === 'image' ? '#34d399' : 'var(--text-muted)',
            outline: mode === 'image' ? '1px solid rgba(16,185,129,0.4)' : 'none',
          }}
        >
          🖼️ {t('labelPrinterModal.imageTab')}
        </button>
      </div>

      {/* Text mode */}
      {mode === 'text' && (
        <div>
          <textarea
            ref={textRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={handlePaste}
            placeholder={t('labelPrinterModal.textPlaceholder')}
            className="input"
            style={{
              width: '100%', minHeight: '200px', fontFamily: 'monospace',
              fontSize: '0.85rem', lineHeight: 1.5, resize: 'vertical',
            }}
            autoFocus
          />
          <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
            💡 {t('labelPrinterModal.tip')}
          </p>
        </div>
      )}

      {/* Image mode */}
      {mode === 'image' && (
        <div>
          {image ? (
            <div style={{ position: 'relative' }}>
              <div style={{
                background: '#fff', borderRadius: '8px', padding: '0.5rem',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                minHeight: '200px', maxHeight: '400px', overflow: 'hidden',
              }}>
                <img
                  src={image}
                  alt="Label"
                  style={{ maxWidth: '100%', maxHeight: '380px', objectFit: 'contain' }}
                />
              </div>
              <button
                onClick={() => { setImage(null); }}
                style={{
                  position: 'absolute', top: '0.5rem', right: '0.5rem',
                  background: 'rgba(239,68,68,0.9)', border: 'none', borderRadius: '50%',
                  width: '28px', height: '28px', color: '#fff', cursor: 'pointer',
                  fontSize: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >✕</button>
            </div>
          ) : (
            <div
              ref={dropRef}
              onPaste={handlePaste}
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              tabIndex={0}
              style={{
                border: '2px dashed var(--border-default)',
                borderRadius: '12px', padding: '3rem 1rem',
                textAlign: 'center', color: 'var(--text-muted)', cursor: 'pointer',
                background: 'var(--bg-input)',
                minHeight: '200px', display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: '0.75rem',
              }}
              onClick={() => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'image/*';
                input.onchange = (e) => {
                  const file = (e.target as HTMLInputElement).files?.[0];
                  if (file) handleFile(file);
                };
                input.click();
              }}
            >
              <div style={{ fontSize: '3rem', opacity: 0.3 }}>📋</div>
              <p style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                {t('labelPrinterModal.dropPrompt')}
              </p>
              <p style={{ fontSize: '0.75rem' }}>
                {t('labelPrinterModal.dropHint')}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
        <button onClick={handleClose} className="btn btn-secondary" style={{ flex: 1 }}>
          {t('cancel')}
        </button>
        <button
          onClick={handlePrint}
          disabled={!hasContent}
          className="btn btn-primary"
          style={{ flex: 2, opacity: hasContent ? 1 : 0.4 }}
        >
          🖨️ {t('labelPrinterModal.printButton')}
        </button>
      </div>
    </Modal>
  );
}
