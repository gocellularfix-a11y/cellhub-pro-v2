import {
  SMALL_PRICE_LABEL_W_MM,
  SMALL_PRICE_LABEL_H_MM,
  LARGE_LABEL_W_MM,
  LARGE_LABEL_H_MM,
} from '../../utils';

interface SizePreset {
  label: string;
  widthMm: number;
  heightMm: number;
}

const SIZE_PRESETS: SizePreset[] = [
  {
    label: `2.25×1.25 in (${SMALL_PRICE_LABEL_W_MM}×${SMALL_PRICE_LABEL_H_MM} mm) — Small Price`,
    widthMm: SMALL_PRICE_LABEL_W_MM,
    heightMm: SMALL_PRICE_LABEL_H_MM,
  },
  {
    label: '3.5×1.4 in (89×36 mm) — Barcode',
    widthMm: 89,
    heightMm: 36,
  },
  {
    label: '4×3 in (101.6×76.2 mm) — Shelf',
    widthMm: 101.6,
    heightMm: 76.2,
  },
  {
    label: `4×6 in (${LARGE_LABEL_W_MM}×${LARGE_LABEL_H_MM} mm) — Large / Shipping`,
    widthMm: LARGE_LABEL_W_MM,
    heightMm: LARGE_LABEL_H_MM,
  },
  {
    label: '3.5×2 in (89×51 mm) — Card',
    widthMm: 89,
    heightMm: 51,
  },
];

interface ElementToolbarProps {
  widthMm: number;
  heightMm: number;
  onAddText: () => void;
  onAddBarcode: () => void;
  onAddQR: () => void;
  onSizeChange: (widthMm: number, heightMm: number) => void;
  onClear: () => void;
  onPasteText?: (text: string) => void;
}

export function ElementToolbar({
  widthMm,
  heightMm,
  onAddText,
  onAddBarcode,
  onAddQR,
  onSizeChange,
  onClear,
  onPasteText,
}: ElementToolbarProps) {
  const hasClipboardApi = typeof navigator !== 'undefined' && !!navigator.clipboard;

  async function handlePasteClick() {
    if (!navigator.clipboard) return;
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) onPasteText?.(text.trim());
    } catch {
      // clipboard denied or unavailable
    }
  }
  const matchedPreset = SIZE_PRESETS.find(
    p => Math.abs(p.widthMm - widthMm) < 0.5 && Math.abs(p.heightMm - heightMm) < 0.5
  );
  const selectValue = matchedPreset
    ? `${matchedPreset.widthMm}x${matchedPreset.heightMm}`
    : `${widthMm}x${heightMm}`;

  function handleSizeSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    const preset = SIZE_PRESETS.find(p => `${p.widthMm}x${p.heightMm}` === e.target.value);
    if (preset) onSizeChange(preset.widthMm, preset.heightMm);
  }

  const addBtnStyle: React.CSSProperties = {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.5rem 0.75rem',
    background: '#141e30',
    border: '1px solid rgba(148,163,184,0.10)',
    borderRadius: '8px',
    fontSize: '0.8rem',
    fontWeight: 500,
    color: '#94a3b8',
    cursor: 'pointer',
    transition: 'all 0.12s ease',
    textAlign: 'left',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Label size */}
      <div>
        <label
          style={{
            display: 'block',
            fontSize: '0.7rem',
            fontWeight: 500,
            color: '#64748b',
            marginBottom: '0.375rem',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          Label Size
        </label>
        <select
          value={selectValue}
          onChange={handleSizeSelect}
          style={{
            width: '100%',
            padding: '0.5rem 0.625rem',
            border: '1px solid rgba(148,163,184,0.15)',
            borderRadius: '8px',
            fontSize: '0.75rem',
            background: '#0a1120',
            color: '#e2e8f0',
            outline: 'none',
            appearance: 'none',
          }}
        >
          {SIZE_PRESETS.map(p => (
            <option key={`${p.widthMm}x${p.heightMm}`} value={`${p.widthMm}x${p.heightMm}`}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {/* Add element buttons */}
      <div>
        <label
          style={{
            display: 'block',
            fontSize: '0.7rem',
            fontWeight: 500,
            color: '#64748b',
            marginBottom: '0.5rem',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          Add Element
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
          <button onClick={onAddText} style={addBtnStyle}>
            <span style={{ fontSize: '0.9rem', fontWeight: 800, color: '#38bdf8', fontFamily: 'monospace' }}>T</span>
            Text
          </button>
          <button onClick={onAddBarcode} style={addBtnStyle}>
            <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#94a3b8', fontFamily: 'monospace', letterSpacing: '-0.05em' }}>▮▮▮</span>
            Barcode
          </button>
          <button onClick={onAddQR} style={addBtnStyle}>
            <span style={{ fontSize: '0.85rem' }}>⬛</span>
            QR Code
          </button>
          {hasClipboardApi && (
            <button onClick={handlePasteClick} style={addBtnStyle}>
              <span style={{ fontSize: '0.85rem' }}>📋</span>
              Paste
            </button>
          )}
        </div>
      </div>

      {/* Clear canvas */}
      <button
        onClick={onClear}
        style={{
          width: '100%',
          padding: '0.45rem 0.75rem',
          fontSize: '0.8rem',
          color: '#f87171',
          background: 'rgba(239,68,68,0.06)',
          border: '1px solid rgba(239,68,68,0.2)',
          borderRadius: '8px',
          cursor: 'pointer',
          transition: 'all 0.12s ease',
        }}
      >
        ✕ Clear canvas
      </button>
    </div>
  );
}
