import { useState, useMemo, useEffect } from 'react';
import type { LabelJob, Product, ProductAdapter, TemplateId } from './types';
import { useLabelHistory } from './hooks/useLabelHistory';
import { usePrintLabel } from './hooks/usePrintLabel';
import { useCustomLabel } from './hooks/useCustomLabel';
// LABEL-STUDIO-DIRECT-PRINT-AND-DYMO-LIKE-TEXT-V1: per-station label printer
// selection (localStorage) feeding the direct Electron print path.
import { readLabelPrinter, saveLabelPrinter } from './services/printService';
import { MockProductAdapter } from './mock/products';
import { ProductSelector } from './components/ProductSelector';
import { TemplateSelector } from './components/TemplateSelector';
import { CopiesInput } from './components/CopiesInput';
import { LabelPreview } from './components/LabelPreview';
import { PrintButton } from './components/PrintButton';
import { JobHistoryPanel } from './components/JobHistory/JobHistoryPanel';
import { EditorCanvas } from './components/editor/EditorCanvas';
import { ElementToolbar } from './components/editor/ElementToolbar';
import { ElementPropertiesPanel } from './components/editor/ElementPropertiesPanel';

type Tab = 'product' | 'custom' | 'history';

interface PriceLabelsProps {
  /** Pass a real adapter (e.g. CellHubProductAdapter) for production. Defaults to MockProductAdapter. */
  adapter?: ProductAdapter;
}

const TAB_ICONS: Record<Tab, string> = {
  product: '🏷',
  custom: '✏',
  history: '🕒',
};

