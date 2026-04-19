// ============================================================
// CellHub Pro — Notepad Modal
// Write notes + upload images → print on thermal receipt
// ============================================================

import { useState, useRef } from 'react';
import { useApp } from '@/store/AppProvider';
import { getLabels } from '@/config/i18n';
import { Modal } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { usePrint } from '@/hooks/usePrint';

interface NotepadImage {
  id: number;
  data: string;
  name: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function NotepadModal({ open, onClose }: Props) {
  const { state: { lang, settings } } = useApp();
  const L = getLabels(lang);
  const es = lang === 'es';

  const [text, setText] = useState('');
  const [images, setImages] = useState<NotepadImage[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const { printHtml } = usePrint();
  const { toast } = useToast();

  const handleClose = () => {
    setText('');
    setImages([]);
    onClose();
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const MAX_IMAGES = 10;
    const files = Array.from(e.target.files || []);

    // Validate file type (accept="image/*" is only a browser hint)
    const validFiles = files.filter((f) => f.type.startsWith('image/'));
    if (validFiles.length < files.length) {
      toast(es ? 'Solo se permiten imágenes' : 'Only image files are allowed', 'warning');
    }

    // Enforce max image limit
    if (images.length + validFiles.length > MAX_IMAGES) {
      toast(es ? `Máximo ${MAX_IMAGES} imágenes` : `Maximum ${MAX_IMAGES} images`, 'warning');
      e.target.value = '';
      return;
    }

    validFiles.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const maxW = 800, maxH = 1000;
          let w = img.width, h = img.height;
          if (w > maxW) { h = h * (maxW / w); w = maxW; }
          if (h > maxH) { w = w * (maxH / h); h = maxH; }
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, w, h);
          const compressed = canvas.toDataURL('image/jpeg', 0.7);
          setImages((prev) => [...prev, {
            id: Date.now() + Math.random(),
            data: compressed,
            name: file.name,
          }]);
        };
        img.src = ev.target?.result as string;
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const handlePrint = async () => {
    if (!text.trim() && images.length === 0) return;

    const imagesHtml = images.map((img) =>
      `<div style="margin: 0.25in 0; text-align: center; page-break-inside: avoid;">
        <img src="${img.data}" style="max-width: 3in; max-height: 4in; height: auto; border: 1px solid #ccc; border-radius: 4px;" />
      </div>`,
    ).join('');

    const html = `<html><head>
      <title>${es ? 'Notas' : 'Notes'}</title>
      <style>
        @page { size: 4in auto; margin: 0.25in; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { width: 4in; margin: 0; padding: 0; }
        body { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; padding: 0.25in; }
        pre { font-size: 14px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; margin: 0.25in 0; }
        .header { text-align: center; margin-bottom: 0.25in; padding-bottom: 0.15in; border-bottom: 2px solid #000; }
        .header h2 { margin: 0 0 0.1in 0; font-size: 18px; }
        .header div { margin: 0.05in 0; font-size: 12px; }
        img { max-width: 100%; height: auto; display: block; margin: 0 auto; page-break-inside: avoid; }
      </style></head><body>
      <div class="header">
        <h2>${settings.storeName || 'GO CELLULAR'}</h2>
        <div>${settings.storeAddress || ''}</div>
        ${settings.storePhone ? `<div>${settings.storePhone}</div>` : ''}
      </div>
      ${text.trim() ? `<pre>${text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>` : ''}
      ${imagesHtml}
    </body></html>`;

    printHtml(html, {
      silent: false,
      printer: settings.detectedPrinters?.[0],
    });

    handleClose();
  };

  const canPrint = text.trim() || images.length > 0;

  return (
    <Modal open={open} onClose={handleClose} title={`📝 ${es ? 'Bloc de Notas' : 'Notepad'}`} size="max-w-2xl">
      {/* Info banner */}
      <div style={{
        background: 'rgba(251, 191, 36, 0.1)', border: '1px solid rgba(251, 191, 36, 0.3)',
        borderRadius: '0.75rem', padding: '0.875rem', display: 'flex',
        alignItems: 'center', gap: '0.75rem', fontSize: '0.875rem',
        color: '#f59e0b', marginBottom: '1.5rem',
      }}>
        <span style={{ fontSize: '1.5rem' }}>📝</span>
        <span style={{ flex: 1 }}>
          {es ? 'Escribe notas y sube imágenes para imprimir en recibo térmico.' : 'Write notes and upload images to print on thermal receipt.'}
        </span>
      </div>

      {/* Textarea */}
      <textarea
        className="input"
        placeholder={es ? 'Escribe tus notas aquí...' : 'Write your notes here...'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={15}
        autoFocus
        style={{
          fontFamily: 'monospace', fontSize: '1rem', lineHeight: 1.6,
          resize: 'vertical', minHeight: '300px', width: '100%',
        }}
      />

      {/* Image Upload */}
      <div style={{ marginTop: '1rem' }}>
        <input ref={fileRef} type="file" accept="image/*" multiple
          style={{ display: 'none' }} onChange={handleImageUpload} />
        <button onClick={() => fileRef.current?.click()} className="btn btn-secondary" style={{ width: '100%' }}>
          {es ? '📷 Subir Imagen(es)' : '📷 Upload Image(s)'}
        </button>

        {images.length > 0 && (
          <div style={{
            marginTop: '1rem', display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '0.75rem',
          }}>
            {images.map((img) => (
              <div key={img.id} style={{ position: 'relative' }}>
                <img src={img.data} alt={img.name} style={{
                  width: '100%', height: '120px', objectFit: 'cover',
                  borderRadius: '0.5rem', border: '1px solid rgba(255,255,255,0.2)',
                }} />
                <button
                  onClick={() => setImages((prev) => prev.filter((i) => i.id !== img.id))}
                  style={{
                    position: 'absolute', top: '0.25rem', right: '0.25rem',
                    background: 'rgba(239, 68, 68, 0.9)', border: 'none', borderRadius: '50%',
                    width: '24px', height: '24px', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', cursor: 'pointer', color: 'white', fontSize: '14px',
                  }}
                >×</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
        <button onClick={handleClose} className="btn btn-secondary" style={{ flex: 1 }}>
          {es ? 'Cerrar' : 'Close'}
        </button>
        <button onClick={handlePrint} className="btn btn-primary" style={{ flex: 1 }}
          disabled={!canPrint}>
          🖨️ {es ? 'Imprimir' : 'Print'}
        </button>
      </div>
    </Modal>
  );
}
