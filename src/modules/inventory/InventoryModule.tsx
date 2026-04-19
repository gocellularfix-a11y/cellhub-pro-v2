// ============================================================
// CellHub Pro — Inventory Module
// ============================================================

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useApp } from '@/store/AppProvider';
import { useToast } from '@/components/ui/Toast';
import { useHighlightRecord } from '@/hooks/useHighlightRecord';
import { Modal, ConfirmDialog } from '@/components/ui';
import GlobalSearchBar from '@/components/shared/GlobalSearchBar';
import { getLabels } from '@/config/i18n';
import { formatCurrency } from '@/utils/currency';
import { matchesSearch } from '@/utils/fuzzyMatch';
import { generateId } from '@/utils/dates';
import { usePrint, openPrintWindow } from '@/hooks/usePrint';
import JsBarcode from 'jsbarcode';
import type { InventoryItem, Sale } from '@/store/types';
import { persist, persistSettings, remove } from '@/services/persist';
import { DEFAULT_LOW_STOCK_THRESHOLD } from '@/config/constants';
import FieldCustomizerModal, { resolveFieldConfig, isFieldVisible, isFieldRequired } from './FieldCustomizerModal';

export default function InventoryModule() {
  const {
    state: { inventory, sales, settings, lang, cart, inventorySearchTerm },
    setInventory, setCart, dispatch,
  } = useApp();

  const { toast } = useToast();
  const { highlightRef, isHighlighted } = useHighlightRecord<HTMLTableRowElement>();
  const { printHtml } = usePrint();
  const L = getLabels(lang);

  const [search, setSearch] = useState(inventorySearchTerm || '');

  // Consume cross-module search term once on mount
  useEffect(() => {
    if (inventorySearchTerm) {
      setSearch(inventorySearchTerm);
      dispatch({ type: 'SET_INVENTORY_SEARCH', payload: '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [filterCategory, setFilterCategory] = useState('All');
  const [filterCondition, setFilterCondition] = useState('All');
  const [showLowStockOnly, setShowLowStockOnly] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [showFieldCustomizer, setShowFieldCustomizer] = useState(false);

  // Resolve field config (with defaults) for use throughout the module
  const fieldConfig = useMemo(
    () => resolveFieldConfig(settings.inventoryFieldConfig),
    [settings.inventoryFieldConfig],
  );

  // ── Categories from data ────────────────────────────────
  // Normalize plural/case variants so "Phone"/"Phones" merge into one tab
  const normCat = (c: string): string => {
    const lc = c.toLowerCase().trim();
    if (lc === 'phone') return 'phones';
    if (lc === 'accessories') return 'accessory';
    if (lc === 'services') return 'service';
    if (lc === 'parts') return 'part';
    return lc || c;
  };
  const categories = useMemo(() => {
    const seen = new Map<string, string>();
    for (const i of inventory) {
      const cat = (i.category || '').trim();
      if (!cat) continue;
      const key = normCat(cat);
      if (!seen.has(key)) seen.set(key, key.charAt(0).toUpperCase() + key.slice(1));
    }
    return ['All', ...Array.from(seen.values()).sort((a, b) => a.localeCompare(b, lang === 'es' ? 'es' : 'en'))];
  }, [inventory, lang]);

  // ── Conditions from data (plus static defaults) ─────────
  const conditions = useMemo(() => {
    // Case-insensitive dedup, mirroring `categories` above. Defaults are seeded
    // first so 'New' (capital) wins over a stray 'new' lowercase from data.
    const seen = new Map<string, string>();
    const defaults = ['New', 'Excellent', 'Good', 'Fair', 'Refurbished', 'For Parts'];
    defaults.forEach((d) => seen.set(d.toLowerCase(), d));
    for (const i of inventory) {
      const cond = (i.condition || '').trim();
      if (!cond) continue;
      const key = cond.toLowerCase();
      if (!seen.has(key)) seen.set(key, cond);
    }
    return ['All', ...Array.from(seen.values()).sort((a, b) => a.localeCompare(b, lang === 'es' ? 'es' : 'en'))];
  }, [inventory, lang]);

  // ── Filtered list ───────────────────────────────────────
  const filtered = useMemo(() => {
    return inventory
      .filter((item) => {
        if (filterCategory !== 'All' && (item.category || '').toLowerCase() !== filterCategory.toLowerCase()) return false;
        if (filterCondition !== 'All' && (item.condition || '').toLowerCase() !== filterCondition.toLowerCase()) return false;
        if (showLowStockOnly && item.qty > (settings.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD)) return false;
        return matchesSearch(search, item.name, item.sku, item.barcode, item.imei, item.category);
      })
      .sort((a, b) => a.name.localeCompare(b.name, lang === 'es' ? 'es' : 'en'));
  }, [inventory, filterCategory, filterCondition, showLowStockOnly, search, settings.lowStockThreshold, lang]);

  // ── Stats ───────────────────────────────────────────────
  // Negative qty (oversells / data corruption) are clamped to 0 so they don't
  // deflate inventory value reports. Surfacing those is a separate concern.
  const totalValue = useMemo(
    () => inventory.reduce((sum, i) => sum + (i.price || 0) * Math.max(0, i.qty), 0), [inventory],
  );
  const totalCost = useMemo(
    () => inventory.reduce((sum, i) => sum + (i.cost || 0) * Math.max(0, i.qty), 0), [inventory],
  );
  const isServiceCategory = (cat: string) => {
    const c = (cat || '').toLowerCase();
    return c === 'service' || c === 'services' || c === 'servicio' || c === 'servicios';
  };
  // Single source of truth for the low-stock threshold default — shared with Dashboard
  // and any other module that filters low-stock items.
  const lowStockThreshold = settings.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
  const lowStockCount = useMemo(
    () => inventory.filter((i) => i.qty >= 0 && i.qty <= lowStockThreshold && !isServiceCategory(i.category)).length,
    [inventory, lowStockThreshold],
  );
  const outOfStockCount = useMemo(
    () => inventory.filter((i) => i.qty <= 0 && !isServiceCategory(i.category)).length, [inventory],
  );

  // Ref to always-current inventory snapshot. Closures in handleSave/handleDelete/etc
  // capture `inventory` from the render that defined them, so rapid successive calls
  // (batch mode loop, double-clicks, imports) overwrite each other. The ref bypasses that.
  const inventoryRef = useRef(inventory);
  useEffect(() => { inventoryRef.current = inventory; }, [inventory]);

  // ── CRUD ────────────────────────────────────────────────
  const handleSave = useCallback(
    (data: Partial<InventoryItem>, opts?: { skipMerge?: boolean }) => {
      const current = inventoryRef.current;
      if (editItem) {
        // ── IMEI guard: don't let an empty form value wipe an existing IMEI ──
        // (happens if FieldCustomizer hides the SKU/IMEI field while editing a phone)
        const safeData = { ...data };
        if (editItem.imei && !(safeData.imei || '').trim()) {
          delete safeData.imei;
        }
        // r-audit-r3: sanitize money fields — prevent NaN/undefined from persisting.
        // Closes the door on $NaN display bugs regardless of data source.
        if (safeData.price !== undefined) safeData.price = Number(safeData.price) || 0;
        if (safeData.cost !== undefined) safeData.cost = Number(safeData.cost) || 0;
        const updatedItem = { ...editItem, ...safeData, updatedAt: new Date().toISOString() };
        const next = current.map((i) => i.id === editItem.id ? updatedItem : i);
        inventoryRef.current = next;  // immediately update ref so next call sees it
        setInventory(next);
        persist.inventory(updatedItem.id, updatedItem as unknown as Record<string, unknown>);
        toast(L.saved || 'Saved!', 'success');
        setShowModal(false);
        setEditItem(null);
      } else {
        // ── Duplicate SKU check: skip in batch mode (caller passes skipMerge:true) ──
        const incomingSku = (data.sku || '').trim().toLowerCase();
        const existingMatch = !opts?.skipMerge && incomingSku
          ? current.find((i) => (i.sku || '').trim().toLowerCase() === incomingSku)
          : null;

        // ── IMEI guard: same SKU but different IMEI = different physical phone, do NOT merge ──
        let existing = existingMatch;
        if (existingMatch) {
          const incomingImei = (data.imei || '').trim();
          const existingImei = (existingMatch.imei || '').trim();
          if (incomingImei && existingImei && incomingImei !== existingImei) {
            existing = null; // fall through to "create new item" branch
            toast(
              lang === 'es'
                ? 'SKU existe pero IMEI diferente — creando item nuevo'
                : 'SKU exists but IMEI differs — creating new item',
              'info',
            );
          }
        }

        if (existing) {
          const addedQty = data.qty ?? 0;
          // Only merge qty into existing — do NOT overwrite name/cost/price/category etc.
          // Otherwise creating a new "iPhone 14 — $500 SKU ABC" silently rewrites
          // the existing "iPhone 12 — $300 SKU ABC". Data loss.
          const mergedItem: InventoryItem = {
            ...existing,
            qty: (existing.qty || 0) + addedQty,
            updatedAt: new Date().toISOString(),
          };
          const next = current.map((i) => i.id === existing.id ? mergedItem : i);
          inventoryRef.current = next;
          setInventory(next);
          persist.inventory(mergedItem.id, mergedItem as unknown as Record<string, unknown>);
          toast(
            lang === 'es'
              ? `+${addedQty} agregado a ${existing.name} (total: ${mergedItem.qty})`
              : `+${addedQty} added to ${existing.name} (total: ${mergedItem.qty})`,
            'success',
          );
          return;
        }

        // r-audit-r3: sanitize money fields on new items too.
        const sanitized = { ...data };
        if (sanitized.price !== undefined) sanitized.price = Number(sanitized.price) || 0;
        if (sanitized.cost !== undefined) sanitized.cost = Number(sanitized.cost) || 0;
        const newItem: InventoryItem = {
          id: generateId(),
          sku: '',
          name: '',
          category: 'accessory',
          cost: 0,
          price: 0,
          qty: 1,
          cbeEligible: false,
          taxable: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          ...sanitized,
        } as InventoryItem;
        const next = [...current, newItem];
        inventoryRef.current = next;
        setInventory(next);
        persist.inventory(newItem.id, newItem as unknown as Record<string, unknown>);
        toast(lang === 'es' ? 'Artículo agregado' : 'Item added!', 'success');
        // Keep modal open for adding more items
      }
    },
    [editItem, setInventory, toast, lang, L],
  );

  const handleDelete = useCallback(
    (id: string) => {
      const next = inventoryRef.current.filter((i) => i.id !== id);
      inventoryRef.current = next;
      setInventory(next);
      remove.inventory(id);
      toast(lang === 'es' ? 'Eliminado' : 'Deleted', 'info');
      setDeleteConfirm(null);
    },
    [setInventory, toast, lang],
  );

  const handleQuickRestock = useCallback(
    (id: string) => {
      const target = inventoryRef.current.find((i) => i.id === id);
      if (target && isServiceCategory(target.category)) {
        toast(lang === 'es' ? 'Los servicios no tienen stock' : "Services don't have stock", 'warning');
        return;
      }
      const next = inventoryRef.current.map((i) => i.id === id ? { ...i, qty: i.qty + 1 } : i);
      inventoryRef.current = next;
      setInventory(next);
      const ri = next.find((i) => i.id === id);
      if (ri) persist.inventory(ri.id, ri as unknown as Record<string, unknown>);
      toast('+1 stock', 'success');
    },
    [setInventory, toast, lang],
  );

  const addToCart = useCallback(
    (item: InventoryItem) => {
      // Use isServiceCategory so Spanish-tagged "servicio" items can also be sold OOS
      if (item.qty <= 0 && !isServiceCategory(item.category)) {
        toast(L.notEnoughStock || 'Out of stock', 'warning');
        return;
      }
      const cartItem = {
        id: generateId(), inventoryId: item.id, name: item.name, sku: item.sku,
        category: item.category, price: item.price, cost: item.cost, qty: 1,
        taxable: item.taxable, cbeEligible: item.cbeEligible,
        screenFeeEligible: item.screenFeeEligible,
        imei: item.imei, barcode: item.barcode,
        notes: '',
      };
      setCart([...cart, cartItem]);
      toast(`${item.name} → cart`, 'success');
    },
    [cart, setCart, toast, L],
  );

  return (
    <>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">📦 {L.inventory}</h1>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={() => setShowFieldCustomizer(true)}
              className="btn btn-secondary"
              title={lang === 'es' ? 'Personalizar campos del formulario' : 'Customize form fields'}
            >
              ⚙️ {lang === 'es' ? 'Campos' : 'Fields'}
            </button>
            <button
              onClick={() => { setEditItem(null); setShowModal(true); }}
              className="btn btn-primary"
            >
              + {L.add || 'Add Item'}
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="stat-card">
            <p className="text-xs text-slate-400 uppercase">Total Items</p>
            <p className="text-2xl font-bold text-white mt-1">{inventory.length}</p>
          </div>
          <div className="stat-card">
            <p className="text-xs text-slate-400 uppercase">Retail Value</p>
            <p className="text-2xl font-bold text-emerald-400 mt-1">{formatCurrency(totalValue)}</p>
          </div>
          <div className="stat-card">
            <p className="text-xs text-slate-400 uppercase">Profit Potential</p>
            <p className="text-2xl font-bold text-blue-400 mt-1">{formatCurrency(totalValue - totalCost)}</p>
          </div>
          <div className="stat-card">
            <p className="text-xs text-slate-400 uppercase">{L.lowStock}</p>
            <p className={`text-2xl font-bold mt-1 ${lowStockCount > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
              {lowStockCount}
            </p>
            <p className="text-xs text-slate-500">{outOfStockCount} out of stock</p>
          </div>
        </div>

        {/* Reorder List — shown when there are low/out of stock items */}
        {lowStockCount > 0 && (() => {
          const reorderItems = inventory
            .filter((i) => i.qty <= lowStockThreshold && !isServiceCategory(i.category))
            .sort((a, b) => a.qty - b.qty);
          const listText = reorderItems
            .map((i) => `${i.name}${i.supplier ? ` (${i.supplier})` : ''} — Qty: ${i.qty} → Reorder: ${Math.max(5, lowStockThreshold * 3)}`)
            .join('\n');
          return (
            <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '0.75rem', padding: '0.875rem 1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f87171' }}>
                  🛒 {lang === 'es' ? `Lista de reorden — ${reorderItems.length} item${reorderItems.length > 1 ? 's' : ''}` : `Reorder list — ${reorderItems.length} item${reorderItems.length > 1 ? 's' : ''}`}
                </span>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={() => navigator.clipboard.writeText(listText)}
                    style={{ fontSize: '0.72rem', padding: '0.25rem 0.6rem', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '0.375rem', color: '#94a3b8', cursor: 'pointer' }}
                  >
                    📋 {lang === 'es' ? 'Copiar lista' : 'Copy list'}
                  </button>
                  <button
                    onClick={() => {
                      // HTML-escape stored item names/suppliers before injecting into popup HTML
                      const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({
                        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
                      }[c] as string));
                      openPrintWindow(`<html><body style="font-family:monospace;padding:1rem"><h2>Reorder List — ${new Date().toLocaleDateString()}</h2><pre>${esc(listText)}</pre></body></html>`);
                    }}
                    style={{ fontSize: '0.72rem', padding: '0.25rem 0.6rem', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '0.375rem', color: '#94a3b8', cursor: 'pointer' }}
                  >
                    🖨️ {lang === 'es' ? 'Imprimir' : 'Print'}
                  </button>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.4rem' }}>
                {reorderItems.slice(0, 12).map((item) => (
                  <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.35rem 0.6rem', background: 'rgba(255,255,255,0.04)', borderRadius: '0.375rem', fontSize: '0.75rem' }}>
                    <div style={{ overflow: 'hidden' }}>
                      <div style={{ color: '#e2e8f0', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                      {item.supplier && <div style={{ color: '#64748b', fontSize: '0.68rem' }}>{item.supplier}</div>}
                    </div>
                    <span style={{ color: item.qty === 0 ? '#f87171' : '#fbbf24', fontWeight: 700, flexShrink: 0, marginLeft: '0.5rem' }}>
                      {item.qty === 0 ? '0 ⚠' : item.qty}
                    </span>
                  </div>
                ))}
                {reorderItems.length > 12 && (
                  <div style={{ color: '#64748b', fontSize: '0.72rem', padding: '0.35rem 0.6rem' }}>
                    + {reorderItems.length - 12} {lang === 'es' ? 'más' : 'more'} — {lang === 'es' ? 'activar filtro "Stock Bajo"' : 'enable Low Stock filter to see all'}
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* Filters */}
        <div className="flex gap-2 flex-wrap items-center">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setFilterCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                filterCategory === cat
                  ? 'bg-brand-500 text-white'
                  : 'bg-white/5 text-slate-400 hover:bg-white/10'
              }`}
            >
              {cat}
            </button>
          ))}
          <select
            value={filterCondition}
            onChange={(e) => setFilterCondition(e.target.value)}
            className="ml-2 px-2 py-1 rounded-lg text-xs bg-white/5 text-slate-300 border border-white/10"
            title={lang === 'es' ? 'Filtrar por condición' : 'Filter by condition'}
          >
            {conditions.map((c) => (
              <option key={c} value={c}>
                {c === 'All' ? (lang === 'es' ? 'Todas las Condiciones' : 'All Conditions') : c}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-slate-400 ml-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showLowStockOnly}
              onChange={(e) => setShowLowStockOnly(e.target.checked)}
              className="rounded border-white/20 bg-white/5"
            />
            {L.lowStock || 'Low Stock Only'}
          </label>
        </div>

        {/* r-global-search: GlobalSearchBar in SYNCED mode — sends keystrokes
            to local `search` state (which still drives the filtered list memo
            below) AND opens the global dropdown above other modules.
            excludeCollection='inventory' hides the redundant inventory
            section in the dropdown since the local list already shows it. */}
        <GlobalSearchBar
          localValue={search}
          onLocalChange={setSearch}
          excludeCollection="inventory"
          placeholder={L.searchPlaceholder || 'Search inventory…'}
        />

        {/* Table */}
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>SKU/IMEI</th>
                <th>{L.name || 'Name'}</th>
                <th>Category</th>
                <th className="text-right">Cost</th>
                <th className="text-right">Price</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-slate-500">
                    {L.noResultsFound || 'No items found'}
                  </td>
                </tr>
              ) : (
                filtered.map((item) => (
                  <tr key={item.id}
                    ref={isHighlighted(item.id) ? highlightRef : null}
                    style={isHighlighted(item.id) ? { outline: '2px solid #667eea', background: 'rgba(102,126,234,0.08)' } : undefined}>
                    <td className="font-mono text-xs text-slate-500">{item.sku || item.imei || '—'}</td>
                    <td>
                      <p className="text-sm text-white font-medium">{item.name}</p>
                      {item.description && <p className="text-xs text-slate-500">{item.description}</p>}
                    </td>
                    <td><span className="badge badge-neutral">{item.category}</span></td>
                    <td className="text-right text-sm text-slate-400">{formatCurrency(item.cost)}</td>
                    <td className="text-right text-sm text-emerald-400 font-medium">{formatCurrency(item.price)}</td>
                    <td className="text-right">
                      <span className={`text-sm font-medium ${item.qty <= 0 ? 'text-red-400' : item.qty <= lowStockThreshold ? 'text-amber-400' : 'text-white'}`}>
                        {item.qty}
                      </span>
                    </td>
                    <td className="text-right">
                      <div className="flex gap-1.5 justify-end">
                        <button onClick={() => addToCart(item)} title="Add to cart" style={{ width: '2rem', height: '2rem', borderRadius: '0.375rem', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem', background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>🛒</button>
                        <button onClick={() => handleQuickRestock(item.id)} title="+1 stock" style={{ width: '2rem', height: '2rem', borderRadius: '0.375rem', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, background: 'rgba(59,130,246,0.15)', color: '#3b82f6' }}>+1</button>
                        <button onClick={() => { setEditItem(item); setShowModal(true); }} title="Edit" style={{ width: '2rem', height: '2rem', borderRadius: '0.375rem', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem', background: 'rgba(168,85,247,0.15)', color: '#a855f7' }}>✏️</button>
                        <button onClick={() => setDeleteConfirm(item.id)} title="Delete" style={{ width: '2rem', height: '2rem', borderRadius: '0.375rem', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem', background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}>🗑️</button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <InventoryFormModal
          item={editItem}
          categories={categories.filter((c) => c !== 'All')}
          allInventory={inventory}
          allSales={sales}
          fieldConfig={fieldConfig}
          onAddCategory={(newCat) => {
            toast(
              (lang === 'es' ? 'Nueva categoría: ' : 'New category: ') + newCat,
              'success',
            );
          }}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditItem(null); }}
          lang={lang}
          L={L}
          settings={settings}
        />
      )}

      {/* Field Customizer Modal */}
      <FieldCustomizerModal
        open={showFieldCustomizer}
        onClose={() => setShowFieldCustomizer(false)}
        config={fieldConfig}
        lang={lang}
        onSave={(newConfig) => {
          const updatedSettings = { ...settings, inventoryFieldConfig: newConfig };
          dispatch({ type: 'SET_SETTINGS', payload: { inventoryFieldConfig: newConfig } });
          // Persist to Firebase/localStorage
          persistSettings(updatedSettings as unknown as Record<string, unknown>);
          toast(
            lang === 'es' ? '⚙️ Campos actualizados' : '⚙️ Fields updated',
            'success',
          );
        }}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteConfirm}
        title={L.delete || 'Delete'}
        message={L.deleteConfirm || 'Delete this item?'}
        variant="danger"
        onConfirm={() => deleteConfirm && handleDelete(deleteConfirm)}
        onCancel={() => setDeleteConfirm(null)}
      />
    </>
  );
}

// ── Inventory Form Modal ──────────────────────────────────

function InventoryFormModal({
  item,
  categories,
  allInventory,
  allSales,
  fieldConfig,
  onAddCategory,
  onSave,
  onClose,
  lang,
  L,
  settings,
}: {
  item: InventoryItem | null;
  categories: string[];
  allInventory: InventoryItem[];
  allSales: Sale[];
  fieldConfig: import('@/store/types').InventoryFieldConfig;
  onAddCategory: (newCat: string) => void;
  onSave: (data: Partial<InventoryItem>, opts?: { skipMerge?: boolean }) => void;
  onClose: () => void;
  lang: string;
  L: Record<string, any>;
  settings: { detectedPrinters?: string[] };
}) {
  const es = lang === 'es';
  const isEdit = !!item;
  const { toast } = useToast();
  const { printHtml } = usePrint();
  const [zeroPriceConfirm, setZeroPriceConfirm] = useState(false);

  const [form, setForm] = useState({
    sku:               item?.sku || '',
    imei:              item?.imei || '',
    barcode:           item?.barcode || '',
    name:              item?.name || '',
    description:       item?.description || '',
    category:          item?.category || 'accessory',
    condition:         item?.condition || 'New',
    cost:              item?.cost || 0,
    price:             item?.price || 0,
    qty:               item?.qty ?? 1,
    supplier:          item?.supplier || '',
    brand:             item?.brand || '',
    taxable:           item?.taxable ?? true,
    cbeEligible:       item?.cbeEligible ?? false,
    screenFeeEligible: item?.screenFeeEligible ?? false,
    customFields:      (item?.customFields as Record<string, string | number>) || {},
  });

  // ── Field visibility/required helpers (from config) ────
  const show = (id: 'sku' | 'category' | 'condition' | 'cost' | 'price' | 'qty' | 'supplier' | 'brand' | 'description') =>
    isFieldVisible(fieldConfig, id);
  const req = (id: 'sku' | 'category' | 'condition' | 'cost' | 'price' | 'qty' | 'supplier' | 'brand' | 'description') =>
    isFieldRequired(fieldConfig, id);

  const updateCustomField = (fieldId: string, value: string | number) => {
    setForm((prev) => ({
      ...prev,
      customFields: { ...prev.customFields, [fieldId]: value },
    }));
  };

  const [batchMode, setBatchMode] = useState(false);
  const [batchCount, setBatchCount] = useState(1);

  // ── Duplicate SKU detection ────────────────────────────
  const [duplicateItem, setDuplicateItem] = useState<InventoryItem | null>(null);
  const isDuplicate = !!duplicateItem;

  const checkDuplicate = useCallback((sku: string) => {
    if (!sku || isEdit) {
      setDuplicateItem(null);
      return;
    }
    const existing = allInventory.find(
      (i) => i.sku && i.sku.toLowerCase() === sku.toLowerCase(),
    );
    // Only flag the duplicate — DO NOT auto-overwrite form fields.
    // Auto-fill destroyed user input silently. The banner shown below tells the
    // user what's about to happen on save (qty merge); they can change SKU if
    // they actually meant a different item.
    setDuplicateItem(existing || null);
  }, [allInventory, isEdit]);

  // ── Autocomplete suggestions (name, supplier, brand) ───
  const autocompletePool = useMemo(() => ({
    names:     Array.from(new Set(allInventory.map((i) => i.name).filter((v): v is string => !!v))),
    suppliers: Array.from(new Set(allInventory.map((i) => i.supplier).filter((v): v is string => !!v))),
    brands:    Array.from(new Set(allInventory.map((i) => i.brand).filter((v): v is string => !!v))),
  }), [allInventory]);

  const [activeSuggestField, setActiveSuggestField] = useState<'name' | 'supplier' | 'brand' | null>(null);

  const suggestionsForField = (field: 'name' | 'supplier' | 'brand', value: string): string[] => {
    if (!value || value.length < 1) return [];
    const pool = field === 'name' ? autocompletePool.names
               : field === 'supplier' ? autocompletePool.suppliers
               : autocompletePool.brands;
    const lower = value.toLowerCase();
    return pool
      .filter((v) => v.toLowerCase().startsWith(lower) && v.toLowerCase() !== lower)
      .slice(0, 5);
  };

  // ── Price History lookup from past sales ──────────────
  interface PriceHistoryEntry {
    date: string;
    price: number; // cents
    cost: number;  // cents
    qty: number;
    customerName: string;
  }
  const priceHistory: PriceHistoryEntry[] = useMemo(() => {
    if (!form.name || form.name.trim().length < 3) return [];
    const nameLower = form.name.trim().toLowerCase();
    const matches: PriceHistoryEntry[] = [];
    for (const sale of allSales) {
      if (!Array.isArray(sale.items)) continue;
      for (const saleItem of sale.items) {
        if (!saleItem.name) continue;
        const itemLower = saleItem.name.toLowerCase();
        // Forward match only: the sold item name must contain what the user typed.
        // Reverse match (typed name contains sold name) was pulling unrelated short
        // names like "iPhone" into "iPhone 15 Pro Max" history.
        if (itemLower.includes(nameLower)) {
          matches.push({
            date: typeof sale.createdAt === 'string' ? sale.createdAt : new Date(sale.createdAt as any).toISOString(),
            price: saleItem.price || 0,
            cost: saleItem.cost || 0,
            qty: saleItem.qty || 1,
            customerName: sale.customerName || (es ? 'Walk-in' : 'Walk-in'),
          });
        }
      }
    }
    matches.sort((a, b) => b.date.localeCompare(a.date));
    return matches.slice(0, 8);
  }, [form.name, allSales, es]);

  // ── Add Category inline ────────────────────────────────
  const [showAddCat, setShowAddCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const handleAddCategoryInline = () => {
    const trimmed = newCatName.trim();
    if (!trimmed) return;
    setForm({ ...form, category: trimmed });
    onAddCategory(trimmed);
    setShowAddCat(false);
    setNewCatName('');
  };

  // Auto-generate SKU
  const handleGenerate = () => {
    const prefix = form.category === 'phone' ? 'PH' : form.category === 'accessory' ? 'AC' : 'IT';
    const sku = `${prefix}-${Date.now().toString().slice(-6)}`;
    setForm({ ...form, sku });
  };

  // Print label — HTML window.print() in both Electron and browser.
  // (Native thermal label printing is not wired yet; deferred from r-pathB.)
  const handleLabel = () => {
    const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c] as string));
    const code = esc(form.sku || form.imei || form.barcode || form.name.slice(0, 12));
    const price = formatCurrency(form.price);
    const name = esc(form.name);

    // Generate barcode SVG using JsBarcode (already bundled via npm)
    let barcodeSvg = '';
    try {
      const svgNode = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      JsBarcode(svgNode, code.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'), {
        format: 'CODE128',
        displayValue: false,
        width: 1.5,
        height: 30,
        margin: 0,
      });
      barcodeSvg = svgNode.outerHTML;
    } catch {
      // Barcode generation failed — print without it
    }

    const html = `<!DOCTYPE html><html><head><title>Label</title><style>
      @page { size: 2.25in 1.25in landscape; margin: 0; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        width: 2.25in; height: 1.25in; margin: 0;
        padding: 0.05in 0.1in; padding-top: 0.15in;
        font-family: Arial, sans-serif;
        display: flex; flex-direction: column;
        justify-content: center; align-items: center;
        background: white;
      }
      .price { font-size: 20pt; font-weight: 800; text-align: center; margin-bottom: 1px; line-height: 1; }
      .name { font-size: 8pt; font-weight: 700; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 2in; margin-bottom: 1px; line-height: 1.1; }
      svg { display: block; margin: 1px auto 0; max-width: 1.8in; }
      .code { font-size: 7pt; text-align: center; margin-top: 1px; }
      @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    </style></head><body>
      <div class="price">${price}</div>
      <div class="name">${name}</div>
      ${barcodeSvg}
      <div class="code">${code}</div>
    </body></html>`;

    printHtml(html, { silent: false, printer: settings.detectedPrinters?.[0] });
  };

  const isServiceLikeCategory = (cat: string) => {
    const c = (cat || '').toLowerCase();
    return c === 'service' || c === 'services' || c === 'servicio' || c === 'servicios';
  };

  const doSubmit = () => {
    if (batchMode && batchCount > 1) {
      // Find max existing suffix for this SKU prefix to avoid collisions on re-run.
      // E.g. if "ABC-1", "ABC-2", "ABC-3" already exist, start the new batch at "ABC-4".
      let startIdx = 1;
      if (form.sku) {
        const escaped = form.sku.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`^${escaped}-(\\d+)$`, 'i');
        const max = allInventory.reduce((m, it) => {
          const match = (it.sku || '').match(re);
          return match ? Math.max(m, parseInt(match[1], 10)) : m;
        }, 0);
        startIdx = max + 1;
      }
      // Batch: create N distinct items, qty=1 each (UI clarifies this).
      // skipMerge prevents accidental merging into existing SKU on subsequent iterations.
      for (let i = 0; i < batchCount; i++) {
        onSave({
          ...form,
          sku: form.sku ? `${form.sku}-${startIdx + i}` : '',
          qty: 1,
        } as Partial<InventoryItem>, { skipMerge: true });
      }
    } else {
      onSave(form as Partial<InventoryItem>);
    }
    if (!isEdit) {
      setForm({ ...form, sku: '', imei: '', barcode: '', name: '', description: '', qty: 1, customFields: {} });
    }
  };

  const handleSubmit = () => {
    if (!form.name.trim()) {
      toast(es ? 'Falta el nombre del artículo' : 'Item name is required', 'error');
      return;
    }
    if (form.price <= 0 && !isServiceLikeCategory(form.category)) {
      setZeroPriceConfirm(true);
      return;
    }
    doSubmit();
  };

  const marginDollars = form.price - form.cost;
  const marginPct = form.cost > 0 && form.price > 0 ? ((1 - form.cost / form.price) * 100).toFixed(1) : null;
  const isLoss = form.cost > 0 && form.price > 0 && form.cost > form.price;

  const CATEGORIES = [
    { value: 'phone',     label: es ? 'Teléfonos' : 'Phones' },
    { value: 'accessory', label: es ? 'Accesorios' : 'Accessories' },
    { value: 'part',      label: es ? 'Partes' : 'Parts' },
    { value: 'service',   label: es ? 'Servicios' : 'Services' },
    { value: 'top_up',    label: es ? 'Top Up' : 'Top Up' },
    { value: 'other',     label: es ? 'Otro' : 'Other' },
  ];

  const CONDITIONS = ['New', 'Excellent', 'Good', 'Fair', 'Refurbished', 'For Parts'];

  return (
    <>
    <Modal
      open
      onClose={onClose}
      title={isEdit ? `✏️ ${es ? 'Editar Artículo' : 'Edit Item'}` : `📦 ${es ? 'Nuevo Artículo' : 'New Item'}`}
      size="max-w-lg"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem', maxHeight: '68vh', overflowY: 'auto', paddingRight: '2px' }}>

        {/* SKU + Generate + Label */}
        {show('sku') && (
        <div>
          <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>
            SKU{req('sku') && ' *'}
          </label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              className="input"
              style={{ flex: 1 }}
              placeholder="SKU"
              value={form.sku}
              onChange={(e) => {
                const v = e.target.value;
                setForm({ ...form, sku: v });
                checkDuplicate(v);
              }}
            />
            <button
              onClick={handleGenerate}
              style={{
                padding: '0 0.875rem', borderRadius: '0.5rem',
                border: '1px solid rgba(255,255,255,0.15)',
                background: 'rgba(255,255,255,0.07)',
                color: '#e2e8f0', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
            >
              {es ? 'Generar' : 'Generate'}
            </button>
            <button
              onClick={handleLabel}
              style={{
                padding: '0 0.875rem', borderRadius: '0.5rem',
                border: 'none',
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                color: 'white', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
            >
              🏷️ {es ? 'Etiqueta' : 'Label'}
            </button>
          </div>
        </div>
        )}

        {/* IMEI — separate from SKU. Optional, mostly used for phones. */}
        {show('sku') && (
        <div>
          <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>
            IMEI <span style={{ color: '#64748b', fontWeight: 400 }}>({es ? 'opcional, para teléfonos' : 'optional, for phones'})</span>
          </label>
          <input
            className="input"
            placeholder="IMEI"
            value={form.imei}
            onChange={(e) => setForm({ ...form, imei: e.target.value })}
          />
        </div>
        )}

        {/* ── Duplicate SKU warning banner ── */}
        {isDuplicate && duplicateItem && (
          <div style={{
            background: 'rgba(251,191,36,0.08)',
            border: '1px solid rgba(251,191,36,0.35)',
            borderRadius: '0.5rem',
            padding: '0.6rem 0.75rem',
            fontSize: '0.78rem',
            color: '#fde68a',
            lineHeight: 1.4,
          }}>
            ⚠️ <strong>{es ? 'SKU ya existe' : 'SKU already exists'}</strong> —{' '}
            {es
              ? `"${duplicateItem.name}" (stock actual: ${duplicateItem.qty}). Si guardas, SOLO la cantidad se sumará al existente. Los demás campos del item original NO cambiarán. Cambia el SKU si es un artículo distinto.`
              : `"${duplicateItem.name}" (current stock: ${duplicateItem.qty}). On save, ONLY the quantity will be added to the existing item. Name/price/cost will NOT change. Change SKU if it's a different item.`}
          </div>
        )}

        {/* Item Name */}
        <div style={{ position: 'relative' }}>
          <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>
            {es ? 'Nombre del Artículo' : 'Item Name'} *
          </label>
          <input
            className="input"
            placeholder={es ? 'Ej: iPhone 13 Pro Max 128GB' : 'Example: iPhone 13 Pro Max 128GB'}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            onFocus={() => setActiveSuggestField('name')}
            onBlur={() => setTimeout(() => setActiveSuggestField(null), 150)}
            autoFocus={!isEdit}
            style={{ fontSize: '1rem' }}
          />
          {activeSuggestField === 'name' && suggestionsForField('name', form.name).length > 0 && (
            <div style={dropdownStyle}>
              {suggestionsForField('name', form.name).map((s) => (
                <button key={s} type="button" style={dropdownItemStyle}
                  onMouseDown={(e) => { e.preventDefault(); setForm({ ...form, name: s }); setActiveSuggestField(null); }}>
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Price History panel ── */}
        {priceHistory.length > 0 && (
          <div style={{
            background: 'rgba(34,211,238,0.06)',
            border: '1px solid rgba(34,211,238,0.25)',
            borderRadius: '0.5rem',
            padding: '0.6rem 0.75rem',
          }}>
            <div style={{ fontSize: '0.72rem', color: '#67e8f9', fontWeight: 700, marginBottom: '0.4rem' }}>
              📊 {es ? 'Historial de Precios' : 'Price History'} ({priceHistory.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', maxHeight: '140px', overflowY: 'auto' }}>
              {priceHistory.map((ph, idx) => (
                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#cbd5e1' }}>
                  <span style={{ color: '#64748b' }}>{ph.date.slice(0, 10)}</span>
                  <span style={{ color: '#94a3b8', flex: 1, textAlign: 'center' }}>× {ph.qty}</span>
                  <span style={{ fontWeight: 700, color: '#86efac' }}>{formatCurrency(ph.price)}</span>
                </div>
              ))}
            </div>
            {(() => {
              const prices = priceHistory.map((p) => p.price);
              const avg = prices.reduce((s, p) => s + p, 0) / prices.length;
              const min = Math.min(...prices);
              const max = Math.max(...prices);
              return (
                <div style={{ marginTop: '0.4rem', paddingTop: '0.4rem', borderTop: '1px solid rgba(34,211,238,0.2)', display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem' }}>
                  <span style={{ color: '#64748b' }}>{es ? 'Mín' : 'Min'}: <strong style={{ color: '#cbd5e1' }}>{formatCurrency(min)}</strong></span>
                  <span style={{ color: '#64748b' }}>{es ? 'Prom' : 'Avg'}: <strong style={{ color: '#cbd5e1' }}>{formatCurrency(Math.round(avg))}</strong></span>
                  <span style={{ color: '#64748b' }}>{es ? 'Máx' : 'Max'}: <strong style={{ color: '#cbd5e1' }}>{formatCurrency(max)}</strong></span>
                </div>
              );
            })()}
          </div>
        )}

        {/* Category + Condition */}
        {(show('category') || show('condition')) && (
        <div style={{ display: 'grid', gridTemplateColumns: show('category') && show('condition') ? '1fr 1fr' : '1fr', gap: '0.75rem' }}>
          {show('category') && (
          <div>
            <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>
              {es ? 'Categoría' : 'Category'}{req('category') && ' *'}
            </label>
            {!showAddCat ? (
              <select
                className="select"
                value={form.category}
                onChange={(e) => {
                  if (e.target.value === '__add__') {
                    setShowAddCat(true);
                  } else {
                    setForm({ ...form, category: e.target.value });
                  }
                }}
              >
                {/* Existing inventory categories */}
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                {/* Built-in defaults that might not be in the list yet */}
                {CATEGORIES.filter((c) => !categories.includes(c.value)).map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
                <option value="__add__">+ {es ? 'Agregar nueva...' : 'Add new...'}</option>
              </select>
            ) : (
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <input
                  className="input"
                  style={{ flex: 1 }}
                  placeholder={es ? 'Nombre de categoría' : 'Category name'}
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddCategoryInline(); }}
                />
                <button
                  type="button"
                  onClick={handleAddCategoryInline}
                  style={{
                    padding: '0 0.75rem', borderRadius: '0.4rem',
                    background: 'rgba(34,211,238,0.2)', border: '1px solid rgba(34,211,238,0.4)',
                    color: '#67e8f9', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600,
                  }}
                >
                  ✓
                </button>
                <button
                  type="button"
                  onClick={() => { setShowAddCat(false); setNewCatName(''); }}
                  style={{
                    padding: '0 0.6rem', borderRadius: '0.4rem',
                    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)',
                    color: '#94a3b8', cursor: 'pointer', fontSize: '0.78rem',
                  }}
                >
                  ✕
                </button>
              </div>
            )}
          </div>
          )}
          {show('condition') && (
          <div>
            <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>
              {es ? 'Condición' : 'Condition'}{req('condition') && ' *'}
            </label>
            <select
              className="select"
              value={form.condition}
              onChange={(e) => setForm({ ...form, condition: e.target.value })}
            >
              {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          )}
        </div>
        )}

        {/* Supplier + Brand */}
        {(show('supplier') || show('brand')) && (
        <div style={{ display: 'grid', gridTemplateColumns: show('supplier') && show('brand') ? '1fr 1fr' : '1fr', gap: '0.75rem' }}>
          {show('supplier') && (
          <div style={{ position: 'relative' }}>
            <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>
              {es ? 'Proveedor' : 'Supplier'}{req('supplier') && ' *'}
            </label>
            <input
              className="input"
              placeholder={es ? 'Vendedor / Proveedor' : 'Vendor / Supplier'}
              value={form.supplier}
              onChange={(e) => setForm({ ...form, supplier: e.target.value })}
              onFocus={() => setActiveSuggestField('supplier')}
              onBlur={() => setTimeout(() => setActiveSuggestField(null), 150)}
            />
            {activeSuggestField === 'supplier' && suggestionsForField('supplier', form.supplier).length > 0 && (
              <div style={dropdownStyle}>
                {suggestionsForField('supplier', form.supplier).map((s) => (
                  <button key={s} type="button" style={dropdownItemStyle}
                    onMouseDown={(e) => { e.preventDefault(); setForm({ ...form, supplier: s }); setActiveSuggestField(null); }}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
          )}
          {show('brand') && (
          <div style={{ position: 'relative' }}>
            <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>
              {es ? 'Marca' : 'Brand'}{req('brand') && ' *'}
            </label>
            <input
              className="input"
              placeholder="Apple, Samsung, etc."
              value={form.brand}
              onChange={(e) => setForm({ ...form, brand: e.target.value })}
              onFocus={() => setActiveSuggestField('brand')}
              onBlur={() => setTimeout(() => setActiveSuggestField(null), 150)}
            />
            {activeSuggestField === 'brand' && suggestionsForField('brand', form.brand).length > 0 && (
              <div style={dropdownStyle}>
                {suggestionsForField('brand', form.brand).map((s) => (
                  <button key={s} type="button" style={dropdownItemStyle}
                    onMouseDown={(e) => { e.preventDefault(); setForm({ ...form, brand: s }); setActiveSuggestField(null); }}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
          )}
        </div>
        )}

        {/* Cost + Price + Quantity */}
        {(show('cost') || show('price') || show('qty')) && (
        <div style={{ display: 'grid', gridTemplateColumns: [show('cost'), show('price'), show('qty')].filter(Boolean).map(() => '1fr').join(' '), gap: '0.75rem' }}>
          {show('cost') && (
          <div>
            <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>
              {es ? 'Costo' : 'Cost'}{req('cost') && ' *'}
            </label>
            <input
              type="number"
              className="input"
              placeholder="0.00"
              value={form.cost ? (form.cost / 100).toString() : ''}
              onChange={(e) => setForm({ ...form, cost: Math.round((parseFloat(e.target.value) || 0) * 100) })}
              step="0.01" min="0"
            />
          </div>
          )}
          {show('price') && (
          <div>
            <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>
              {es ? 'Precio' : 'Price'}{req('price') && ' *'}
            </label>
            <input
              type="number"
              className="input"
              placeholder="0.00"
              value={form.price ? (form.price / 100).toString() : ''}
              onChange={(e) => setForm({ ...form, price: Math.round((parseFloat(e.target.value) || 0) * 100) })}
              step="0.01" min="0"
            />
          </div>
          )}
          {show('qty') && (
          <div>
            <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>
              {es ? 'Cantidad' : 'Quantity'}{req('qty') && ' *'}
            </label>
            <input
              type="number"
              className="input"
              placeholder="0"
              value={form.qty}
              onChange={(e) => setForm({ ...form, qty: parseInt(e.target.value) || 0 })}
              min="0"
            />
          </div>
          )}
        </div>
        )}

        {/* Margin indicator */}
        {form.cost > 0 && form.price > 0 && (
          <div style={{
            padding: '0.5rem 0.75rem',
            background: marginDollars >= 0 ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
            border: `1px solid ${marginDollars >= 0 ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
            borderRadius: '0.5rem',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
              {isLoss
                ? (es ? 'Pérdida potencial' : 'Potential loss')
                : (es ? 'Ganancia potencial' : 'Potential profit')}
            </span>
            <span style={{ fontSize: '0.875rem', fontWeight: 700, color: marginDollars >= 0 ? '#22c55e' : '#ef4444' }}>
              {marginDollars >= 0 ? '+' : ''}{formatCurrency(marginDollars)}
              {marginPct && <span style={{ fontSize: '0.75rem', marginLeft: '0.4rem', opacity: 0.7 }}>({marginPct}%)</span>}
            </span>
          </div>
        )}

        {/* Notes / Description */}
        {show('description') && (
        <div>
          <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>
            {es ? 'Notas' : 'Notes'}{req('description') && ' *'}
          </label>
          <textarea
            className="textarea"
            rows={2}
            placeholder={es ? 'Notas opcionales...' : 'Any notes (optional)'}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            style={{ resize: 'vertical' }}
          />
        </div>
        )}

        {/* ── Custom Fields (user-defined) ── */}
        {fieldConfig.customFields.length > 0 && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
            padding: '0.75rem',
            background: 'rgba(34,211,238,0.04)',
            border: '1px solid rgba(34,211,238,0.15)',
            borderRadius: '0.5rem',
          }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#67e8f9', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
              {es ? '✨ Campos Personalizados' : '✨ Custom Fields'}
            </div>
            {fieldConfig.customFields.map((cf) => {
              const displayLabel = es && cf.labelEs ? cf.labelEs : cf.label;
              const value = form.customFields[cf.id] ?? '';
              return (
                <div key={cf.id}>
                  <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>
                    {displayLabel}{cf.required && ' *'}
                  </label>
                  {cf.type === 'text' && (
                    <input
                      className="input"
                      type="text"
                      placeholder={cf.placeholder || ''}
                      value={String(value)}
                      onChange={(e) => updateCustomField(cf.id, e.target.value)}
                    />
                  )}
                  {cf.type === 'number' && (
                    <input
                      className="input"
                      type="number"
                      placeholder={cf.placeholder || '0'}
                      value={value === '' ? '' : String(value)}
                      onChange={(e) => updateCustomField(cf.id, parseFloat(e.target.value) || 0)}
                    />
                  )}
                  {cf.type === 'date' && (
                    <input
                      className="input"
                      type="date"
                      value={String(value)}
                      onChange={(e) => updateCustomField(cf.id, e.target.value)}
                    />
                  )}
                  {cf.type === 'dropdown' && (
                    <select
                      className="select"
                      value={String(value)}
                      onChange={(e) => updateCustomField(cf.id, e.target.value)}
                    >
                      <option value="">
                        {es ? '-- Selecciona --' : '-- Select --'}
                      </option>
                      {(cf.options || []).map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Checkboxes: Taxable, CBE, Screen Fee */}
        <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap' }}>
          {[
            { key: 'taxable', label: es ? 'Impuesto' : 'Taxable' },
            { key: 'cbeEligible', label: 'CBE Fee' },
            { key: 'screenFeeEligible', label: es ? 'Cuota Pantalla' : 'Screen Fee' },
          ].map(({ key, label }) => (
            <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.82rem', color: '#94a3b8' }}>
              <input
                type="checkbox"
                checked={(form as any)[key] || false}
                onChange={(e) => setForm({ ...form, [key]: e.target.checked })}
                style={{ width: '15px', height: '15px', accentColor: '#667eea' }}
              />
              {label}
            </label>
          ))}
        </div>

        {/* Batch Mode options */}
        {batchMode && !isEdit && (
          <div style={{
            padding: '0.75rem', background: 'rgba(102,126,234,0.08)',
            border: '1px solid rgba(102,126,234,0.2)', borderRadius: '0.5rem',
          }}>
            <label style={{ fontSize: '0.82rem', color: '#a5b4fc', display: 'block', marginBottom: '0.4rem', fontWeight: 600 }}>
              📦 {es ? 'Modo Lote — ¿Cuántos artículos?' : 'Batch Mode — How many items?'}
            </label>
            <input
              type="number"
              className="input"
              style={{ width: '120px' }}
              value={batchCount}
              onChange={(e) => setBatchCount(Math.max(1, parseInt(e.target.value) || 1))}
              min="1" max="100"
            />
          </div>
        )}
      </div>

      {/* Action buttons — matching original layout */}
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        {/* Cancel */}
        <button onClick={onClose} className="btn btn-secondary" style={{ flex: 1 }}>
          {es ? 'Cancelar' : 'Cancel'}
        </button>

        {/* Clear */}
        <button
          onClick={() => setForm({ sku: '', imei: '', barcode: '', name: '', description: '', category: 'accessory', condition: 'New', cost: 0, price: 0, qty: 1, supplier: '', brand: '', taxable: true, cbeEligible: false, screenFeeEligible: false, customFields: {} })}
          style={{
            padding: '0 0.875rem', borderRadius: '0.625rem',
            border: '1px solid rgba(255,255,255,0.15)',
            background: 'rgba(255,255,255,0.06)',
            color: '#94a3b8', cursor: 'pointer', fontSize: '0.82rem',
            display: 'flex', alignItems: 'center', gap: '0.35rem',
          }}
          title={es ? 'Limpiar' : 'Clear'}
        >
          🗑️ {es ? 'Limpiar' : 'Clear'}
        </button>

        {/* Batch Mode — only on new items */}
        {!isEdit && (
          <button
            onClick={() => setBatchMode(!batchMode)}
            style={{
              padding: '0 0.875rem', borderRadius: '0.625rem',
              border: `1px solid ${batchMode ? 'rgba(102,126,234,0.6)' : 'rgba(255,255,255,0.15)'}`,
              background: batchMode ? 'rgba(102,126,234,0.2)' : 'rgba(255,255,255,0.06)',
              color: batchMode ? '#a5b4fc' : '#94a3b8',
              cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: '0.35rem', whiteSpace: 'nowrap',
            }}
          >
            📦 {es ? 'Lote' : 'Batch Mode'}
          </button>
        )}

        {/* Add / Save */}
        <button
          onClick={handleSubmit}
          disabled={!form.name.trim()}
          className="btn btn-primary"
          style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
        >
          {isEdit ? (
            <>{es ? '💾 Guardar' : '💾 Save'}</>
          ) : (
            <>✓ {batchMode ? `${es ? 'Agregar' : 'Add'} ${batchCount}` : (es ? 'Agregar Artículo' : 'Add Item')}</>
          )}
        </button>
      </div>
    </Modal>
    <ConfirmDialog
      open={zeroPriceConfirm}
      title={es ? 'Precio $0' : 'Zero Price'}
      message={es
        ? '⚠️ El precio es $0. ¿Guardar de todas formas? El artículo será gratis en el carrito.'
        : '⚠️ Price is $0. Save anyway? Item will be free in the cart.'}
      variant="warning"
      onConfirm={() => { setZeroPriceConfirm(false); doSubmit(); }}
      onCancel={() => setZeroPriceConfirm(false)}
    />
    </>
  );
}

// ── Autocomplete dropdown shared styles ────────────────────
const dropdownStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  right: 0,
  marginTop: '0.2rem',
  background: 'rgba(15,23,42,0.98)',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: '0.5rem',
  boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  zIndex: 50,
  maxHeight: '180px',
  overflowY: 'auto',
  padding: '0.25rem',
};

const dropdownItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '0.4rem 0.6rem',
  background: 'transparent',
  border: 'none',
  color: '#e2e8f0',
  fontSize: '0.82rem',
  textAlign: 'left',
  cursor: 'pointer',
  borderRadius: '0.35rem',
};
