import { useEffect } from 'react';
import type { CustomLabelConfig, Product, TemplateId } from '../types';
import { TEMPLATE_REGISTRY } from '../templates';
import { CustomLabelTemplate } from '../templates/CustomLabelTemplate';

type PrintWrapperProps =
  | {
      kind: 'product';
      product: Product;
      templateId: TemplateId;
      copies: number;
      onReady: () => void;
    }
  | {
      kind: 'custom';
      customLabel: CustomLabelConfig;
      copies: number;
      onReady: () => void;
    };

/**
 * Renders N copies inside #price-label-print-root.
 * Waits 250ms for JsBarcode SVGs and QR data-URL images to paint
 * before calling onReady → window.print().
 */
export function PrintWrapper(props: PrintWrapperProps) {
  const { copies, onReady } = props;

  useEffect(() => {
    const timer = setTimeout(onReady, 250);
    return () => clearTimeout(timer);
  }, [onReady]);

  if (props.kind === 'product') {
    const template = TEMPLATE_REGISTRY[props.templateId];
    const LabelComponent = template.component;
    const barcodeValue =
      props.product.imei?.trim() || props.product.sku.trim() || props.product.barcode.trim();

    return (
      <div>
        {Array.from({ length: copies }, (_, i) => (
          <div key={i} className="print-label-page">
            <LabelComponent product={props.product} barcodeValue={barcodeValue} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      {Array.from({ length: copies }, (_, i) => (
        <div key={i} className="print-label-page">
          <CustomLabelTemplate config={props.customLabel} />
        </div>
      ))}
    </div>
  );
}
