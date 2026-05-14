import type { CustomLabelConfig } from '../types';
import { mmToPx } from '../utils';
import { TextRenderer } from '../components/elements/TextRenderer';
import { BarcodeElementRenderer } from '../components/elements/BarcodeElementRenderer';
import { QRElementRenderer } from '../components/elements/QRElementRenderer';

interface CustomLabelTemplateProps {
  config: CustomLabelConfig;
}

/**
 * Renders a custom label at actual print size (no CSS scaling).
 * Used exclusively by PrintWrapper for browser/Electron print flow.
 */
export function CustomLabelTemplate({ config }: CustomLabelTemplateProps) {
  const W = mmToPx(config.widthMm);
  const H = mmToPx(config.heightMm);

  return (
    <div
      style={{
        width: W,
        height: H,
        background: '#ffffff',
        position: 'relative',
        overflow: 'hidden',
        fontFamily: 'Arial, Helvetica, sans-serif',
      }}
    >
      {config.elements.map(el => (
        <div
          key={el.id}
          style={{ position: 'absolute', left: el.x, top: el.y }}
        >
          {el.type === 'text' && <TextRenderer element={el} />}
          {el.type === 'barcode' && <BarcodeElementRenderer element={el} />}
          {el.type === 'qr' && <QRElementRenderer element={el} />}
        </div>
      ))}
    </div>
  );
}
