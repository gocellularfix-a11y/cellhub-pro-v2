import type { LabelProps } from '../types';
import { formatPrice, mmToPx, SMALL_PRICE_LABEL_W_MM, SMALL_PRICE_LABEL_H_MM } from '../utils';
import { BarcodeRenderer } from '../components/BarcodeRenderer';

// 2.25 × 1.25 in — industry-standard small price tag
const W = mmToPx(SMALL_PRICE_LABEL_W_MM);  // 216px
const H = mmToPx(SMALL_PRICE_LABEL_H_MM);  // 120px

export function SmallPriceLabel({ product, barcodeValue }: LabelProps) {
  return (
    <div
      style={{
        width: W,
        height: H,
        background: '#fff',
        fontFamily: 'Arial, Helvetica, sans-serif',
        overflow: 'hidden',
        padding: '5px 6px 4px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
        <span style={{ fontSize: 9, color: '#333', letterSpacing: '-0.2px' }}>{product.name}</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 22, fontWeight: 900, color: '#000', lineHeight: 1 }}>
          {formatPrice(product.price)}
        </span>
        <span style={{ fontSize: 7.5, color: '#666', textAlign: 'right' }}>
          SKU<br />{product.sku}
        </span>
      </div>

      <div style={{ overflow: 'hidden' }}>
        <BarcodeRenderer
          value={barcodeValue}
          height={26}
          displayValue={false}
          barWidth={1}
          fillWidth
        />
      </div>
    </div>
  );
}
