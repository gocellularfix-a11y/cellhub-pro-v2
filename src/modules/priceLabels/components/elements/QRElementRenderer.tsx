import { useState, useEffect, memo } from 'react';
import QRCode from 'qrcode';
import type { QRElement } from '../../types';

export const QRElementRenderer = memo(function QRElementRenderer({ element }: { element: QRElement }) {
  const [dataUrl, setDataUrl] = useState('');

  useEffect(() => {
    const val = element.value.trim();
    if (!val) { setDataUrl(''); return; }
    // Render at 4× resolution, downscale via CSS for crisp output
    QRCode.toDataURL(val, {
      width: Math.max(element.size * 4, 200),
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then(url => setDataUrl(url))
      .catch(() => setDataUrl(''));
  }, [element.value, element.size]);

  if (!dataUrl) {
    return (
      <div
        style={{
          width: element.size,
          height: element.size,
          background: '#f5f5f5',
          border: '1px dashed #ccc',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span style={{ fontSize: 9, color: '#aaa', fontFamily: 'Arial' }}>QR</span>
      </div>
    );
  }

  return (
    <img
      src={dataUrl}
      width={element.size}
      height={element.size}
      style={{ display: 'block' }}
      alt="QR"
    />
  );
});
