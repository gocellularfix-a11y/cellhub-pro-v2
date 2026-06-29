// ============================================================
// CellHub Pro — Print Desk (PRINT-DESK-MODULE-V1-UI-ONLY)
//   + PRINT-DESK-BARCODE-QUALITY-MODE-V1
//
// A practical "fix and print" workspace: paste/upload/drag an image (e.g. an
// Amazon return-label screenshot), rotate it, fit it to a 4x6 or Letter page,
// and print — keeping the tracking barcode sharp enough for a scanner.
//
// QUALITY MODEL (V1 barcode mode):
//   • The ORIGINAL pasted/uploaded image is stored at FULL resolution (no
//     downscale, no re-compression on import).
//   • Rotation + the printed image are rendered on a canvas with
//     imageSmoothingEnabled = false (nearest-neighbor) and exported as PNG
//     (lossless) — never JPEG.
//   • "Barcode Sharp" mode (default) adds a contrast boost to crisp the
//     black/white separation. "Standard" mode skips the contrast pass.
//   • The on-screen preview may render at reduced resolution for speed; the
//     PRINT always renders from the full-resolution source.
//
// STRICTLY UI/UTILITY. Touches NO business logic, money, tax, POS math, sales,
// receipts, customers, inventory, layaway, special orders, reports, or
// payments. Renders a Modal.
// ============================================================
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useApp } from '@/store/AppProvider';
import { useTranslation } from '@/i18n';
import { Modal } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { usePrint } from '@/hooks/usePrint';

interface Props {
  open: boolean;
  onClose: () => void;
}

// `data` holds the ORIGINAL full-resolution data URL exactly as pasted/loaded.
interface SourceImage { data: string; w: number; h: number }

type FitMode = '4x6' | 'letter';
type Orientation = 'portrait' | 'landscape';
type Quality = 'standard' | 'sharp';

const PREVIEW_MAX = 1400;   // preview render cap (visual only — print uses full res)
const SHARP_CONTRAST = 48;  // moderate contrast boost for barcode mode [-255..255]

// Render `src` rotated (0/90/180/270) onto a canvas with NO smoothing, optional
// contrast boost (sharp mode), and PNG output. `maxDim` caps the longest side
// for fast previews; omit it for full-resolution print output.
function renderCanvas(
  src: SourceImage,
  rotation: number,
  opts: { sharp: boolean; maxDim?: number },
): Promise<{ url: string; w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const swap = rotation === 90 || rotation === 270;
      let cw = swap ? src.h : src.w;
      let ch = swap ? src.w : src.h;
      // Visual-only downscale for previews (keeps aspect; never used for print).
      let drawScale = 1;
      if (opts.maxDim) {
        const longest = Math.max(cw, ch);
        if (longest > opts.maxDim) drawScale = opts.maxDim / longest;
      }
      cw = Math.max(1, Math.round(cw * drawScale));
      ch = Math.max(1, Math.round(ch * drawScale));
      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve({ url: src.data, w: src.w, h: src.h }); return; }
      // Sharp barcode edges: no bilinear smoothing.
      ctx.imageSmoothingEnabled = false;
      // (some engines also gate on quality)
      (ctx as unknown as { imageSmoothingQuality?: string }).imageSmoothingQuality = 'high';
      ctx.translate(cw / 2, ch / 2);
      ctx.rotate((rotation * Math.PI) / 180);
      const dw = (swap ? ch : cw);
      const dh = (swap ? cw : ch);
      ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      if (opts.sharp) {
        // Increase contrast to crisp the black/white label separation. Standard
        // contrast curve — NOT a hard binarization (keeps logos/text legible).
        try {
          const id = ctx.getImageData(0, 0, cw, ch);
          const d = id.data;
          const c = SHARP_CONTRAST;
          const f = (259 * (c + 255)) / (255 * (259 - c));
          for (let i = 0; i < d.length; i += 4) {
            d[i] = Math.max(0, Math.min(255, f * (d[i] - 128) + 128));
            d[i + 1] = Math.max(0, Math.min(255, f * (d[i + 1] - 128) + 128));
            d[i + 2] = Math.max(0, Math.min(255, f * (d[i + 2] - 128) + 128));
          }
          ctx.putImageData(id, 0, 0);
        } catch { /* tainted canvas / OOM — fall back to un-contrasted output */ }
      }
      // PNG = lossless. Never JPEG (JPEG ringing softens barcode bars).
      resolve({ url: canvas.toDataURL('image/png'), w: cw, h: ch });
    };
    img.onerror = () => resolve({ url: src.data, w: src.w, h: src.h });
    img.src = src.data;
  });
}

