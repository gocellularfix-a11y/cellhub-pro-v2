import type { LabelProps } from '../types';
import { formatPrice, mmToPx } from '../utils';
import { BarcodeRenderer } from '../components/BarcodeRenderer';

const W = mmToPx(89);  // 336px
const H = mmToPx(36);  // 136px

export function BarcodeLabel({ product, barcodeValue }: LabelProps) {
  return (
    <div
      style={{
        width: W,
        height: H,
        background: '#fff',
        fontFamily: 'Arial, Helvetica, sans-serif',
        overflow: 'hidden',
        padding: '5px 6px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ overflow: 'hidden' }}>
        <BarcodeRenderer
          value={barcodeValue}
          height={52}
          displayValue
          barWidth={1.2}
          fillWidth
          fontSize={9}
          textMargin={2}
        />
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingTop: 3,
          borderTop: '0.5px solid #e5e5e5',
        }}
      >
        <div style={{ overflow: 'hidden', flex: 1 }}>
          <div
            style={{
              fontSize: 9,
              color: '#111',
              fontWeight: 600,
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
            }}
          >
            {product.name}
          </div>
          <div style={{ fontSize: 8, color: '#777', marginTop: 1 }}>{product.sku}</div>
        </div>
        <div
          style={{
            fontSize: 18,
            fontWeight: 900,
            color: '#000',
            whiteSpace: 'nowrap',
            marginLeft: 8,
          }}
        >
          {formatPrice(product.price)}
        </div>
      </div>
    </div>
  );
}
