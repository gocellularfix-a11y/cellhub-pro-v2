import { useState, useCallback, useEffect, useRef, createElement } from 'react';
import { createPortal } from 'react-dom';
import type { CustomLabelConfig, LabelJob, Product, TemplateId } from '../types';
import { TEMPLATE_REGISTRY } from '../templates';
import { getPrintContainer, printLabelDirect } from '../services/printService';
import { PrintWrapper } from '../components/PrintWrapper';
import { deriveBarcodeValue } from '../utils';
import { v4 as uuidv4 } from 'uuid';

type PrintState =
  | { kind: 'product'; product: Product; templateId: TemplateId; copies: number }
  | { kind: 'custom'; customLabel: CustomLabelConfig; copies: number };

/**
 * LABEL-STUDIO-DIRECT-PRINT-AND-DYMO-LIKE-TEXT-V1 — print pipeline.
 *
 * BEFORE: portal render → window.print() → Chrome/Windows dialog printed the
 * whole document relying on @media print visibility rules.
 *
 * NOW: the portal still renders the label offscreen (JsBarcode SVGs and QR
 * data-URLs paint for real), but after the ready-wait we CAPTURE the portal's
 * innerHTML and send it through the existing Electron print bridge
 * (printLabelDirect → openPrintWindow → printRun) with the exact label mm
 * page size. Silent to the selected label printer — no native dialog.
 * Browser dev mode falls back to a window.open print (dev-only).
 *
 * Job history is recorded after the print call resolves (the old `afterprint`
 * listener never fires on the Electron silent path).
 */
export function usePrintLabel(onJobCreated: (job: LabelJob) => void, printerName: string) {
  const [printState, setPrintState] = useState<PrintState | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);

  // Stable refs — the ready callback always reads the latest values
  const onJobCreatedRef = useRef(onJobCreated);
  useEffect(() => { onJobCreatedRef.current = onJobCreated; });
  const printerRef = useRef(printerName);
  useEffect(() => { printerRef.current = printerName; });
  const printStateRef = useRef(printState);
  useEffect(() => { printStateRef.current = printState; });

  const print = useCallback((product: Product, templateId: TemplateId, copies: number) => {
    setPrintState({ kind: 'product', product, templateId, copies });
    setIsPrinting(true);
  }, []);

  const printCustom = useCallback((customLabel: CustomLabelConfig, copies: number) => {
    setPrintState({ kind: 'custom', customLabel, copies });
    setIsPrinting(true);
  }, []);

  // Called by PrintWrapper after barcodes/QRs have painted in the portal.
  const handlePrintReady = useCallback(async () => {
    const state = printStateRef.current;
    const container = getPrintContainer();
    const inner = container?.innerHTML || '';
    if (!state || !inner) {
      setPrintState(null);
      setIsPrinting(false);
      return;
    }

    // Label dimensions: template registry for product labels, the canvas
    // config for custom labels (default 89×36mm — 3.5×1.4in).
    const dims = state.kind === 'product'
      ? TEMPLATE_REGISTRY[state.templateId]
      : state.customLabel;

    try {
      await printLabelDirect(inner, dims.widthMm, dims.heightMm, printerRef.current);
    } catch (err) {
      console.error('[priceLabels] direct label print failed:', err);
    }

    // Record the job (history) after dispatch — success or printer error,
    // the attempt is part of the operator's history either way.
    let job: LabelJob;
    if (state.kind === 'product') {
      const template = TEMPLATE_REGISTRY[state.templateId];
      job = {
        id: uuidv4(),
        createdAt: new Date().toISOString(),
        product: { ...state.product },
        templateId: state.templateId,
        templateName: template.name,
        copies: state.copies,
        barcodeValue: deriveBarcodeValue(state.product),
      };
    } else {
      job = {
        id: uuidv4(),
        createdAt: new Date().toISOString(),
        templateName: 'Custom Label',
        copies: state.copies,
        barcodeValue: '',
        isCustom: true,
        customLabel: state.customLabel,
      };
    }
    onJobCreatedRef.current(job);
    setPrintState(null);
    setIsPrinting(false);
  }, []);

  const printContainer = getPrintContainer();

  let portalChild: ReturnType<typeof createElement> | null = null;
  if (printState && printContainer) {
    if (printState.kind === 'product') {
      portalChild = createElement(PrintWrapper, {
        kind: 'product' as const,
        product: printState.product,
        templateId: printState.templateId,
        copies: printState.copies,
        onReady: handlePrintReady,
      });
    } else {
      portalChild = createElement(PrintWrapper, {
        kind: 'custom' as const,
        customLabel: printState.customLabel,
        copies: printState.copies,
        onReady: handlePrintReady,
      });
    }
  }

  const printPortal =
    portalChild && printContainer ? createPortal(portalChild, printContainer) : null;

  return { print, printCustom, isPrinting, printPortal };
}
