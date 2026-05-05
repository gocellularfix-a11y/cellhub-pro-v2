// ============================================================
// CellHub Pro — Print Preview Modal
// Internal print UI: live PDF preview, printer picker, scale,
// margins, zoom. No dependency on Chrome or Windows print dialog.
// ============================================================

import { useState, useEffect } from 'react';
import { useTranslation } from '@/i18n';

// ── Page size presets (width × height in microns) ───────────
const PAGE_SIZES: Record<string, { label: string; width: number; height: number }> = {
  '4x6':    { label: '4×6 (Receipt)',    width: 101600, height: 152400 },
  '80mm':   { label: '80mm Thermal',     width: 80000,  height: 297000 },
  'letter': { label: 'Letter (8.5×11)',  width: 215900, height: 279400 },
  'legal':  { label: 'Legal (8.5×14)',   width: 215900, height: 355600 },
  'a4':     { label: 'A4',              width: 210000, height: 297000 },
  'label':  { label: 'Label (2.25×1.25)', width: 57150, height: 31750 },
};

interface PrintPreviewModalProps {
  open: boolean;
  html: string;
  onClose: () => void;
  /** Optional initial page size key */
  initialPageSize?: string;
  /** r-print-contract: caller-provided defaults from usePrint options.
   *  These seed the modal state but the user can still change anything. */
  initialPrinter?: string;
  initialCopies?: number;
  initialLandscape?: boolean;
}

interface PrinterInfo {
  name: string;
  displayName?: string;
  isDefault: boolean;
  status: number;
}

