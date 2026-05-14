import { useState, useCallback, useEffect, useRef, createElement } from 'react';
import { createPortal } from 'react-dom';
import type { CustomLabelConfig, LabelJob, Product, TemplateId } from '../types';
import { TEMPLATE_REGISTRY } from '../templates';
import { getPrintContainer, triggerBrowserPrint } from '../services/printService';
import { PrintWrapper } from '../components/PrintWrapper';
import { deriveBarcodeValue } from '../utils';
import { v4 as uuidv4 } from 'uuid';

type PrintState =
  | { kind: 'product'; product: Product; templateId: TemplateId; copies: number }
  | { kind: 'custom'; customLabel: CustomLabelConfig; copies: number };

export function usePrintLabel(onJobCreated: (job: LabelJob) => void) {
  const [printState, setPrintState] = useState<PrintState | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);

  // Stable callback ref — never triggers re-registration of afterprint listener
  const onJobCreatedRef = useRef(onJobCreated);
  useEffect(() => { onJobCreatedRef.current = onJobCreated; });

  const print = useCallback((product: Product, templateId: TemplateId, copies: number) => {
    setPrintState({ kind: 'product', product, templateId, copies });
    setIsPrinting(true);
  }, []);

  const printCustom = useCallback((customLabel: CustomLabelConfig, copies: number) => {
    setPrintState({ kind: 'custom', customLabel, copies });
    setIsPrinting(true);
  }, []);

  const handlePrintReady = useCallback(() => {
    triggerBrowserPrint();
  }, []);

  // afterprint fires after the native dialog is dismissed (print or cancel)
  useEffect(() => {
    if (!isPrinting || !printState) return;

    const handler = () => {
      let job: LabelJob;
      if (printState.kind === 'product') {
        const template = TEMPLATE_REGISTRY[printState.templateId];
        job = {
          id: uuidv4(),
          createdAt: new Date().toISOString(),
          product: { ...printState.product },
          templateId: printState.templateId,
          templateName: template.name,
          copies: printState.copies,
          barcodeValue: deriveBarcodeValue(printState.product),
        };
      } else {
        job = {
          id: uuidv4(),
          createdAt: new Date().toISOString(),
          templateName: 'Custom Label',
          copies: printState.copies,
          barcodeValue: '',
          isCustom: true,
          customLabel: printState.customLabel,
        };
      }
      onJobCreatedRef.current(job);
      setPrintState(null);
      setIsPrinting(false);
    };

    window.addEventListener('afterprint', handler, { once: true });
    return () => window.removeEventListener('afterprint', handler);
  }, [isPrinting, printState]);

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
