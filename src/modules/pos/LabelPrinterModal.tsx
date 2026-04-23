// ============================================================
// CellHub Pro — Label Printer Modal
// Paste text OR image (Ctrl+V) → preview 4×6 → print thermal sticker.
// Use case: Amazon/eBay return labels, shipping labels, etc.
// ============================================================

import { useState, useRef, useCallback } from 'react';
import { useApp } from '@/store/AppProvider';
import { Modal } from '@/components/ui';
import { usePrint } from '@/hooks/usePrint';
import { escHtml } from '@/utils/escHtml';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function LabelPrinterModal({ open, onClose }: Props) {
  const { state: { lang, settings } } = useApp();
  const es = lang === 'es';
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
    <Modal open={open} onClose={handleClose} title={`🏷️ ${es ? 'Imprimir Etiqueta 4×6' : 'Print Label 4×6'}`} size="max-w-lg">
      {/* Mode toggle */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button
          onClick={() => setMode('text')}
          style={{
            flex: 1, padding: '0.5rem', borderRadius: '8px', border: 'none', cursor: 'pointer',
            fontSize: '0.85rem', fontWeight: 600,
            background: mode === 'text' ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.05)',
            color: mode === 'text' ? '#60a5fa' : '#64748b',
            outline: mode === 'text' ? '1px solid rgba(59,130,246,0.4)' : 'none',
          }}
        >
          📝 {es ? 'Texto' : 'Text'}
        </button>
        <button
          onClick={() => setMode('image')}
          style={{
            flex: 1, padding: '0.5rem', borderRadius: '8px', border: 'none', cursor: 'pointer',
            fontSize: '0.85rem', fontWeight: 600,
            background: mode === 'image' ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.05)',
            color: mode === 'image' ? '#34d399' : '#64748b',
            outline: mode === 'image' ? '1px solid rgba(16,185,129,0.4)' : 'none',
          }}
        >
          🖼️ {es ? 'Imagen' : 'Image'}
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
            placeholder={es
              ? 'Pega el texto del label aquí (Ctrl+V)...\n\nSi pegas una imagen, cambia automáticamente a modo imagen.'
              : 'Paste label text here (Ctrl+V)...\n\nIf you paste an image, it switches to image mode automatically.'}
            className="input"
            style={{
              width: '100%', minHeight: '200px', fontFamily: 'monospace',
              fontSize: '0.85rem', lineHeight: 1.5, resize: 'vertical',
            }}
            autoFocus
          />
          <p style={{ fontSize: '0.7rem', color: '#475569', marginTop: '0.35rem' }}>
            💡 {es ? 'Tip: Si pegas una imagen (screenshot), cambia a modo imagen automáticamente.' : 'Tip: If you paste an image (screenshot), it auto-switches to image mode.'}
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
                border: '2px dashed rgba(255,255,255,0.15)',
                borderRadius: '12px', padding: '3rem 1rem',
                textAlign: 'center', color: '#64748b', cursor: 'pointer',
                background: 'rgba(255,255,255,0.02)',
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
                {es ? 'Pega (Ctrl+V), arrastra, o haz click' : 'Paste (Ctrl+V), drag, or click'}
              </p>
              <p style={{ fontSize: '0.75rem' }}>
                {es ? 'Acepta screenshots, imágenes de labels de Amazon/eBay' : 'Accepts screenshots, Amazon/eBay label images'}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
        <button onClick={handleClose} className="btn btn-secondary" style={{ flex: 1 }}>
          {es ? 'Cancelar' : 'Cancel'}
        </button>
        <button
          onClick={handlePrint}
          disabled={!hasContent}
          className="btn btn-primary"
          style={{ flex: 2, opacity: hasContent ? 1 : 0.4 }}
        >
          🖨️ {es ? 'Imprimir 4×6' : 'Print 4×6'}
        </button>
      </div>
    </Modal>
  );
}
