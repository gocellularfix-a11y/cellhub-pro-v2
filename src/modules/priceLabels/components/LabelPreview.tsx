import type { Product, TemplateId } from '../types';
import { TEMPLATE_REGISTRY } from '../templates';
import { mmToPx, deriveBarcodeValue } from '../utils';

const PREVIEW_MAX_W = 380;
const PREVIEW_MAX_H = 260;

interface LabelPreviewProps {
  product: Product | null;
  templateId: TemplateId;
}

export function LabelPreview({ product, templateId }: LabelPreviewProps) {
  const template = TEMPLATE_REGISTRY[templateId];
  const LabelComponent = template.component;

  const labelW = mmToPx(template.widthMm);
  const labelH = mmToPx(template.heightMm);
  const scaleX = PREVIEW_MAX_W / labelW;
  const scaleY = PREVIEW_MAX_H / labelH;
  const scale = Math.min(scaleX, scaleY, 1);

  const displayW = Math.round(labelW * scale);
  const displayH = Math.round(labelH * scale);

  if (!product) {
    return (
      <div
        className="flex items-center justify-center border-2 border-dashed border-gray-300 rounded-xl bg-gray-50"
        style={{ width: PREVIEW_MAX_W, height: PREVIEW_MAX_H }}
      >
        <div className="text-center text-gray-400">
          <div className="text-4xl mb-2">🏷️</div>
          <div className="text-sm font-medium">Select a product to preview</div>
        </div>
      </div>
    );
  }

  const barcodeValue = deriveBarcodeValue(product);

  return (
    <div
      className="flex items-center justify-center bg-gray-100 rounded-xl"
      style={{ width: PREVIEW_MAX_W, height: PREVIEW_MAX_H }}
    >
      {/* Outer shell sized to scaled dimensions */}
      <div style={{ width: displayW, height: displayH, position: 'relative' }}>
        {/* Shadow + border for print preview feel */}
        <div
          className="absolute inset-0 shadow-lg rounded"
          style={{
            border: '1px solid #bbb',
            background: '#fff',
          }}
        />
        {/* Scale the label to fit */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            transformOrigin: 'top left',
            transform: `scale(${scale})`,
          }}
        >
          <LabelComponent product={product} barcodeValue={barcodeValue} />
        </div>
      </div>
    </div>
  );
}
