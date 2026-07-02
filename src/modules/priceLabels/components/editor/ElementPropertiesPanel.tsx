import type {
  LabelElement,
  TextElement,
  BarcodeElement,
  QRElement,
  TextSize,
} from '../../types';
import { FONT_SIZE_PRESETS, FONT_FAMILIES, resolveTextFontSize } from '../elements/TextRenderer';

interface ElementPropertiesPanelProps {
  element: LabelElement | null;
  onUpdate: (updated: LabelElement) => void;
  onDelete: (id: string) => void;
}

const TEXT_SIZE_BUTTONS: { label: string; value: TextSize }[] = [
  { label: 'S', value: 'small' },
  { label: 'M', value: 'medium' },
  { label: 'L', value: 'large' },
];

const darkInput: React.CSSProperties = {
  background: '#0a1120',
  border: '1px solid rgba(148,163,184,0.15)',
  color: '#e2e8f0',
  borderRadius: '8px',
  padding: '0.35rem 0.5rem',
  fontSize: '0.8rem',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

const darkSelect: React.CSSProperties = {
  ...darkInput,
  appearance: 'none',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.7rem',
  color: '#64748b',
  marginBottom: '0.25rem',
  fontWeight: 500,
};

export function ElementPropertiesPanel({
  element,
  onUpdate,
  onDelete,
}: ElementPropertiesPanelProps) {
  if (!element) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          padding: '1rem',
          background: 'rgba(10,17,32,0.5)',
          borderRadius: '12px',
          border: '1px dashed rgba(148,163,184,0.12)',
        }}
      >
        <p style={{ fontSize: '0.72rem', color: '#334155' }}>Click an element on the canvas to edit it</p>
      </div>
    );
  }

  return (
    <div
      style={{
        background: 'linear-gradient(160deg, #0e1525 0%, #0b1120 100%)',
        borderRadius: '12px',
        border: '1px solid rgba(148,163,184,0.10)',
        padding: '0.875rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span
          style={{
            fontSize: '0.65rem',
            fontWeight: 600,
            color: '#475569',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          {element.type === 'text' ? 'Text' : element.type === 'barcode' ? 'Barcode' : 'QR Code'}
        </span>
        <button
          onClick={() => onDelete(element.id)}
          style={{
            fontSize: '0.7rem',
            padding: '0.2rem 0.5rem',
            background: 'rgba(239,68,68,0.08)',
            color: '#f87171',
            borderRadius: '6px',
            border: '1px solid rgba(239,68,68,0.2)',
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          🗑 Delete
        </button>
      </div>

      {element.type === 'text' && (
        <TextPanel element={element} onUpdate={onUpdate} />
      )}
      {element.type === 'barcode' && (
        <BarcodePanel element={element} onUpdate={onUpdate} />
      )}
      {element.type === 'qr' && (
        <QRPanel element={element} onUpdate={onUpdate} />
      )}

      {/* Position */}
      <div
        style={{
          paddingTop: '0.5rem',
          borderTop: '1px solid rgba(148,163,184,0.08)',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '0.5rem',
        }}
      >
        <NumField
          label="X (px)"
          value={Math.round(element.x)}
          min={0}
          onChange={v => onUpdate({ ...element, x: v })}
        />
        <NumField
          label="Y (px)"
          value={Math.round(element.y)}
          min={0}
          onChange={v => onUpdate({ ...element, y: v })}
        />
      </div>
    </div>
  );
}

// ── Text panel ────────────────────────────────────────────────────────────────

function TextPanel({
  element,
  onUpdate,
}: {
  element: TextElement;
  onUpdate: (u: LabelElement) => void;
}) {
  const fontSize = resolveTextFontSize(element);

  function applyPreset(size: TextSize) {
    onUpdate({ ...element, size, fontSize: FONT_SIZE_PRESETS[size] });
  }

  function setFontSize(raw: string) {
    const n = parseInt(raw, 10);
    if (isNaN(n)) return;
    const clamped = Math.max(6, Math.min(72, n));
    onUpdate({ ...element, fontSize: clamped, size: undefined });
  }

  return (
    <>
      {/* Value */}
      <div>
        <label style={labelStyle}>Value</label>
        <input
          type="text"
          value={element.value}
          onChange={e => onUpdate({ ...element, value: e.target.value })}
          style={darkInput}
          placeholder="Enter text…"
        />
      </div>

      {/* Font size — numeric + S/M/L quick buttons */}
      <div>
        <label style={labelStyle}>Font Size (6–72 px)</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input
            type="number"
            min={6}
            max={72}
            value={fontSize}
            onChange={e => setFontSize(e.target.value)}
            style={{ ...darkInput, width: '4rem', textAlign: 'center' }}
          />
          <span style={{ fontSize: '0.7rem', color: '#475569' }}>px</span>
          <div style={{ display: 'flex', gap: '0.25rem', marginLeft: 'auto' }}>
            {TEXT_SIZE_BUTTONS.map(sz => {
              const isActive = fontSize === FONT_SIZE_PRESETS[sz.value];
              return (
                <button
                  key={sz.value}
                  onClick={() => applyPreset(sz.value)}
                  title={`${sz.label}: ${FONT_SIZE_PRESETS[sz.value]}px`}
                  style={{
                    width: '2rem',
                    height: '1.75rem',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    borderRadius: '6px',
                    border: isActive ? '1px solid #38bdf8' : '1px solid rgba(148,163,184,0.15)',
                    background: isActive ? '#38bdf8' : '#141e30',
                    color: isActive ? '#000' : '#64748b',
                    cursor: 'pointer',
                    transition: 'all 0.1s ease',
                  }}
                >
                  {sz.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bold */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <label style={{ ...labelStyle, marginBottom: 0 }}>Style</label>
        <button
          onClick={() => onUpdate({ ...element, bold: !element.bold })}
          style={{
            height: '1.75rem',
            padding: '0 0.75rem',
            fontSize: '0.75rem',
            fontWeight: 700,
            borderRadius: '6px',
            border: element.bold ? '1px solid #38bdf8' : '1px solid rgba(148,163,184,0.15)',
            background: element.bold ? '#38bdf8' : '#141e30',
            color: element.bold ? '#000' : '#64748b',
            cursor: 'pointer',
            transition: 'all 0.1s ease',
          }}
        >
          B
        </button>
      </div>

      {/* Font family */}
      <div>
        <label style={labelStyle}>Font Family</label>
        <select
          value={element.fontFamily ?? 'Arial'}
          onChange={e => onUpdate({ ...element, fontFamily: e.target.value })}
          style={darkSelect}
        >
          {FONT_FAMILIES.map(f => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </div>

      {/* Box size — optional width + height */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '0.5rem',
          paddingTop: '0.5rem',
          borderTop: '1px solid rgba(148,163,184,0.08)',
        }}
      >
        <OptNumField
          label="Box W (px)"
          value={element.width}
          placeholder="auto"
          min={10}
          onChange={v => onUpdate({ ...element, width: v })}
        />
        <OptNumField
          label="Box H (px)"
          value={element.height}
          placeholder="auto"
          min={10}
          onChange={v => onUpdate({ ...element, height: v })}
        />
      </div>
      <p style={{ fontSize: '0.68rem', color: '#334155', marginTop: '-0.25rem' }}>
        Box W enables word-wrap · Box H clips overflow
      </p>

      {/* LABEL-STUDIO-DIRECT-PRINT-AND-DYMO-LIKE-TEXT-V1 — DYMO-style box
          controls. Effective when both Box W and Box H are set (fixed box). */}
      <div>
        <label style={labelStyle}>Align</label>
        <ChoiceRow
          options={[
            { label: '⬅', value: 'left', title: 'Left' },
            { label: '↔', value: 'center', title: 'Center' },
            { label: '➡', value: 'right', title: 'Right' },
            { label: '☰', value: 'justify', title: 'Justify' },
          ]}
          value={element.align ?? 'left'}
          onChange={v => onUpdate({ ...element, align: v as TextElement['align'] })}
        />
      </div>
      <div>
        <label style={labelStyle}>Vertical</label>
        <ChoiceRow
          options={[
            { label: '⬆', value: 'top', title: 'Top' },
            { label: '↕', value: 'middle', title: 'Middle' },
            { label: '⬇', value: 'bottom', title: 'Bottom' },
          ]}
          value={element.valign ?? 'top'}
          onChange={v => onUpdate({ ...element, valign: v as TextElement['valign'] })}
        />
      </div>
      <div>
        <label style={labelStyle}>Overflow</label>
        <ChoiceRow
          options={[
            { label: 'Clip', value: 'clip', title: 'Cut text at box bounds' },
            { label: 'Wrap', value: 'wrap', title: 'Wrap lines, cut at box bounds' },
            { label: 'AutoFit', value: 'autofit', title: 'Shrink font to fit box (never above Font Size)' },
          ]}
          value={element.overflow ?? 'wrap'}
          onChange={v => onUpdate({ ...element, overflow: v as TextElement['overflow'] })}
        />
        <p style={{ fontSize: '0.68rem', color: '#334155', marginTop: '0.25rem' }}>
          Needs Box W + Box H · AutoFit max = Font Size
        </p>
      </div>
    </>
  );
}

/** Compact mutually-exclusive button row (Align / Vertical / Overflow). */
function ChoiceRow({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: string; title: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: '0.25rem' }}>
      {options.map(opt => {
        const isActive = value === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            title={opt.title}
            style={{
              flex: 1,
              height: '1.75rem',
              fontSize: '0.7rem',
              fontWeight: 600,
              borderRadius: '6px',
              border: isActive ? '1px solid #38bdf8' : '1px solid rgba(148,163,184,0.15)',
              background: isActive ? '#38bdf8' : '#141e30',
              color: isActive ? '#000' : '#64748b',
              cursor: 'pointer',
              transition: 'all 0.1s ease',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Barcode panel ─────────────────────────────────────────────────────────────

function BarcodePanel({
  element,
  onUpdate,
}: {
  element: BarcodeElement;
  onUpdate: (u: LabelElement) => void;
}) {
  return (
    <>
      <div>
        <label style={labelStyle}>Barcode Value (CODE128)</label>
        <input
          type="text"
          value={element.value}
          onChange={e => onUpdate({ ...element, value: e.target.value })}
          style={{ ...darkInput, fontFamily: 'monospace' }}
          placeholder="e.g. 012345678901"
        />
      </div>

      <div>
        <label style={labelStyle}>
          Width: {element.width ?? 'auto'} px
          <span style={{ color: '#334155', marginLeft: '0.25rem' }}>(60–500)</span>
        </label>
        <input
          type="range"
          min={60}
          max={500}
          step={10}
          value={element.width ?? 180}
          onChange={e => onUpdate({ ...element, width: parseInt(e.target.value) })}
          className="w-full accent-blue-600"
        />
      </div>

      <div>
        <label style={labelStyle}>
          Height: {element.height} px
          <span style={{ color: '#334155', marginLeft: '0.25rem' }}>(20–180)</span>
        </label>
        <input
          type="range"
          min={20}
          max={180}
          step={5}
          value={element.height}
          onChange={e => onUpdate({ ...element, height: parseInt(e.target.value) })}
          className="w-full accent-blue-600"
        />
      </div>
    </>
  );
}

// ── QR panel ──────────────────────────────────────────────────────────────────

function QRPanel({
  element,
  onUpdate,
}: {
  element: QRElement;
  onUpdate: (u: LabelElement) => void;
}) {
  return (
    <>
      <div>
        <label style={labelStyle}>QR Value / URL</label>
        <input
          type="text"
          value={element.value}
          onChange={e => onUpdate({ ...element, value: e.target.value })}
          style={darkInput}
          placeholder="https://example.com"
        />
      </div>
      <div>
        <label style={labelStyle}>
          Size: {element.size} px
          <span style={{ color: '#334155', marginLeft: '0.25rem' }}>(30–300)</span>
        </label>
        <input
          type="range"
          min={30}
          max={300}
          step={10}
          value={element.size}
          onChange={e => onUpdate({ ...element, size: parseInt(e.target.value) })}
          className="w-full accent-blue-600"
        />
      </div>
    </>
  );
}

// ── Shared field components ───────────────────────────────────────────────────

function NumField({
  label,
  value,
  min = 0,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        onChange={e => {
          const n = parseInt(e.target.value, 10);
          if (!isNaN(n)) onChange(Math.max(min, n));
        }}
        style={{ ...darkInput, textAlign: 'center', fontSize: '0.72rem' }}
      />
    </div>
  );
}

function OptNumField({
  label,
  value,
  placeholder,
  min = 0,
  onChange,
}: {
  label: string;
  value: number | undefined;
  placeholder: string;
  min?: number;
  onChange: (v: number | undefined) => void;
}) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input
        type="number"
        value={value ?? ''}
        min={min}
        placeholder={placeholder}
        onChange={e => {
          const raw = e.target.value;
          if (raw === '') { onChange(undefined); return; }
          const n = parseInt(raw, 10);
          if (!isNaN(n)) onChange(Math.max(min, n));
        }}
        style={{ ...darkInput, textAlign: 'center', fontSize: '0.72rem' }}
      />
    </div>
  );
}
