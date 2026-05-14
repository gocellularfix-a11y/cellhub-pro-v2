import { useState, useMemo } from 'react';
import type { LabelJob, Product, ProductAdapter, TemplateId } from './types';
import { useLabelHistory } from './hooks/useLabelHistory';
import { usePrintLabel } from './hooks/usePrintLabel';
import { useCustomLabel } from './hooks/useCustomLabel';
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
  const { print, printCustom, isPrinting, printPortal } = usePrintLabel(addJob);
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

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Price Labels</h1>
          <p className="text-sm text-gray-500 mt-0.5">Design and print product labels</p>
        </div>

        {/* Tab switcher */}
        <div className="flex bg-gray-100 rounded-xl p-1 gap-1">
          {(['product', 'custom', 'history'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 text-sm font-semibold rounded-lg transition-colors ${
                tab === t
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      {/* ── Product Label tab ─────────────────────────────────────────────── */}
      {tab === 'product' && (
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Left panel */}
          <div className="flex-shrink-0 w-full lg:w-72 space-y-5">
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-5">
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
              <p className="text-xs text-center text-gray-400">Select a product to enable printing</p>
            )}
          </div>

          {/* Right panel — live preview */}
          <div className="flex-1 bg-white rounded-2xl border border-gray-200 shadow-sm p-6 flex flex-col items-center justify-center gap-4">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide self-start">
              Preview
            </h2>
            <LabelPreview product={selectedProduct} templateId={selectedTemplate} />
            {selectedProduct && (
              <p className="text-xs text-gray-400">
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
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
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

            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
              <CopiesInput value={customCopies} onChange={setCustomCopies} />
            </div>

            <PrintButton
              copies={customCopies}
              disabled={customLabel.config.elements.length === 0}
              isPrinting={isPrinting}
              onClick={handleCustomPrint}
            />
            {customLabel.config.elements.length === 0 && (
              <p className="text-xs text-center text-gray-400">
                Add at least one element to print
              </p>
            )}
          </div>

          {/* Right panel — interactive canvas */}
          <div className="flex-1 bg-white rounded-2xl border border-gray-200 shadow-sm p-6 flex flex-col items-center justify-center gap-2">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide self-start mb-2">
              Canvas
            </h2>
            <EditorCanvas
              config={customLabel.config}
              selectedId={customLabel.selectedId}
              onSelect={customLabel.setSelectedId}
              onMove={customLabel.moveElement}
              onUpdate={customLabel.updateElement}
              onPasteText={customLabel.addTextWithValue}
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
  );
}
