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
        style={{
          width: PREVIEW_MAX_W,
          height: PREVIEW_MAX_H,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '2px dashed rgba(148,163,184,0.12)',
          borderRadius: '14px',
          background: 'rgba(10,17,32,0.5)',
        }}
      >
        <div style={{ textAlign: 'center', color: '#334155' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🏷️</div>
          <div style={{ fontSize: '0.8rem', fontWeight: 500, color: '#475569' }}>Select a product to preview</div>
        </div>
      </div>
    );
  }

  const barcodeValue = deriveBarcodeValue(product);

  return (
    <div
      style={{
        width: PREVIEW_MAX_W,
        height: PREVIEW_MAX_H,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0a1120',
        backgroundImage: 'radial-gradient(rgba(148,163,184,0.06) 1px, transparent 1px)',
        backgroundSize: '16px 16px',
        borderRadius: '14px',
      }}
    >
      {/* Outer shell sized to scaled dimensions */}
      <div style={{ width: displayW, height: displayH, position: 'relative' }}>
        {/* Shadow + border for print preview feel */}
        <div
          className="absolute inset-0 rounded"
          style={{
            border: '1px solid #bbb',
            background: '#fff',
            boxShadow: '0 0 0 1px rgba(56,189,248,0.12), 0 8px 32px rgba(0,0,0,0.6)',
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
