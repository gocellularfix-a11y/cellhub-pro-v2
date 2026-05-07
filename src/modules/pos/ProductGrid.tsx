// ============================================================
// CellHub Pro — Product Grid (category item browser)
// ============================================================

import { useState, useMemo } from 'react';
import { SearchInput } from '@/components/ui';
import type { InventoryItem } from '@/store/types';
import { formatCurrency } from '@/utils/currency';

interface ProductGridProps {
  title: string;
  subtitle: string;
  items: InventoryItem[];
  lang: string;
  L: Record<string, any>;
  onAddToCart: (item: InventoryItem) => void;
  onBack: () => void;
  /** R-POS-POSTSALE-FOCUS-RETURN-FLOW-V1: auto-focus the category search
   *  input on mount so the cashier can start typing immediately when
   *  opening Accessories / Phones / etc. Default true. */
  autoFocus?: boolean;
}

export default function ProductGrid({
  title,
  subtitle,
  items,
  lang,
  L,
  onAddToCart,
  onBack,
  autoFocus = true,
}: ProductGridProps) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        i.sku?.toLowerCase().includes(q) ||
        i.barcode?.toLowerCase().includes(q) ||
        i.imei?.toLowerCase().includes(q),
    );
  }, [items, search]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold text-white">{title}</h2>
          <p className="text-sm text-slate-400 mt-0.5">{subtitle}</p>
        </div>
        <div className="flex gap-3">
          <button onClick={onBack} className="btn btn-secondary btn-sm">
            ← {L.backToCategories}
          </button>
        </div>
      </div>

      {/* Search */}
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder={L.searchItems || 'Search items…'}
        className="mb-4"
        autoFocus={autoFocus}
      />

      {/* Grid */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-500">
            <span className="text-5xl mb-4">🔍</span>
            <p className="font-medium">{L.noResultsFound || 'No results found'}</p>
            <p className="text-sm mt-1">{L.tryDifferentSearch || 'Try a different search term'}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((item) => (
              <button
                key={item.id}
                onClick={() => onAddToCart(item)}
                className="glass-card p-5 flex flex-col items-center text-center
                           hover:bg-white/10 transition-all duration-200 cursor-pointer"
              >
                {/* Icon */}
                <div className="w-[80px] h-[80px] rounded-full bg-gradient-to-br from-purple-500/20 to-purple-700/10
                              border-2 border-purple-500/30 flex items-center justify-center text-3xl mb-3">
                  {(item.category || '').toLowerCase().startsWith('phone') ? '📱' :
                   (item.category || '').toLowerCase().startsWith('accessor') ? '🎧' :
                   (item.category || '').toLowerCase().startsWith('part') ? '🔩' :
                   (item.category || '').toLowerCase().startsWith('service') ? '🔧' : '📦'}
                </div>

                {/* Name */}
                <p className="text-sm font-bold text-white mb-1 line-clamp-2 leading-tight">
                  {item.name}
                </p>

                {/* SKU */}
                {item.sku && (
                  <p className="text-xs text-slate-500 mb-2">{item.sku}</p>
                )}

                {/* Price */}
                <p className="text-lg font-bold text-emerald-400 mb-1">
                  {formatCurrency(item.price)}
                </p>

                {/* Stock */}
                <p className={`text-xs ${item.qty <= 0 ? 'text-red-400' : 'text-slate-500'}`}>
                  {item.qty <= 0 ? (L.outOfStock || 'Out of stock') : `${item.qty} in stock`}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