export function PriceLabels({ adapter: adapterProp }: PriceLabelsProps = {}) {
  const [tab, setTab] = useState<Tab>('product');
  // Product-label state
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateId>('barcode-label');
  const [productCopies, setProductCopies] = useState(1);
  // Custom-label copies (kept separate so switching tabs doesn't reset the other)
  const [customCopies, setCustomCopies] = useState(1);

  const adapter = useMemo(() => adapterProp ?? new MockProductAdapter(), [adapterProp]);
  const { jobs, addJob, deleteJob, clearAll } = useLabelHistory();

  // LABEL-STUDIO-DIRECT-PRINT-AND-DYMO-LIKE-TEXT-V1: label printer profile.
  // Electron → list printers + remember the chosen one per station; first
  // run auto-selects a DYMO/label-named device when present. Browser dev →
  // no bridge, prints fall back to the dev dialog (clearly labeled below).
  const isElectron = typeof window !== 'undefined' && !!window.electronAPI?.printRun;
  const [printers, setPrinters] = useState<string[]>([]);
  const [labelPrinter, setLabelPrinter] = useState<string>(() => readLabelPrinter());
  useEffect(() => {
    if (!window.electronAPI?.getPrinters) return;
    window.electronAPI.getPrinters().then(list => {
      const names = list.map(p => p.name);
      setPrinters(names);
      setLabelPrinter(prev => {
        if (prev && names.includes(prev)) return prev;
        const guess = names.find(n => /dymo|label/i.test(n)) || '';
        if (guess) saveLabelPrinter(guess);
        return guess;
      });
    }).catch(() => {});
  }, []);
  function handlePrinterChange(name: string) {
    setLabelPrinter(name);
    saveLabelPrinter(name);
  }

  const { print, printCustom, isPrinting, printPortal } = usePrintLabel(addJob, labelPrinter);
  const customLabel = useCustomLabel();

  // ── Product tab handlers ──────────────────────────────────────────────────
  function handleProductPrint() {
    if (!selectedProduct) return;
    print(selectedProduct, selectedTemplate, productCopies);
  }

  // ── Custom tab handlers ───────────────────────────────────────────────────
  function handleCustomPrint() {
    if (customLabel.config.elements.length === 0) return;
    printCustom(customLabel.config, customCopies);
  }

  // ── History handlers ──────────────────────────────────────────────────────
  function handleReprintJob(job: LabelJob) {
    if (job.isCustom && job.customLabel) {
      printCustom(job.customLabel, job.copies);
    } else if (job.product && job.templateId) {
      print(job.product, job.templateId, job.copies);
    }
  }

  function handleEditJob(job: LabelJob) {
    if (job.isCustom && job.customLabel) {
      customLabel.loadConfig(job.customLabel);
      setCustomCopies(job.copies);
      setTab('custom');
    } else if (job.product && job.templateId) {
      setSelectedProduct(job.product);
      setSelectedTemplate(job.templateId);
      setProductCopies(job.copies);
      setTab('product');
    }
  }

  // ── Tab labels ────────────────────────────────────────────────────────────
  const TAB_LABELS: Record<Tab, string> = {
    product: 'Product Label',
    custom: 'Custom Label',
    history: jobs.length > 0 ? `History (${jobs.length})` : 'History',
  };

  const cardStyle: React.CSSProperties = {
    background: 'linear-gradient(160deg, #0e1525 0%, #0b1120 100%)',
    border: '1px solid rgba(148,163,184,0.10)',
    borderRadius: '14px',
  };

  const sectionLabelStyle: React.CSSProperties = {
    fontSize: '0.625rem',
    fontWeight: 600,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    alignSelf: 'flex-start',
    marginBottom: '0.5rem',
  };

  return (
    <div
      style={{
        background: '#080d18',
        minHeight: '100vh',
        padding: '1.5rem 1rem 4rem',
      }}
    >
      <div className="max-w-5xl mx-auto">
        {/* Page header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '1.5rem',
            flexWrap: 'wrap',
            gap: '1rem',
          }}
        >
          <div>
            <h1
              style={{
                fontSize: '1.5rem',
                fontWeight: 800,
                color: '#e2e8f0',
                margin: 0,
                lineHeight: 1.2,
              }}
            >
              🏷 Label Studio
            </h1>
            <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '0.2rem 0 0' }}>
              Design and print product labels
            </p>
            {/* LABEL-STUDIO-DIRECT-PRINT-AND-DYMO-LIKE-TEXT-V1: per-station
                label printer. Selected device receives silent direct prints
                (no Chrome/Windows dialog). */}
            {isElectron ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.5rem' }}>
                <span style={{ fontSize: '0.72rem', color: '#64748b' }}>🖨</span>
                <select
                  value={labelPrinter}
                  onChange={e => handlePrinterChange(e.target.value)}
                  style={{
                    background: '#0a1120',
                    border: '1px solid rgba(148,163,184,0.15)',
                    color: labelPrinter ? '#e2e8f0' : '#f59e0b',
                    borderRadius: '8px',
                    padding: '0.25rem 0.5rem',
                    fontSize: '0.72rem',
                    outline: 'none',
                    maxWidth: '16rem',
                  }}
                >
                  <option value="">— select label printer —</option>
                  {printers.map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
                {!labelPrinter && (
                  <span style={{ fontSize: '0.68rem', color: '#f59e0b' }}>
                    no printer → preview opens instead
                  </span>
                )}
              </div>
            ) : (
              <p style={{ fontSize: '0.68rem', color: '#f59e0b', margin: '0.35rem 0 0' }}>
                Browser dev mode — direct printing needs the Electron app
              </p>
            )}
          </div>

          {/* Tab switcher */}
          <div
            style={{
              display: 'flex',
              background: 'rgba(15,23,42,0.6)',
              border: '1px solid rgba(148,163,184,0.12)',
              borderRadius: '12px',
              padding: '4px',
              gap: '2px',
            }}
          >
            {(['product', 'custom', 'history'] as Tab[]).map(t => {
              const isActive = tab === t;
              return (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  style={{
                    padding: '0.375rem 0.875rem',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    borderRadius: '8px',
                    border: isActive ? '1px solid rgba(56,189,248,0.25)' : '1px solid transparent',
                    background: isActive ? 'rgba(56,189,248,0.1)' : 'transparent',
                    color: isActive ? '#38bdf8' : '#64748b',
                    cursor: 'pointer',
                    transition: 'all 0.12s ease',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span>{TAB_ICONS[t]}</span>
                  {TAB_LABELS[t]}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Product Label tab ─────────────────────────────────────────────── */}
        {tab === 'product' && (
          <div className="flex flex-col lg:flex-row gap-6">
            {/* Left panel */}
            <div className="flex-shrink-0 w-full lg:w-72 space-y-4">
              <div style={{ ...cardStyle, padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <ProductSelector
                  adapter={adapter}
                  value={selectedProduct}
                  onChange={setSelectedProduct}
                />
                <TemplateSelector value={selectedTemplate} onChange={setSelectedTemplate} />
                <CopiesInput value={productCopies} onChange={setProductCopies} />
              </div>
              <PrintButton
                copies={productCopies}
                disabled={!selectedProduct}
                isPrinting={isPrinting}
                onClick={handleProductPrint}
              />
              {!selectedProduct && (
                <p style={{ fontSize: '0.72rem', textAlign: 'center', color: '#475569' }}>
                  Select a product to enable printing
                </p>
              )}
            </div>

            {/* Right panel — live preview */}
            <div
              style={{
                ...cardStyle,
                flex: 1,
                padding: '1.5rem',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '1rem',
              }}
            >
              <span style={sectionLabelStyle}>Preview</span>
              <LabelPreview product={selectedProduct} templateId={selectedTemplate} />
              {selectedProduct && (
                <p style={{ fontSize: '0.72rem', color: '#475569' }}>
                  Scaled for display — prints at actual label dimensions
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── Custom Label tab ──────────────────────────────────────────────── */}
        {tab === 'custom' && (
          <div className="flex flex-col lg:flex-row gap-6">
            {/* Left panel — toolbox */}
            <div className="flex-shrink-0 w-full lg:w-64 space-y-4">
              <div style={{ ...cardStyle, padding: '1rem' }}>
                <ElementToolbar
                  widthMm={customLabel.config.widthMm}
                  heightMm={customLabel.config.heightMm}
                  onAddText={customLabel.addText}
                  onAddBarcode={customLabel.addBarcode}
                  onAddQR={customLabel.addQR}
                  onSizeChange={customLabel.setLabelSize}
                  onClear={customLabel.clearCanvas}
                  onPasteText={customLabel.addTextWithValue}
                />
              </div>

              <ElementPropertiesPanel
                element={customLabel.selectedElement}
                onUpdate={customLabel.updateElement}
                onDelete={customLabel.deleteElement}
              />

              <div style={{ ...cardStyle, padding: '1rem' }}>
                <CopiesInput value={customCopies} onChange={setCustomCopies} />
              </div>

              <PrintButton
                copies={customCopies}
                disabled={customLabel.config.elements.length === 0}
                isPrinting={isPrinting}
                onClick={handleCustomPrint}
              />
              {customLabel.config.elements.length === 0 && (
                <p style={{ fontSize: '0.72rem', textAlign: 'center', color: '#475569' }}>
                  Add at least one element to print
                </p>
              )}
            </div>

            {/* Right panel — interactive canvas */}
            <div
              style={{
                ...cardStyle,
                flex: 1,
                padding: '1.5rem',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
              }}
            >
              <span style={sectionLabelStyle}>Canvas</span>
              <EditorCanvas
                config={customLabel.config}
                selectedId={customLabel.selectedId}
                onSelect={customLabel.setSelectedId}
                onMove={customLabel.moveElement}
                onUpdate={customLabel.updateElement}
                onPasteText={customLabel.addTextWithValue}
                onDelete={customLabel.deleteElement}
              />
            </div>
          </div>
        )}

        {/* ── History tab ───────────────────────────────────────────────────── */}
        {tab === 'history' && (
          <JobHistoryPanel
            jobs={jobs}
            onReprint={handleReprintJob}
            onEdit={handleEditJob}
            onDelete={deleteJob}
            onClearAll={clearAll}
          />
        )}

        {/* React portal for browser print — outside visible layout */}
        {printPortal}
      </div>
    </div>
  );
}
