// ============================================================
// CellHub Pro — AutocompleteInput component
// Plug-and-play input with floating dropdown suggestions
// Props:
//   value, onChange — standard controlled input
//   options         — AutocompleteOption[]
//   onSelect        — called when user picks a suggestion
//   placeholder, label, icon — cosmetic
//   className       — passed to outer div
//   inputStyle      — extra inline style for <input>
//   disabled        — disables the input
//   minQueryLength  — default 1
//   maxResults      — default 8
// ============================================================

import React, { useRef, useEffect } from 'react';
import { useAutocomplete, type AutocompleteOption } from '@/hooks/useAutocomplete';

interface AutocompleteInputProps {
  value: string;
  onChange: (val: string) => void;
  onSelect?: (option: AutocompleteOption) => void;
  options: AutocompleteOption[];
  placeholder?: string;
  label?: string;
  icon?: string;
  className?: string;
  inputStyle?: React.CSSProperties;
  disabled?: boolean;
  minQueryLength?: number;
  maxResults?: number;
  autoFocus?: boolean;
  type?: string;
  /** If provided, shown below input when a match is found (e.g. "Found: Jorge · 120 pts") */
  matchHint?: React.ReactNode;
}

export default function AutocompleteInput({
  value,
  onChange,
  onSelect,
  options,
  placeholder = '',
  label,
  icon,
  className = '',
  inputStyle = {},
  disabled = false,
  minQueryLength = 1,
  maxResults = 8,
  autoFocus = false,
  type = 'text',
  matchHint,
}: AutocompleteInputProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { results, isOpen, activeIndex, open, close, handleKeyDown, selectOption, setActiveIndex } =
    useAutocomplete(
      { options, query: value, minQueryLength, maxResults },
      (opt) => {
        onChange(opt.value);
        onSelect?.(opt);
      },
    );

  // Auto-open when user types and results exist
  useEffect(() => {
    if (results.length > 0 && value.length >= minQueryLength) {
      open();
    } else {
      close();
    }
  }, [results.length, value, minQueryLength]); // eslint-disable-line

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [close]);

  // AutoFocus
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const showDropdown = isOpen && results.length > 0;

  return (
    <div ref={containerRef} className={`relative ${className}`} style={{ position: 'relative' }}>
      {/* Optional label */}
      {label && (
        <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>
          {icon && <span style={{ marginRight: '0.25rem' }}>{icon}</span>}
          {label}
        </label>
      )}

      <input
        ref={inputRef}
        type={type}
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => { if (results.length > 0) open(); }}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        style={inputStyle}
      />

      {/* Match hint (e.g. found existing customer) */}
      {matchHint && (
        <div style={{ marginTop: '0.2rem' }}>
          {matchHint}
        </div>
      )}

      {/* Dropdown */}
      {showDropdown && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            zIndex: 999,
            background: '#1e293b',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: '0.5rem',
            overflow: 'hidden',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}
        >
          {results.map((opt, i) => (
            <button
              key={opt.value + i}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault(); // prevent input blur before click
                selectOption(opt);
              }}
              onMouseEnter={() => setActiveIndex(i)}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '0.5rem 0.875rem',
                background: i === activeIndex ? 'rgba(102,126,234,0.18)' : 'transparent',
                border: 'none',
                borderBottom: i < results.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                color: '#e2e8f0',
                cursor: 'pointer',
                fontSize: '0.875rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem',
                transition: 'background 0.1s',
              }}
            >
              {opt.icon && <span style={{ fontSize: '1rem', flexShrink: 0 }}>{opt.icon}</span>}
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: i === activeIndex ? 700 : 500 }}>{opt.label}</span>
                {opt.sublabel && (
                  <span style={{ color: '#64748b', fontSize: '0.78rem', marginLeft: '0.5rem' }}>
                    {opt.sublabel}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
