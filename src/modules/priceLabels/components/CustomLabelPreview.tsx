import type { CustomLabelConfig } from '../types';
import { mmToPx } from '../utils';
import { TextRenderer } from './elements/TextRenderer';
import { BarcodeElementRenderer } from './elements/BarcodeElementRenderer';
import { QRElementRenderer } from './elements/QRElementRenderer';

interface CustomLabelPreviewProps {
  config: CustomLabelConfig;
  maxWidth?: number;
  maxHeight?: number;
}

/**
 * Read-only scaled preview of a custom label.
 * Used in history cards and detail modal.
 */
export function CustomLabelPreview({
  config,
  maxWidth = 380,
  maxHeight = 260,
}: CustomLabelPreviewProps) {
  const labelW = mmToPx(config.widthMm);
  const labelH = mmToPx(config.heightMm);
  const scale = Math.min(maxWidth / labelW, maxHeight / labelH, 1);
  const displayW = Math.round(labelW * scale);
  const displayH = Math.round(labelH * scale);

  return (
    <div
      style={{
        width: displayW,
        height: displayH,
        position: 'relative',
        overflow: 'hidden',
        border: '1px solid #bbb',
        boxShadow: '0 2px 8px rgba(0,0,0,0.10)',
        borderRadius: 3,
        background: '#fff',
      }}
    >
      {/* Scale container — elements use label-space coordinates */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: labelW,
          height: labelH,
          transformOrigin: 'top left',
          transform: `scale(${scale})`,
        }}
      >
        {config.elements.map(el => (
          <div
            key={el.id}
            style={{ position: 'absolute', left: el.x, top: el.y, pointerEvents: 'none' }}
          >
            {el.type === 'text' && <TextRenderer element={el} />}
            {el.type === 'barcode' && <BarcodeElementRenderer element={el} />}
            {el.type === 'qr' && <QRElementRenderer element={el} />}
          </div>
        ))}
      </div>
    </div>
  );
}
