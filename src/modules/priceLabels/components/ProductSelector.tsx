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
    <div ref={containerRef} className="relative">
      <label className="block text-sm font-medium text-gray-700 mb-1">Product</label>

      {value ? (
        <div className="flex items-center gap-2 p-2.5 bg-white border border-gray-300 rounded-lg shadow-sm">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-gray-900 truncate">{value.name}</div>
            <div className="text-xs text-gray-500 flex gap-3 mt-0.5">
              <span>{value.sku}</span>
              <span className="font-medium text-emerald-700">{formatPrice(value.price)}</span>
              {value.imei && <span className="text-gray-400">IMEI {value.imei}</span>}
            </div>
          </div>
          <button
            onClick={handleClear}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none p-1 rounded"
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
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white shadow-sm"
          />

          {open && (
            <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="px-4 py-3 text-sm text-gray-500">No products found</div>
              ) : (
                filtered.map(product => (
                  <button
                    key={product.id}
                    onMouseDown={() => handleSelect(product)}
                    className="w-full px-3 py-2.5 text-left hover:bg-blue-50 border-b border-gray-100 last:border-0"
                  >
                    <div className="text-sm font-medium text-gray-900 truncate">{product.name}</div>
                    <div className="text-xs text-gray-500 flex gap-3 mt-0.5">
                      <span>{product.sku}</span>
                      <span className="font-semibold text-emerald-700">{formatPrice(product.price)}</span>
                      {product.category && <span className="text-gray-400">{product.category}</span>}
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
