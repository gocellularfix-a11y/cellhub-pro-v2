import type { LabelProps } from '../types';
import { formatPrice, mmToPx, LARGE_LABEL_W_MM, LARGE_LABEL_H_MM } from '../utils';
import { BarcodeRenderer } from '../components/BarcodeRenderer';

// 4 × 6 in — standard large product display / shipping label
const W = mmToPx(LARGE_LABEL_W_MM);  // 384px
const H = mmToPx(LARGE_LABEL_H_MM);  // 576px

export function LargeLabel({ product, barcodeValue }: LabelProps) {
  const nameParts = product.name.split(' ');
  const headline = nameParts.slice(0, 3).join(' ');
  const subline  = nameParts.slice(3).join(' ');

  return (
    <div
      style={{
        width: W,
        height: H,
        background: '#fff',
        fontFamily: 'Arial, Helvetica, sans-serif',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
      }}
    >
      {/* Top accent bar */}
      <div style={{ background: '#111', height: 8, flexShrink: 0 }} />

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '14px 16px 12px' }}>

        {/* Category */}
        {product.category && (
          <div
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: '#aaa',
              marginBottom: 10,
            }}
          >
            {product.category}
          </div>
        )}

        {/* Product name */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 26, fontWeight: 900, color: '#000', lineHeight: 1.1 }}>
            {headline}
          </div>
          {subline && (
            <div style={{ fontSize: 14, color: '#555', marginTop: 4, lineHeight: 1.2 }}>
              {subline}
            </div>
          )}
        </div>

        {/* Divider */}
        <div style={{ borderTop: '0.5px solid #e0e0e0', margin: '10px 0' }} />

        {/* Price — dominant centrepiece */}
        <div
          style={{
            fontSize: 72,
            fontWeight: 900,
            color: '#000',
            letterSpacing: '-2px',
            lineHeight: 1,
            textAlign: 'center',
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {formatPrice(product.price)}
        </div>

        {/* Divider */}
        <div style={{ borderTop: '0.5px solid #e0e0e0', margin: '10px 0 8px' }} />

        {/* SKU + IMEI */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 9, color: '#777' }}>SKU: {product.sku}</div>
          {product.imei && (
            <div style={{ fontSize: 9, color: '#777', marginTop: 2 }}>IMEI: {product.imei}</div>
          )}
        </div>

        {/* Barcode — full width, prominent */}
        <div style={{ overflow: 'hidden' }}>
          <BarcodeRenderer
            value={barcodeValue}
            height={70}
            displayValue
            barWidth={1.8}
            fillWidth
            fontSize={11}
            textMargin={3}
          />
        </div>
      </div>
    </div>
  );
}