export default function PrintDeskModal({ open, onClose }: Props) {
  const { state: { settings } } = useApp();
  const { t } = useTranslation();
  const { toast } = useToast();
  const { printHtml } = usePrint();

  const [image, setImage] = useState<SourceImage | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [rotation, setRotation] = useState(0);
  const [fitMode, setFitMode] = useState<FitMode>('4x6');
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const [quality, setQuality] = useState<Quality>('sharp'); // default Barcode Sharp
  const [zoom, setZoom] = useState(100);
  const [sideways, setSideways] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setImage(null); setPreviewUrl(null); setRotation(0);
    setZoom(100); setSideways(false); setDragOver(false);
  }, []);
  const handleClose = () => { reset(); onClose(); };

  // ── Image input — store ORIGINAL full-resolution data URL (no downscale, no
  //    re-compression). Preview/print render from this source. ──
  const loadImageFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) { toast(t('printDesk.notAnImage'), 'warning'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      const img = new Image();
      img.onload = () => {
        setImage({ data: dataUrl, w: img.naturalWidth, h: img.naturalHeight });
        setRotation(0); setZoom(100);
        setSideways(img.naturalWidth > img.naturalHeight * 1.2);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file); // original bytes preserved (PNG paste stays PNG)
  }, [toast, t]);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = (e.target.files || [])[0];
    if (f) loadImageFile(f);
    e.target.value = '';
  };

  // Ctrl+V paste (document-level while open).
  useEffect(() => {
    if (!open) return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const f = items[i].getAsFile();
          if (f) { loadImageFile(f); e.preventDefault(); break; }
        }
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [open, loadImageFile]);

  // Preview render (reduced resolution for speed; reflects rotation + quality).
  useEffect(() => {
    if (!image) { setPreviewUrl(null); return; }
    let cancelled = false;
    void renderCanvas(image, rotation, { sharp: quality === 'sharp', maxDim: PREVIEW_MAX })
      .then((r) => { if (!cancelled) setPreviewUrl(r.url); });
    return () => { cancelled = true; };
  }, [image, rotation, quality]);

  // ── Rotation tools — all rotate the FULL-resolution source at print time ──
  const rotateLeft = () => setRotation((r) => (r + 270) % 360);
  const rotateRight = () => setRotation((r) => (r + 90) % 360);
  const flip180 = () => setRotation((r) => (r + 180) % 360);
  const resetRotation = () => setRotation(0);
  const autoRotate = () => { setRotation(90); setSideways(false); };

  // Output (printed) pixel dimensions = full-res source, swapped on 90/270.
  const outDims = useMemo(() => {
    if (!image) return null;
    const swap = rotation === 90 || rotation === 270;
    return { w: swap ? image.h : image.w, h: swap ? image.w : image.h };
  }, [image, rotation]);

  // ── Preview page frame (aspect from fit + orientation) ──
  const [aw, ah] = useMemo(() => {
    const base: [number, number] = fitMode === '4x6' ? [4, 6] : [8.5, 11];
    return orientation === 'landscape' ? [base[1], base[0]] : base;
  }, [fitMode, orientation]);
  const FRAME_W = 260;
  const frameW = (FRAME_W * zoom) / 100;
  const frameH = (frameW * ah) / aw;

  // ── Print — full-resolution PNG, contain + centered, no smoothing ──
  const handlePrint = async () => {
    if (!image) return;
    const sharp = quality === 'sharp';
    const b = await renderCanvas(image, rotation, { sharp }); // full resolution
    const pageCss = orientation === 'landscape'
      ? (fitMode === '4x6' ? '6in 4in' : '11in 8.5in')
      : (fitMode === '4x6' ? '4in 6in' : '8.5in 11in');
    // Fit: contain (no distort), centered. No blur/filter. crisp-edges in sharp.
    const imgRendering = sharp ? 'image-rendering: crisp-edges; image-rendering: -webkit-optimize-contrast;' : '';
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Print Desk</title>
<style>
  @page { size: ${pageCss}; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; }
  body { display: flex; align-items: center; justify-content: center; }
  img { max-width: 100%; max-height: 100%; width: auto; height: auto; object-fit: contain; display: block; ${imgRendering} }
  @media print { html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body><img src="${b.url}" /></body></html>`;
    printHtml(html, {
      silent: false,
      printer: settings.detectedPrinters?.[0],
      pageSize: fitMode === '4x6' ? '4x6' : 'letter',
      landscape: orientation === 'landscape',
    });
  };

  // ── styles ──
  const toolBtn = (active = false): React.CSSProperties => ({
    padding: '0.45rem 0.7rem', borderRadius: '0.5rem', border: '1px solid',
    borderColor: active ? 'rgba(99,102,241,0.6)' : 'rgba(255,255,255,0.12)',
    background: active ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.05)',
    color: active ? '#a5b4fc' : '#e2e8f0', fontSize: '0.82rem', fontWeight: 600,
    cursor: 'pointer',
  });
  const disabledBtn: React.CSSProperties = { opacity: 0.4, cursor: 'not-allowed' };

  return (
    <Modal open={open} onClose={handleClose} title={`🖨️ ${t('printDesk.title')}`} size="max-w-4xl">
      {/* Inputs */}
      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleUpload} />
        <button style={toolBtn()} onClick={() => fileRef.current?.click()}>⬆ {t('printDesk.upload')}</button>
        <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>{t('printDesk.pasteHint')}</span>
      </div>

      {/* Helper text — barcode guidance */}
      <div style={{ fontSize: '0.74rem', color: '#64748b', marginBottom: '0.75rem' }}>
        💡 {t('printDesk.barcodeHelp')}
      </div>

      {/* Sideways auto-detect helper */}
      {image && sideways && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.75rem',
          padding: '0.55rem 0.75rem', borderRadius: '0.5rem',
          background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)', color: '#fbbf24', fontSize: '0.82rem',
        }}>
          <span style={{ flex: 1 }}>↻ {t('printDesk.sidewaysHelper')}</span>
          <button style={{ ...toolBtn(), borderColor: 'rgba(245,158,11,0.5)' }} onClick={autoRotate}>{t('printDesk.rotateNow')}</button>
          <button style={toolBtn()} onClick={() => setSideways(false)}>{t('printDesk.dismiss')}</button>
        </div>
      )}

      {/* Preview area (drag-drop target + scroll/pan) */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault(); setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) loadImageFile(f);
        }}
        style={{
          position: 'relative', height: '44vh', minHeight: 260, overflow: 'auto',
          borderRadius: '0.75rem', border: `2px dashed ${dragOver ? '#6366f1' : 'rgba(148,163,184,0.25)'}`,
          background: 'rgba(2,6,23,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
        }}
      >
        {!image ? (
          <div style={{ textAlign: 'center', color: '#64748b', fontSize: '0.9rem' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🖼️</div>
            {t('printDesk.empty')}
          </div>
        ) : (
          <div style={{
            width: frameW, height: frameH, flexShrink: 0, background: '#fff',
            boxShadow: '0 6px 24px rgba(0,0,0,0.5)', borderRadius: 2,
            display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
          }}>
            {previewUrl && (
              <img
                src={previewUrl}
                alt="label"
                style={{
                  maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block',
                  imageRendering: quality === 'sharp' ? 'crisp-edges' : 'auto',
                }}
              />
            )}
          </div>
        )}
      </div>

      {/* Source vs print dimensions */}
      {image && outDims && (
        <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.45rem', textAlign: 'right' }}>
          {t('printDesk.source')}: {image.w}×{image.h} · {t('printDesk.output')}: {outDims.w}×{outDims.h} PNG
          {quality === 'sharp' ? ` · ${t('printDesk.barcodeSharp')}` : ''}
        </div>
      )}

      {/* Zoom */}
      {image && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.4rem', justifyContent: 'flex-end' }}>
          <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>{t('printDesk.zoom')}</span>
          <button style={toolBtn()} onClick={() => setZoom((z) => Math.max(25, z - 25))}>−</button>
          <span style={{ fontSize: '0.82rem', color: '#e2e8f0', width: 44, textAlign: 'center' }}>{zoom}%</span>
          <button style={toolBtn()} onClick={() => setZoom((z) => Math.min(300, z + 25))}>+</button>
        </div>
      )}

      {/* Rotation tools */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.85rem' }}>
        <button style={image ? toolBtn() : { ...toolBtn(), ...disabledBtn }} disabled={!image} onClick={rotateLeft}>↺ {t('printDesk.rotateLeft')}</button>
        <button style={image ? toolBtn() : { ...toolBtn(), ...disabledBtn }} disabled={!image} onClick={rotateRight}>↻ {t('printDesk.rotateRight')}</button>
        <button style={image ? toolBtn() : { ...toolBtn(), ...disabledBtn }} disabled={!image} onClick={flip180}>⤢ {t('printDesk.flip')}</button>
        <button style={image ? toolBtn() : { ...toolBtn(), ...disabledBtn }} disabled={!image} onClick={resetRotation}>{t('printDesk.reset')}</button>
        <button style={image ? toolBtn() : { ...toolBtn(), ...disabledBtn }} disabled={!image} onClick={autoRotate}>✨ {t('printDesk.autoRotate')}</button>
      </div>

      {/* Fit + orientation */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.6rem', alignItems: 'center' }}>
        <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>{t('printDesk.fit')}:</span>
        <button style={toolBtn(fitMode === '4x6')} onClick={() => setFitMode('4x6')}>{t('printDesk.fit4x6')}</button>
        <button style={toolBtn(fitMode === 'letter')} onClick={() => setFitMode('letter')}>{t('printDesk.fitLetter')}</button>
        <span style={{ width: 8 }} />
        <button style={toolBtn(orientation === 'portrait')} onClick={() => setOrientation('portrait')}>{t('printDesk.portrait')}</button>
        <button style={toolBtn(orientation === 'landscape')} onClick={() => setOrientation('landscape')}>{t('printDesk.landscape')}</button>
      </div>

      {/* Print quality (Barcode Quality Mode) */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.6rem', alignItems: 'center' }}>
        <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>{t('printDesk.quality')}:</span>
        <button style={toolBtn(quality === 'standard')} onClick={() => setQuality('standard')}>{t('printDesk.standard')}</button>
        <button style={toolBtn(quality === 'sharp')} onClick={() => setQuality('sharp')}>🏷️ {t('printDesk.barcodeSharp')}</button>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.1rem' }}>
        <button className="btn btn-secondary" style={{ flex: 1 }} onClick={image ? reset : handleClose}>
          {image ? t('printDesk.clear') : t('close')}
        </button>
        <button className="btn btn-primary" style={{ flex: 2, opacity: image ? 1 : 0.5 }} disabled={!image} onClick={handlePrint}>
          🖨️ {t('print')}
        </button>
      </div>
    </Modal>
  );
}