export default function PrintPreviewModal({
  open,
  html,
  onClose,
  initialPageSize,
  initialPrinter,
  initialCopies,
  initialLandscape,
}: PrintPreviewModalProps) {
  const { t } = useTranslation();
  // ── State ─────────────────────────────────────────────────
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState(() => {
    try { return localStorage.getItem('cellhub_lastPrinter') || initialPrinter || ''; }
    catch { return initialPrinter || ''; }
  });
  const [pageSize, setPageSize] = useState(initialPageSize || '4x6');
  const [landscape, setLandscape] = useState(initialLandscape || false);
  const [scaleFactor, setScaleFactor] = useState(100);
  // R-PRINT-SHRINK-TO-FIT: default ON — auto-shrinks oversized content to fit page width.
  const [shrinkToFit, setShrinkToFit] = useState(true);
  const [margins, setMargins] = useState({ top: 0, bottom: 0, left: 0, right: 0 });
  const [zoom, setZoom] = useState(100);
  const [copies, setCopies] = useState(initialCopies || 1);

  const [printing, setPrinting] = useState(false);
  const [printResult, setPrintResult] = useState<string | null>(null);

  // ── Load printers on open ─────────────────────────────────
  useEffect(() => {
    if (!open) return;
    if (!window.electronAPI?.getPrinters) return;
    window.electronAPI.getPrinters().then((list) => {
      setPrinters(list || []);
      const saved = (() => { try { return localStorage.getItem('cellhub_lastPrinter') || ''; } catch { return ''; } })();
      if (initialPrinter && list?.some((p) => p.name === initialPrinter)) {
        setSelectedPrinter(initialPrinter);
      } else if (saved && list?.some((p) => p.name === saved)) {
        setSelectedPrinter(saved);
      } else if (!selectedPrinter) {
        const def = list.find((p) => p.isDefault) || list[0];
        if (def) setSelectedPrinter(def.name);
      }
    }).catch(() => {});
  }, [open, html]);


  // ── Print ─────────────────────────────────────────────────
  const handlePrint = async () => {
    if (!window.electronAPI?.printRun || !selectedPrinter) return;
    try { localStorage.setItem('cellhub_lastPrinter', selectedPrinter); } catch {}
    setPrinting(true);
    setPrintResult(null);
    try {
      const ps = PAGE_SIZES[pageSize] || PAGE_SIZES['4x6'];
      const result = await window.electronAPI.printRun({
        html: scaledHtml,
        deviceName: selectedPrinter,
        pageSize: { width: ps.width, height: ps.height },
        landscape,
        scaleFactor: 100,
        copies,
        margins,
      });
      if (result.success) {
        setPrintResult('✅ Sent to printer');
        setTimeout(() => onClose(), 1200);
      } else {
        setPrintResult(`❌ ${result.error || 'Print failed'}`);
      }
    } catch (err: any) {
      setPrintResult(`❌ ${err.message || 'Print failed'}`);
    } finally {
      setPrinting(false);
    }
  };

  // ── Margin input helper ───────────────────────────────────
  const setMargin = (side: 'top' | 'bottom' | 'left' | 'right', value: number) => {
    setMargins((prev) => ({ ...prev, [side]: Math.max(0, value) }));
  };

  if (!open) return null;

  const ps = PAGE_SIZES[pageSize] || PAGE_SIZES['4x6'];

  // R-PRINT-SHRINK-FALLBACK-FIX: predictable page-size-based shrink.
  // Replaces the DOM-measurement helper, which couldn't see inside the
  // sandboxed iframe and effectively returned 100 on every flow.
  const effectiveScale = shrinkToFit
    ? (pageSize === 'letter' ? 90 : 95)
    : scaleFactor;

  const scaledHtml = effectiveScale === 100
    ? html
    : html.replace(/<body([^>]*)>/i, `<body$1 style="transform: scale(${effectiveScale / 100}); transform-origin: center center;">`);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: '92vw', maxWidth: '1300px', height: '88vh',
        background: '#0f172a', borderRadius: '1rem',
        border: '1px solid rgba(255,255,255,0.1)',
        display: 'flex', overflow: 'hidden',
        boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
      }}>

        {/* ── Sidebar Controls ─────────────────────────────── */}
        <div style={{
          width: '280px', flexShrink: 0, padding: '1.25rem',
          borderRight: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', flexDirection: 'column', gap: '1rem',
          overflowY: 'auto',
        }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#fff', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            🖨️ Print
          </h2>

          {/* Printer */}
          <Field label="Printer">
            <select
              value={selectedPrinter}
              onChange={(e) => setSelectedPrinter(e.target.value)}
              style={selectStyle}
            >
              {printers.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.displayName || p.name}{p.isDefault ? ' ★' : ''}
                </option>
              ))}
              {printers.length === 0 && <option value="">{t('print.noPrintersFound')}</option>}
            </select>
          </Field>

          {/* Page Size */}
          <Field label="Page Size">
            <select value={pageSize} onChange={(e) => setPageSize(e.target.value)} style={selectStyle}>
              {Object.entries(PAGE_SIZES).map(([key, val]) => (
                <option key={key} value={key}>{val.label}</option>
              ))}
            </select>
          </Field>

          {/* Orientation */}
          <Field label="Orientation">
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#cbd5e1', fontSize: '0.85rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={landscape} onChange={(e) => setLandscape(e.target.checked)}
                style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
              Landscape
            </label>
          </Field>

          {/* Scale */}
          <Field label="Print Scale">
            {/* R-PRINT-SHRINK-TO-FIT: toggle disables manual scale and uses calculateAutoScale() */}
            <label
              title="Auto adjusts to fit page width"
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#cbd5e1', fontSize: '0.8rem', cursor: 'pointer', marginBottom: '0.4rem' }}
            >
              <input
                type="checkbox"
                checked={shrinkToFit}
                onChange={(e) => setShrinkToFit(e.target.checked)}
                style={{ width: '15px', height: '15px', cursor: 'pointer' }}
              />
              Shrink to fit page
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', opacity: shrinkToFit ? 0.5 : 1 }}>
              <input
                type="number"
                min={25}
                max={200}
                step={1}
                value={shrinkToFit ? effectiveScale : scaleFactor}
                disabled={shrinkToFit}
                title={shrinkToFit ? 'Auto adjusts to fit page width' : ''}
                onChange={(e) => setScaleFactor(Math.min(200, Math.max(25, parseFloat(e.target.value) || 100)))}
                style={{ ...inputStyle, width: '60px', textAlign: 'right', cursor: shrinkToFit ? 'not-allowed' : 'text' }}
              />
              <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>%</span>
              <input
                type="range"
                min={25}
                max={200}
                step={5}
                value={shrinkToFit ? effectiveScale : scaleFactor}
                disabled={shrinkToFit}
                title={shrinkToFit ? 'Auto adjusts to fit page width' : ''}
                onChange={(e) => setScaleFactor(Number(e.target.value))}
                style={{ flex: 1, cursor: shrinkToFit ? 'not-allowed' : 'pointer' }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#64748b' }}>
              <span>25%</span><span>100%</span><span>200%</span>
            </div>
          </Field>

          {/* Margins */}
          <Field label="Margins (inches)">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
              {(['top', 'bottom', 'left', 'right'] as const).map((side) => (
                <div key={side} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <span style={{ fontSize: '0.7rem', color: '#94a3b8', width: '2.5rem', textTransform: 'capitalize' }}>{side}</span>
                  <input type="number" step={0.05} min={0} max={2}
                    value={margins[side]}
                    onChange={(e) => setMargin(side, parseFloat(e.target.value) || 0)}
                    style={{ ...inputStyle, width: '100%' }} />
                </div>
              ))}
            </div>
          </Field>

          {/* Copies */}
          <Field label="Copies">
            <input type="number" min={1} max={99} value={copies}
              onChange={(e) => setCopies(Math.max(1, Number(e.target.value) || 1))}
              style={inputStyle} />
          </Field>

          {/* Preview Zoom */}
          <Field label={`Preview Zoom: ${zoom}%`}>
            <input type="range" min={25} max={300} step={5} value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              style={{ width: '100%', cursor: 'pointer' }} />
          </Field>

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Print result */}
          {printResult && (
            <div style={{
              padding: '0.5rem 0.75rem', borderRadius: '0.5rem', fontSize: '0.85rem', fontWeight: 600,
              background: printResult.startsWith('✅') ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
              color: printResult.startsWith('✅') ? '#22c55e' : '#ef4444',
              textAlign: 'center',
            }}>
              {printResult}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={onClose} style={{
              flex: 1, padding: '0.65rem', borderRadius: '0.5rem', border: '1px solid rgba(255,255,255,0.15)',
              background: 'rgba(255,255,255,0.05)', color: '#94a3b8', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600,
            }}>
              Cancel
            </button>
            <button onClick={handlePrint} disabled={printing || !selectedPrinter} style={{
              flex: 2, padding: '0.65rem', borderRadius: '0.5rem', border: 'none',
              background: printing ? '#334155' : '#3b82f6', color: '#fff', cursor: printing ? 'wait' : 'pointer',
              fontSize: '0.9rem', fontWeight: 700, opacity: !selectedPrinter ? 0.5 : 1,
            }}>
              {printing ? '⏳ Printing...' : `🖨️ Print${copies > 1 ? ` (×${copies})` : ''}`}
            </button>
          </div>
        </div>

        {/* ── Preview Area ─────────────────────────────────── */}
        <div style={{
          flex: 1, background: '#1e293b', display: 'flex',
          alignItems: 'flex-start', justifyContent: 'center',
          overflow: 'auto', padding: '1.5rem',
          position: 'relative',
        }}>
          {/* Close button */}
          <button onClick={onClose} style={{
            position: 'absolute', top: '0.75rem', right: '0.75rem', zIndex: 10,
            width: '32px', height: '32px', borderRadius: '50%',
            background: 'rgba(255,255,255,0.1)', border: 'none', color: '#94a3b8',
            cursor: 'pointer', fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>×</button>

          {/* r-print-preview-iframe-foundation: direct HTML render via iframe srcDoc.
              This is the same pattern used in ReceiptModal (r-receipt-unify) which
              works reliably in Electron 31 sandbox. No PDF intermediate. */}
          <div
            id="print-content"
            style={{
              transform: `scale(${zoom / 100})`,
              transformOrigin: 'top center',
              transition: 'transform 0.15s ease',
            }}
          >
            <iframe
              srcDoc={scaledHtml}
              title="Print preview"
              sandbox=""
              style={{
                width: landscape ? `${ps.height / 25400}in` : `${ps.width / 25400}in`,
                height: landscape ? `${ps.width / 25400}in` : `${ps.height / 25400}in`,
                minWidth: '300px',
                minHeight: '400px',
                background: '#fff',
                border: 'none',
                borderRadius: '4px',
                boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
                display: 'block',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Shared styles ───────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.3rem', fontWeight: 600 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  width: '100%', padding: '0.5rem', fontSize: '0.85rem',
  background: '#1e293b', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: '0.4rem', cursor: 'pointer', outline: 'none',
};

const inputStyle: React.CSSProperties = {
  padding: '0.4rem 0.5rem', fontSize: '0.85rem',
  background: '#1e293b', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: '0.4rem', outline: 'none',
};
