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

  return (
    <div className="flex flex-col gap-4">
      {/* Label size */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Label Size</label>
        <select
          value={selectValue}
          onChange={handleSizeSelect}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
        <label className="block text-sm font-medium text-gray-700 mb-2">Add Element</label>
        <div className="flex flex-col gap-2">
          <button
            onClick={onAddText}
            className="w-full flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 transition-colors shadow-sm"
          >
            <span className="text-base">T</span>
            Text
          </button>
          <button
            onClick={onAddBarcode}
            className="w-full flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 transition-colors shadow-sm"
          >
            <span className="text-base font-mono text-xs tracking-tighter">▮▮▮</span>
            Barcode
          </button>
          <button
            onClick={onAddQR}
            className="w-full flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 transition-colors shadow-sm"
          >
            <span className="text-base">⬛</span>
            QR Code
          </button>
          {hasClipboardApi && (
            <button
              onClick={handlePasteClick}
              className="w-full flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 transition-colors shadow-sm"
            >
              <span className="text-base">📋</span>
              Paste Text
            </button>
          )}
        </div>
      </div>

      {/* Clear canvas */}
      <button
        onClick={onClear}
        className="w-full px-3 py-2 text-sm text-red-500 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
      >
        Clear canvas
      </button>
    </div>
  );
}
