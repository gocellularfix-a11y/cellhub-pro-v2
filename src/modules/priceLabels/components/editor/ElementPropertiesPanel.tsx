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

export function ElementPropertiesPanel({
  element,
  onUpdate,
  onDelete,
}: ElementPropertiesPanelProps) {
  if (!element) {
    return (
      <div className="flex items-center justify-center text-center p-4 bg-gray-50 rounded-xl border border-dashed border-gray-200">
        <p className="text-xs text-gray-400">Click an element on the canvas to edit it</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          {element.type === 'text' ? 'Text' : element.type === 'barcode' ? 'Barcode' : 'QR Code'}
        </span>
        <button
          onClick={() => onDelete(element.id)}
          className="text-xs px-2 py-1 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors font-medium"
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
      <div className="pt-1 border-t border-gray-100 grid grid-cols-2 gap-2">
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
        <label className="block text-xs text-gray-500 mb-1">Value</label>
        <input
          type="text"
          value={element.value}
          onChange={e => onUpdate({ ...element, value: e.target.value })}
          className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Enter text…"
        />
      </div>

      {/* Font size — numeric + S/M/L quick buttons */}
      <div>
        <label className="block text-xs text-gray-500 mb-1">Font Size (6–72 px)</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={6}
            max={72}
            value={fontSize}
            onChange={e => setFontSize(e.target.value)}
            className="w-16 px-2 py-1.5 border border-gray-300 rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-xs text-gray-400">px</span>
          <div className="flex gap-1 ml-auto">
            {TEXT_SIZE_BUTTONS.map(sz => (
              <button
                key={sz.value}
                onClick={() => applyPreset(sz.value)}
                title={`${sz.label}: ${FONT_SIZE_PRESETS[sz.value]}px`}
                className={`w-8 h-7 text-xs font-semibold rounded border transition-colors ${
                  fontSize === FONT_SIZE_PRESETS[sz.value]
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-300 hover:border-blue-300'
                }`}
              >
                {sz.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Bold */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-500">Style</label>
        <button
          onClick={() => onUpdate({ ...element, bold: !element.bold })}
          className={`h-7 px-3 text-xs font-bold rounded border transition-colors ${
            element.bold
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-white text-gray-600 border-gray-300 hover:border-blue-300'
          }`}
        >
          B
        </button>
      </div>

      {/* Font family */}
      <div>
        <label className="block text-xs text-gray-500 mb-1">Font Family</label>
        <select
          value={element.fontFamily ?? 'Arial'}
          onChange={e => onUpdate({ ...element, fontFamily: e.target.value })}
          className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {FONT_FAMILIES.map(f => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </div>

      {/* Box size — optional width + height */}
      <div className="grid grid-cols-2 gap-2 pt-1 border-t border-gray-100">
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
      <p className="text-xs text-gray-400 -mt-1">
        Box W enables word-wrap · Box H clips overflow
      </p>
    </>
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
        <label className="block text-xs text-gray-500 mb-1">Barcode Value (CODE128)</label>
        <input
          type="text"
          value={element.value}
          onChange={e => onUpdate({ ...element, value: e.target.value })}
          className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="e.g. 012345678901"
        />
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">
          Width: {element.width ?? 'auto'} px
          <span className="text-gray-400 ml-1">(60–500)</span>
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
        <label className="block text-xs text-gray-500 mb-1">
          Height: {element.height} px
          <span className="text-gray-400 ml-1">(20–180)</span>
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
        <label className="block text-xs text-gray-500 mb-1">QR Value / URL</label>
        <input
          type="text"
          value={element.value}
          onChange={e => onUpdate({ ...element, value: e.target.value })}
          className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="https://example.com"
        />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">
          Size: {element.size} px
          <span className="text-gray-400 ml-1">(30–300)</span>
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
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        onChange={e => {
          const n = parseInt(e.target.value, 10);
          if (!isNaN(n)) onChange(Math.max(min, n));
        }}
        className="w-full px-2 py-1 border border-gray-300 rounded-lg text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
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
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
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
        className="w-full px-2 py-1 border border-gray-300 rounded-lg text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
    </div>
  );
}
