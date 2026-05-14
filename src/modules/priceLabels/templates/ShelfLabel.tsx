import type { LabelProps } from '../types';
import { formatPrice, mmToPx } from '../utils';
import { BarcodeRenderer } from '../components/BarcodeRenderer';

const W = mmToPx(101.6);  // 384px
const H = mmToPx(76.2);   // 288px

export function ShelfLabel({ product, barcodeValue }: LabelProps) {
  // Split long product names: first part up to ~30 chars becomes the "model line"
  const nameParts = product.name.split(' ');
  const threshold = 3;
  const headline = nameParts.slice(0, threshold).join(' ');
  const subline = nameParts.slice(threshold).join(' ');

  return (
    <div
      style={{
        width: W,
        height: H,
        background: '#fff',
        fontFamily: 'Arial, Helvetica, sans-serif',
        overflow: 'hidden',
        padding: '10px 12px 8px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        boxSizing: 'border-box',
      }}
    >
      {/* Category badge */}
      {product.category && (
        <div
          style={{
            fontSize: 8,
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: '#888',
            marginBottom: 4,
          }}
        >
          {product.category}
        </div>
      )}

      {/* Product name */}
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: 18,
            fontWeight: 800,
            color: '#000',
            lineHeight: 1.1,
            overflow: 'hidden',
          }}
        >
          {headline}
        </div>
        {subline && (
          <div
            style={{
              fontSize: 11,
              color: '#444',
              marginTop: 2,
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
            }}
          >
            {subline}
          </div>
        )}
      </div>

      {/* Price — dominant element */}
      <div
        style={{
          fontSize: 42,
          fontWeight: 900,
          color: '#000',
          letterSpacing: '-1px',
          lineHeight: 1,
          margin: '6px 0',
          textAlign: 'center',
        }}
      >
        {formatPrice(product.price)}
      </div>

      {/* SKU */}
      <div style={{ fontSize: 8, color: '#888', marginBottom: 4 }}>SKU: {product.sku}</div>

      {/* Barcode */}
      <div style={{ overflow: 'hidden' }}>
        <BarcodeRenderer
          value={barcodeValue}
          height={40}
          displayValue
          barWidth={1.3}
          fillWidth
          fontSize={9}
          textMargin={2}
        />
      </div>
    </div>
  );
}
