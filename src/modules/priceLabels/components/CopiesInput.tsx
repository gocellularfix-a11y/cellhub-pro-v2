interface CopiesInputProps {
  value: number;
  onChange: (copies: number) => void;
  min?: number;
  max?: number;
}

export function CopiesInput({ value, onChange, min = 1, max = 99 }: CopiesInputProps) {
  function clamp(n: number) {
    return Math.max(min, Math.min(max, n));
  }

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">Copies</label>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onChange(clamp(value - 1))}
          disabled={value <= min}
          className="w-9 h-9 rounded-lg border border-gray-300 bg-white text-gray-700 text-lg font-medium hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
          aria-label="Decrease copies"
        >
          −
        </button>

        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={e => {
            const n = parseInt(e.target.value, 10);
            if (!isNaN(n)) onChange(clamp(n));
          }}
          className="w-16 text-center text-sm font-semibold border border-gray-300 rounded-lg py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white shadow-sm"
        />

        <button
          onClick={() => onChange(clamp(value + 1))}
          disabled={value >= max}
          className="w-9 h-9 rounded-lg border border-gray-300 bg-white text-gray-700 text-lg font-medium hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
          aria-label="Increase copies"
        >
          +
        </button>

        <span className="text-sm text-gray-500 ml-1">
          {value === 1 ? 'copy' : 'copies'}
        </span>
      </div>
    </div>
  );
}
