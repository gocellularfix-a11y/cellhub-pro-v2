import { useState, useEffect, useRef } from 'react';
import type { Product, ProductAdapter } from '../types';
import { formatPrice } from '../utils';

interface ProductSelectorProps {
  adapter: ProductAdapter;
  value: Product | null;
  onChange: (product: Product | null) => void;
}

export function ProductSelector({ adapter, value, onChange }: ProductSelectorProps) {
  const [query, setQuery] = useState('');
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [filtered, setFiltered] = useState<Product[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    adapter.getAll().then(products => {
      setAllProducts(products);
      setFiltered(products);
    });
  }, [adapter]);

  useEffect(() => {
    if (!query.trim()) {
      setFiltered(allProducts);
    } else {
      adapter.search(query).then(setFiltered);
    }
  }, [query, allProducts, adapter]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function handleSelect(product: Product) {
    onChange(product);
    setQuery('');
    setOpen(false);
  }

  function handleClear() {
    onChange(null);
    setQuery('');
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
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
        Product
      </label>

      {value ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.6rem 0.75rem',
            background: '#0a1120',
            border: '1px solid rgba(56,189,248,0.25)',
            borderRadius: '10px',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: '0.8rem',
                fontWeight: 600,
                color: '#e2e8f0',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {value.name}
            </div>
            <div
              style={{
                fontSize: '0.7rem',
                color: '#475569',
                display: 'flex',
                gap: '0.75rem',
                marginTop: '0.2rem',
              }}
            >
              <span>{value.sku}</span>
              <span style={{ fontWeight: 600, color: '#10b981' }}>{formatPrice(value.price)}</span>
              {value.imei && <span style={{ color: '#334155' }}>IMEI {value.imei}</span>}
            </div>
          </div>
          <button
            onClick={handleClear}
            style={{
              color: '#475569',
              fontSize: '1.1rem',
              lineHeight: 1,
              padding: '0.25rem',
              borderRadius: '6px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
            }}
            aria-label="Clear selection"
          >
            ×
          </button>
        </div>
      ) : (
        <div>
          <input
            type="text"
            placeholder="Search by name, SKU, IMEI, or barcode…"
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            style={{
              width: '100%',
              padding: '0.6rem 0.75rem',
              border: '1px solid rgba(148,163,184,0.15)',
              borderRadius: '10px',
              fontSize: '0.8rem',
              background: '#0a1120',
              color: '#e2e8f0',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />

          {open && (
            <div
              style={{
                position: 'absolute',
                zIndex: 50,
                marginTop: '0.25rem',
                width: '100%',
                background: '#0e1525',
                border: '1px solid rgba(148,163,184,0.12)',
                borderRadius: '10px',
                boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                maxHeight: '15rem',
                overflowY: 'auto',
              }}
            >
              {filtered.length === 0 ? (
                <div style={{ padding: '0.75rem 1rem', fontSize: '0.8rem', color: '#475569' }}>
                  No products found
                </div>
              ) : (
                filtered.map(product => (
                  <button
                    key={product.id}
                    onMouseDown={() => handleSelect(product)}
                    style={{
                      width: '100%',
                      padding: '0.6rem 0.75rem',
                      textAlign: 'left',
                      background: 'none',
                      border: 'none',
                      borderBottom: '1px solid rgba(148,163,184,0.06)',
                      cursor: 'pointer',
                      display: 'block',
                    }}
                  >
                    <div
                      style={{
                        fontSize: '0.8rem',
                        fontWeight: 500,
                        color: '#cbd5e1',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {product.name}
                    </div>
                    <div
                      style={{
                        fontSize: '0.7rem',
                        color: '#475569',
                        display: 'flex',
                        gap: '0.75rem',
                        marginTop: '0.15rem',
                      }}
                    >
                      <span>{product.sku}</span>
                      <span style={{ fontWeight: 600, color: '#10b981' }}>{formatPrice(product.price)}</span>
                      {product.category && <span style={{ color: '#334155' }}>{product.category}</span>}
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
