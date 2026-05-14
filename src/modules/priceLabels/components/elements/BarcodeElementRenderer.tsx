import type { BarcodeElement } from '../../types';
import { BarcodeRenderer } from '../BarcodeRenderer';

export function BarcodeElementRenderer({ element }: { element: BarcodeElement }) {
  const barcodeValue = element.value || '000000000000';

  if (typeof element.width === 'number') {
    // Constrain to explicit width; BarcodeRenderer fills the container via viewBox scaling
    return (
      <div style={{ width: element.width, overflow: 'hidden' }}>
        <BarcodeRenderer
          value={barcodeValue}
          height={element.height}
          displayValue
          barWidth={1.2}
          fontSize={9}
          textMargin={2}
          fillWidth
        />
      </div>
    );
  }

  // Natural width (determined by barcode content length)
  return (
    <BarcodeRenderer
      value={barcodeValue}
      height={element.height}
      displayValue
      barWidth={1.2}
      fontSize={9}
      textMargin={2}
    />
  );
}
