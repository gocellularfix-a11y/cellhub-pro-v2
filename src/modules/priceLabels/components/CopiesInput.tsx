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

  const btnBase: React.CSSProperties = {
    width: '2.25rem',
    height: '2.25rem',
    borderRadius: '8px',
    border: '1px solid rgba(148,163,184,0.15)',
    background: '#141e30',
    color: '#94a3b8',
    fontSize: '1.1rem',
    fontWeight: 500,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.12s ease',
    flexShrink: 0,
  };

  return (
    <div>
      <label
        style={{
          display: 'block',
          fontSize: '0.75rem',
          fontWeight: 500,
          color: '#64748b',
          marginBottom: '0.375rem',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        Copies
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <button
          onClick={() => onChange(clamp(value - 1))}
          disabled={value <= min}
          style={{
            ...btnBase,
            opacity: value <= min ? 0.35 : 1,
            cursor: value <= min ? 'not-allowed' : 'pointer',
          }}
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
          style={{
            width: '4rem',
            textAlign: 'center',
            fontSize: '0.875rem',
            fontWeight: 600,
            border: '1px solid rgba(148,163,184,0.15)',
            borderRadius: '8px',
            padding: '0.4rem 0.25rem',
            background: '#0a1120',
            color: '#e2e8f0',
            outline: 'none',
          }}
        />

        <button
          onClick={() => onChange(clamp(value + 1))}
          disabled={value >= max}
          style={{
            ...btnBase,
            opacity: value >= max ? 0.35 : 1,
            cursor: value >= max ? 'not-allowed' : 'pointer',
          }}
          aria-label="Increase copies"
        >
          +
        </button>

        <span style={{ fontSize: '0.8rem', color: '#475569', marginLeft: '0.25rem' }}>
          {value === 1 ? 'copy' : 'copies'}
        </span>
      </div>
    </div>
  );
}
