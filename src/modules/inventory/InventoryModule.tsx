// ============================================================
// CellHub Pro — Inventory Module
// ============================================================

import { useState, useMemo, useCallback, useEffect, useRef, useDeferredValue, lazy, Suspense } from 'react';
import { useApp } from '@/store/AppProvider';
import { useLicense } from '@/contexts/LicenseContext';
import { useToast } from '@/components/ui/Toast';
import { useHighlightRecord } from '@/hooks/useHighlightRecord';
import { Modal, ConfirmDialog } from '@/components/ui';
import GlobalSearchBar from '@/components/shared/GlobalSearchBar';
import { useTranslation } from '@/i18n';
import { formatCurrency } from '@/utils/currency';
import { canViewOwnerFinancials } from '@/utils/financialPrivacy';
import { matchesSearch } from '@/utils/fuzzyMatch';
import { generateId } from '@/utils/dates';
import { usePrint, openPrintWindow } from '@/hooks/usePrint';
import JsBarcode from 'jsbarcode';
import type { InventoryItem, Sale, PurchaseOrder, InventoryLoss, LossReason } from '@/store/types';
import { persist, persistSettings, remove } from '@/services/persist';
import { useLanReadOnlyMode } from '@/hooks/useLanReadOnly';
// R-LOSSES-SHRINKAGE-V1: admin-PIN guard reused from the canonical
// AdminPinGate component. Mark-as-Loss is owner/manager only.
import AdminPinGate from '@/components/shared/AdminPinGate';
import { loadLocal, saveLocal } from '@/services/storage';
import { DEFAULT_LOW_STOCK_THRESHOLD } from '@/config/constants';
import { emitInventoryLookup } from '@/services/intelligence/liveContext/liveContextEvents';
import FieldCustomizerModal, { resolveFieldConfig, isFieldVisible, isFieldRequired } from './FieldCustomizerModal';
// R-INTEL-INVENTORY-PROMOTE-BUTTON: per-row Promote button delegates to
// the same Product Push engine the chat handler uses (single-source).
// R-PERF-INVENTORY-PROMOTE-DYNAMIC-IMPORT: type-only import keeps the
// intel runtime out of the Inventory chunk; the actual modules are
// lazy-loaded inside handlePromote on first click.
import type { IntelligenceEngine as IntelligenceEngineType } from '@/services/intelligence/IntelligenceEngine';
// COMPANION: per-row "Request approval" button. Lazy-imported so the
// Inventory chunk doesn't pull in the modal until the operator clicks.
import { loadDesktopSession } from '@/services/companion/identityStore';
import type { CompanionDesktopSession } from '@/types/companion';
import { setIntelligenceContext, clearEntityContext, setPendingPromoteProduct } from '@/services/intelligence/context/intelligenceContext';
import { emitInventoryAmbient } from '@/services/intelligence/ambient/ambientAwarenessService';
const RequestApprovalModal = lazy(() => import('@/modules/companion/RequestApprovalModal'));

// R-PERF-INVENTORY-PROMOTE-PRELOAD: module-level preload cache. The first
// onMouseEnter/onFocus on a Promote button kicks off the intel chunk
// download in parallel; the eventual click awaits the same promise so
// it doesn't wait twice. Subsequent calls return the cached promise
// (browser already has the modules) — near-zero cost.
let promoteIntelPreloadPromise: Promise<unknown> | null = null;
function preloadPromoteIntel(): Promise<unknown> {
  if (!promoteIntelPreloadPromise) {
    promoteIntelPreloadPromise = Promise.all([
      import('@/services/intelligence/IntelligenceEngine'),
      import('@/services/intelligence/chat/handlers'),
      import('@/services/intelligence/actions'),
    ]);
  }
  return promoteIntelPreloadPromise;
}

export default function InventoryModule() {
  const {
    // R-INTEL-INVENTORY-PROMOTE-BUTTON: customers, repairs, specialOrders,
    // unlocks, layaways, customerReturns destructured for IntelligenceEngine
    // construction in the Promote click handler. Engine needs the full data
    // set to score customers (getCustomerScores requires cachedResult).
    state: { inventory, sales, settings, lang, cart, inventorySearchTerm, purchaseOrders, customers, repairs, specialOrders, unlocks, layaways, customerReturns, inventoryLosses, currentEmployee, isAdminMode },
    setInventory, setCart, setInventoryLosses, dispatch,
  } = useApp();
  // R-FINANCIAL-PRIVACY-V2: cost column, profit-potential stat card, and the
  // margin section inside InventoryFormModal are owner-only when the flag is on.
  const canSeeOwnerFinancials = canViewOwnerFinancials(
    settings,
    isAdminMode || currentEmployee?.role === 'owner',
  );

  const { toast } = useToast();
  const { highlightRef, isHighlighted } = useHighlightRecord<HTMLTableRowElement>();
  const { printHtml } = usePrint();
  const { t, locale } = useTranslation();
  const { features } = useLicense();
  const atLimit = features.maxProducts !== -1 && inventory.length >= features.maxProducts;
  // SECONDARY-UI-LOCK-V1: block inventory create on a read-only LAN Secondary.
  const lanReadOnly = useLanReadOnlyMode();

  const CONDITION_LABELS: Record<string, string> = {
    New: t('condition.new'),
    Excellent: t('condition.excellent'),
    Good: t('condition.good'),
    Fair: t('condition.fair'),
    Refurbished: t('condition.refurbished'),
    'For Parts': t('condition.forParts'),
  };

  const [search, setSearch] = useState(inventorySearchTerm || '');

  // BUG-CAT (R-SIM-INTAKE): user-added inventory categories persist independently
  // of the inventory items. Without this, a category typed via the "+ Add
  // category" inline picker only survives as long as at least one item with
  // that category exists (because the `categories` memo above derives from
  // inventory). Storage key follows the cellhub_* convention via saveLocal.
  const [customCategories, setCustomCategories] = useState<string[]>(
    () => loadLocal<string[]>('inventory_custom_categories', []),
  );

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
  // R-SIM-MANAGER-UI: dedicated SIM Card manager modal (toolbar button).
  const [showSimManager, setShowSimManager] = useState(false);
  // R-LOSSES-SHRINKAGE-V1: mark-as-loss flow state. The flow is gated by
  // the canonical AdminPinGate (manager/admin PIN) and decrements
  // inventory.qty + creates an InventoryLoss record on success. Losses
  // are NOT sales / refunds / voids — separate audit shape.
  const [lossTarget, setLossTarget] = useState<InventoryItem | null>(null);
  const [lossQty, setLossQty] = useState<string>('1');
  const [lossReason, setLossReason] = useState<LossReason | ''>('');
  const [lossNotes, setLossNotes] = useState<string>('');
  const [lossPinOpen, setLossPinOpen] = useState(false);
  const [committingLoss, setCommittingLoss] = useState(false);

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
    // R-SIM-INTAKE: SIM is an acronym — return all-caps form so the tab
    // label shows "SIM" instead of "Sim". The filter below compares both
    // sides lowercased, so the case difference doesn't break matching.
    if (lc === 'sim') return 'SIM';
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
    // R-SIM-INTAKE: always expose the SIM tab so cashiers can navigate to it
    // even before the first SIM is intaked. The key 'SIM' (from normCat) is
    // shown as-is since it's already an acronym.
    if (!seen.has('SIM')) seen.set('SIM', 'SIM');
    return ['All', ...Array.from(seen.values()).sort((a, b) => a.localeCompare(b, locale))];
    // R-PERF-INVENTORY-LANG-SORT-REMOVE: dropped `lang` from deps. Latin-script
    // sort order is near-identical across EN/ES/PT for inventory names; avoid
    // re-sorting on every language toggle (was causing P2 lag in lang-switch
    // perf audit). localeCompare still uses current locale at compute time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inventory]);

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
    return ['All', ...Array.from(seen.values()).sort((a, b) => a.localeCompare(b, locale))];
    // R-PERF-INVENTORY-LANG-SORT-REMOVE: see categories memo comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inventory]);

  // ── Filtered list ───────────────────────────────────────
  // R-PERF-HARDENING-V1 #3: defer the search input so the O(N) filter+sort
  // doesn't run on every keystroke when typing fast. The text input stays
  // responsive (commits to `search` immediately); the heavy filter follows
  // when the renderer has bandwidth.
  const deferredSearch = useDeferredValue(search);
  const filtered = useMemo(() => {
    return inventory
      .filter((item) => {
        // BUG-4 (R-INV-BUGS): apply normCat to item.category so the filter
        // matches the same key the tab labels were built from (line 81).
        // Without this, items saved as 'phone' (singular — see CATEGORIES
        // tuple at line ~843) never match the 'Phones' tab whose key is
        // 'phones' (plural) per normCat.
        // R-SIM-INTAKE: lowercase BOTH sides because normCat now returns
        // mixed-case for acronyms (e.g. 'SIM').
        if (filterCategory !== 'All' && normCat(item.category || '').toLowerCase() !== filterCategory.toLowerCase()) return false;
        if (filterCondition !== 'All' && (item.condition || '').toLowerCase() !== filterCondition.toLowerCase()) return false;
        if (showLowStockOnly && item.qty > (settings.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD)) return false;
        // R-SEARCH-NORMALIZE-V1: broaden inventory list search to include
        // brand, supplier, and description so e.g. "Apple" or "Mobistar"
        // (supplier) surface their items. No phone fields here so plain
        // matchesSearch is fine — phone-aware helper not needed.
        return matchesSearch(
          deferredSearch,
          item.name, item.sku, item.barcode, item.imei, item.category,
          item.brand, item.supplier, item.description,
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name, locale));
    // R-PERF-INVENTORY-LANG-SORT-REMOVE: dropped `lang` from deps for the same
    // reason as the categories/conditions memos — Latin-script collation is
    // near-identical across EN/ES/PT, so avoid re-running the full filter +
    // sort on every language toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inventory, filterCategory, filterCondition, showLowStockOnly, deferredSearch, settings.lowStockThreshold]);

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

  // R-INTELLIGENCE-RUNTIME-NAVIGATION-V1: open a specific inventory item from
  // Intelligence action buttons. AppShell navigates here first, then defers
  // 80ms before firing this event so this listener is attached.
  useEffect(() => {
    const handler = (e: Event) => {
      // INTEL-ACTION-CONTEXT-AND-NAV-RACE-FIX-V1: ack the AppShell relay —
      // preventDefault on the cancelable event stops its bounded retry loop.
      e.preventDefault();
      const { itemId } = (e as CustomEvent<{ itemId?: string }>).detail ?? {};
      if (!itemId) return;
      const item = inventoryRef.current.find((i) => i.id === itemId);
      // R-INTELLIGENCE-ACTION-RELIABILITY-V2: not found → safe no-op + toast
      // (never a blank/new item modal). Modal renders from the `item={editItem}`
      // prop, same path as the card Edit button.
      if (!item) {
        console.warn('[cellhub] _intel-open-inventory: not found', itemId);
        toast(t('intel.entityNotFound'), 'error');
        return;
      }
      setEditItem(item);
      setShowModal(true);
    };
    window.addEventListener('cellhub:_intel-open-inventory', handler);
    return () => window.removeEventListener('cellhub:_intel-open-inventory', handler);
  }, [t]);

  // R-INTELLIGENCE-CONTEXT-AWARE-V1: broadcast active inventory item so Intelligence
  // surfaces contextual recommendations for this specific product.
  // R-INTELLIGENCE-AMBIENT-AWARENESS-V1: compute lightweight sales signals then
  // emit passive ambient hint; clear entity context when modal closes.
  useEffect(() => {
    if (editItem) {
      setIntelligenceContext({
        activeModule: 'inventory',
        activeInventoryItemId: editItem.id,
      });
      // Compute recent sales count (last 30 days) and days-since-last-sale
      // for this item. Kept inline to avoid pulling the sales array into
      // the service's signature — it has no access to the store.
      const now = Date.now();
      const MS_30D = 30 * 86_400_000;
      let recentSalesCount = 0;
      let mostRecentSaleMs = 0;
      for (const s of sales) {
        if (!s.items) continue;
        const hasItem = s.items.some((i) => (i as unknown as Record<string, unknown>)['inventoryId'] === editItem.id);
        if (!hasItem) continue;
        const ts = (() => {
          const ca = s.createdAt;
          if (typeof ca === 'string') { const p = Date.parse(ca); return Number.isFinite(p) ? p : 0; }
          if (typeof ca === 'number') return ca;
          if (ca instanceof Date) return ca.getTime();
          return 0;
        })();
        if (ts > mostRecentSaleMs) mostRecentSaleMs = ts;
        if (ts > 0 && now - ts <= MS_30D) recentSalesCount++;
      }
      const daysWithoutSale = mostRecentSaleMs
        ? Math.floor((now - mostRecentSaleMs) / 86_400_000)
        : 999;
      emitInventoryAmbient(editItem, recentSalesCount, daysWithoutSale);
    } else {
      clearEntityContext();
    }
  }, [editItem, sales]);

  // R-PERF-INVENTORY-PROMOTE-ENGINE-REUSE: cache the IntelligenceEngine
  // across Promote clicks. Without this, every click rebuilt the engine
  // and ran a full analyze() (~200-400ms freeze). Now: first click pays
  // the cost; subsequent clicks reuse the same instance unless the
  // underlying data signature changes (sales/customers/inventory/repairs
  // length delta). Mirrors IntelligenceModule's useRef + sig pattern.
  const promoteEngineRef = useRef<IntelligenceEngineType | null>(null);
  const promoteEngineSigRef = useRef<string>('');

  // COMPANION: state for the per-row "Request approval" modal.
  // Session is captured at click time so re-pairing in another tab takes
  // effect on the next click without remounting Inventory.
  const [approvalModalOpen, setApprovalModalOpen] = useState(false);
  const [approvalPrefillItem, setApprovalPrefillItem] = useState<InventoryItem | null>(null);
  const [approvalSession, setApprovalSession] = useState<CompanionDesktopSession | null>(null);

  const handleRequestApprovalForItem = useCallback((item: InventoryItem) => {
    const session = loadDesktopSession();
    if (!session) {
      toast(t('inventory.approvalRequest.notPaired'), 'warning');
      return;
    }
    setApprovalSession(session);
    setApprovalPrefillItem(item);
    setApprovalModalOpen(true);
  }, [toast, t]);

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
        toast(t('inventory.saved'), 'success');
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
            toast(t('inventory.skuDiffImei'), 'info');
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
          toast(t('inventory.qtyAdded', addedQty, existing.name, mergedItem.qty), 'success');
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
        toast(t('inventory.itemAdded'), 'success');
        // Keep modal open for adding more items
      }
    },
    [editItem, setInventory, toast, t],
  );

  const handleDelete = useCallback(
    (id: string) => {
      const next = inventoryRef.current.filter((i) => i.id !== id);
      inventoryRef.current = next;
      setInventory(next);
      remove.inventory(id);
      toast(t('inventory.deleted'), 'info');
      setDeleteConfirm(null);
    },
    [setInventory, toast, t],
  );

  // R-LOSSES-SHRINKAGE-V1: open the Mark-as-Loss modal pre-filled from
  // the row item. Cost-zero items are blocked here (V1 policy — fake
  // loss accounting prevention). Out-of-stock items are also blocked
  // since there's nothing to write off.
  const openMarkAsLoss = useCallback((item: InventoryItem) => {
    if ((item.qty || 0) <= 0) {
      toast(t('inventory.loss.outOfStock'), 'warning');
      return;
    }
    if ((item.cost || 0) <= 0) {
      toast(t('inventory.loss.costMissing'), 'warning');
      return;
    }
    setLossTarget(item);
    setLossQty('1');
    setLossReason('');
    setLossNotes('');
  }, [toast, t]);

  // R-LOSSES-SHRINKAGE-V1: commit handler. Runs only after the
  // AdminPinGate succeeds. Validates again at commit time (defense
  // in depth — qty/stock/reason re-checked against fresh inventory),
  // creates the InventoryLoss record, decrements the item's qty,
  // and persists both via the canonical persist surface (full record
  // spread per CLAUDE.md / persist contract — no partial writes).
  const handleCommitLoss = useCallback(() => {
    if (committingLoss) return;
    const target = lossTarget;
    if (!target) return;
    const qtyNum = parseInt(lossQty, 10);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      toast(t('inventory.loss.invalidQty'), 'warning');
      return;
    }
    if (!lossReason) {
      toast(t('inventory.loss.reasonRequired'), 'warning');
      return;
    }
    // Re-read fresh inventory at commit time so concurrent edits don't
    // let us write off more than what's actually on hand.
    const fresh = inventoryRef.current.find((i) => i.id === target.id);
    if (!fresh) {
      toast(t('inventory.loss.notFound'), 'error');
      return;
    }
    if ((fresh.qty || 0) < qtyNum) {
      toast(t('inventory.loss.exceedsStock'), 'warning');
      return;
    }
    if ((fresh.cost || 0) <= 0) {
      toast(t('inventory.loss.costMissing'), 'warning');
      return;
    }
    setCommittingLoss(true);
    try {
      const now = new Date().toISOString();
      const totalLossCents = (fresh.cost || 0) * qtyNum;
      const lossRecord: InventoryLoss = {
        id: generateId(),
        itemId: fresh.id,
        sku: fresh.sku,
        itemName: fresh.name,
        qty: qtyNum,
        unitCost: fresh.cost || 0,
        totalLoss: totalLossCents,
        reason: lossReason as LossReason,
        notes: lossNotes.trim() || undefined,
        createdAt: now,
        approvedBy: currentEmployee?.name || '—',
      };
      const updatedItem: InventoryItem = {
        ...fresh,
        qty: (fresh.qty || 0) - qtyNum,
      };
      const nextInventory = inventoryRef.current.map((i) =>
        i.id === fresh.id ? updatedItem : i,
      );
      inventoryRef.current = nextInventory;
      setInventory(nextInventory);
      const nextLosses = [...(Array.isArray(inventoryLosses) ? inventoryLosses : []), lossRecord];
      setInventoryLosses(nextLosses);
      persist.inventory(updatedItem.id, updatedItem as unknown as Record<string, unknown>);
      persist.inventoryLoss(lossRecord.id, lossRecord as unknown as Record<string, unknown>);
      toast(t('inventory.loss.recorded', fresh.name), 'success');
      setLossTarget(null);
      setLossQty('1');
      setLossReason('');
      setLossNotes('');
      setLossPinOpen(false);
    } catch (err) {
      console.error('[mark-as-loss] failed', err);
      toast(t('inventory.loss.failed'), 'error');
    } finally {
      setCommittingLoss(false);
    }
  }, [lossTarget, lossQty, lossReason, lossNotes, committingLoss, currentEmployee, inventoryLosses, setInventory, setInventoryLosses, toast, t]);

  // R-INTEL-INVENTORY-PROMOTE-BUTTON: click handler — instantiates a
  // fresh IntelligenceEngine, calls the same runProductPush helper the
  // chat handler uses, and surfaces a queue-count toast. Engine
  // construction is ~150-300ms (one-shot, manual click — acceptable).
  // Queue items get type='product_push_whatsapp' + status='pending_approval'
  // so they don't collide with other intents and require explicit
  // approval in the Intelligence queue UI before execute.
  const handlePromote = useCallback(async (item: InventoryItem) => {
    try {
      const engineLang = (locale === 'es' || locale === 'pt') ? locale : 'en';

      // R-PERF-INVENTORY-PROMOTE-DYNAMIC-IMPORT: lazy-load the intel
      // runtime on first click so the Inventory chunk stays lean for
      // shops that never use Promote. Subsequent clicks resolve from
      // module cache (~free).
      // R-PERF-INVENTORY-PROMOTE-PRELOAD: route through the shared
      // preload cache — if the cashier hovered/focused a Promote
      // button beforehand, the chunks are already downloading in
      // parallel and this await is near-instant.
      const [{ IntelligenceEngine }, { runProductPush }, { getOutreachQueue }] =
        await preloadPromoteIntel() as [
          typeof import('@/services/intelligence/IntelligenceEngine'),
          typeof import('@/services/intelligence/chat/handlers'),
          typeof import('@/services/intelligence/actions'),
        ];

      // R-PERF-INVENTORY-PROMOTE-ENGINE-REUSE: reuse the engine across
      // clicks. dataSig keys on array lengths — cheap O(1) check that
      // catches add/remove mutations of the underlying entity arrays.
      // Mutations to existing items (e.g. cost edit) won't bust the
      // cache — acceptable for product-push ranking which is dominated
      // by sale history and customer scores, not item field edits.
      const sig = `${sales.length}|${customers.length}|${inventory.length}|${repairs.length}`;
      if (!promoteEngineRef.current || promoteEngineSigRef.current !== sig) {
        promoteEngineRef.current = new IntelligenceEngine(
          sales, customers, inventory, repairs,
          { lang: engineLang as 'en' | 'es' | 'pt', enableAlerts: false, enableScoring: true },
          // R-CUSTOMER-PROFIT-PARITY-V1: pass settings so any customer
          // history / scoring path that consults getCustomerHistory
          // gets the commission-aware profit math.
          { specialOrders, unlocks, layaways, customerReturns, settings },
        );
        // analyze() populates cachedResult so getCustomerScores() returns data.
        promoteEngineRef.current.analyze();
        promoteEngineSigRef.current = sig;
      }
      const engine = promoteEngineRef.current;
      const before = getOutreachQueue().length;
      // R-INTEL-PRODUCT-PUSH-NAME-NORMALIZATION: trim + lowercase the
      // product name at the call site so casing/whitespace variations
      // don't fragment matching in engine scoring. Engine + helper are
      // unchanged — normalization is a caller concern only.
      const cleanName = item.name.trim().toLowerCase();
      runProductPush(engine, engineLang as 'en' | 'es' | 'pt', cleanName);
      const after = getOutreachQueue().length;
      const queued = Math.max(0, after - before);
      if (queued > 0) {
        toast(t('inventory.promoteSuccess', queued, item.name), 'success');
      } else {
        toast(t('inventory.promoteNoTargets', item.name), 'warning');
      }
      setPendingPromoteProduct(item.id, item.name);
      dispatch({ type: 'SET_ACTIVE_TAB', payload: 'intelligence' });
    } catch {
      toast(t('inventory.promoteNoTargets', item.name), 'error');
    }
  }, [sales, customers, inventory, repairs, specialOrders, unlocks, layaways, customerReturns, locale, toast, t, dispatch]);

  const handleQuickRestock = useCallback(
    (id: string) => {
      const target = inventoryRef.current.find((i) => i.id === id);
      if (target && isServiceCategory(target.category)) {
        toast(t('inventory.noStockService'), 'warning');
        return;
      }
      const next = inventoryRef.current.map((i) => i.id === id ? { ...i, qty: i.qty + 1 } : i);
      inventoryRef.current = next;
      setInventory(next);
      const ri = next.find((i) => i.id === id);
      if (ri) persist.inventory(ri.id, ri as unknown as Record<string, unknown>);
      toast(t('inventory.quickRestock'), 'success');
    },
    [setInventory, toast, t],
  );

  const addToCart = useCallback(
    (item: InventoryItem) => {
      // Use isServiceCategory so Spanish-tagged "servicio" items can also be sold OOS
      if (item.qty <= 0 && !isServiceCategory(item.category)) {
        toast(t('inventory.notEnoughStock'), 'warning');
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
      dispatch({ type: 'SET_ACTIVE_TAB', payload: 'pos' });
    },
    [cart, setCart, toast, t, dispatch],
  );

  return (
    <>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">📦 {t('inventory.title')}</h1>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={() => setShowFieldCustomizer(true)}
              className="btn btn-secondary"
              title={t('inventory.customizeTitle')}
            >
              ⚙️ {t('inventory.fieldsBtn')}
            </button>
            {/* R-SIM-MANAGER-UI: dedicated SIM Card manager (carrier-aware
                quick-add). Sits between ⚙️ Fields and + Add Item per spec. */}
            <button
              onClick={() => setShowSimManager(true)}
              className="btn"
              style={{
                background: 'rgba(34,211,238,0.15)',
                border: '1px solid rgba(34,211,238,0.4)',
                color: '#67e8f9',
              }}
            >
              🪪 {t('inventory.simManagerBtn')}
            </button>
            <button
              onClick={() => { setEditItem(null); setShowModal(true); }}
              className="btn btn-primary"
              disabled={atLimit || lanReadOnly}
              title={lanReadOnly ? t('lan.readOnlyTooltip') : atLimit ? t('license.maxProductsReached') : undefined}
              style={lanReadOnly ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
            >
              + {t('inventory.addItem')}
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="stat-card">
            <p className="text-xs text-slate-400 uppercase">{t('inventory.totalItems')}</p>
            <p className="text-2xl font-bold text-white mt-1">{inventory.length}</p>
          </div>
          <div className="stat-card">
            <p className="text-xs text-slate-400 uppercase">{t('inventory.retailValue')}</p>
            <p className="text-2xl font-bold text-emerald-400 mt-1">{formatCurrency(totalValue)}</p>
          </div>
          {/* R-FINANCIAL-PRIVACY-V2: profit potential = retailValue − cost, owner-only. */}
          {canSeeOwnerFinancials && (
            <div className="stat-card">
              <p className="text-xs text-slate-400 uppercase">{t('inventory.profitPotential')}</p>
              <p className="text-2xl font-bold text-blue-400 mt-1">{formatCurrency(totalValue - totalCost)}</p>
            </div>
          )}
          <div className="stat-card">
            <p className="text-xs text-slate-400 uppercase">{t('inventory.lowStock')}</p>
            <p className={`text-2xl font-bold mt-1 ${lowStockCount > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
              {lowStockCount}
            </p>
            <p className="text-xs text-slate-500">{t('inventory.outOfStockCount', outOfStockCount)}</p>
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
                  🛒 {t('inventory.reorderList', reorderItems.length)}
                </span>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={() => navigator.clipboard.writeText(listText)}
                    style={{ fontSize: '0.72rem', padding: '0.25rem 0.6rem', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '0.375rem', color: '#94a3b8', cursor: 'pointer' }}
                  >
                    📋 {t('inventory.copyList')}
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
                    🖨️ {t('inventory.print')}
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
                    {t('inventory.reorderMore', reorderItems.length - 12)}
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
          >
            {conditions.map((c) => (
              <option key={c} value={c}>
                {c === 'All' ? t('inventory.allConditions') : (CONDITION_LABELS[c] ?? c)}
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
            {t('inventory.lowStock')}
          </label>
        </div>

        {/* r-global-search: GlobalSearchBar in SYNCED mode — sends keystrokes
            to local `search` state (which still drives the filtered list memo
            below) AND opens the global dropdown above other modules.
            excludeCollection='inventory' hides the redundant inventory
            section in the dropdown since the local list already shows it.
            R-INVENTORY-OVERLAY-FIX-V1: disableResultsDropdown=true because
            the floating cross-module popover was sitting on top of the
            filtered inventory rows (forcing the user to click outside to
            see the match they were looking for). The input keeps working;
            only the dropdown is suppressed. */}
        <GlobalSearchBar
          localValue={search}
          onLocalChange={setSearch}
          excludeCollection="inventory"
          placeholder={t('inventory.searchPlaceholder')}
          disableResultsDropdown
        />

        {/* Table */}
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>{t('inventory.skuImei')}</th>
                <th>{t('inventory.name')}</th>
                <th>{t('inventory.category')}</th>
                {/* R-FINANCIAL-PRIVACY-V2: cost column owner-only. */}
                {canSeeOwnerFinancials && <th className="text-right">{t('inventory.cost')}</th>}
                <th className="text-right">{t('inventory.price')}</th>
                <th className="text-right">{t('inventory.qty')}</th>
                <th className="text-right">{t('inventory.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  {/* R-FINANCIAL-PRIVACY-V2: colSpan tracks the cost column gate. */}
                  <td colSpan={canSeeOwnerFinancials ? 7 : 6} className="text-center py-8 text-slate-500">
                    {t('inventory.noItemsFound')}
                  </td>
                </tr>
              ) : (
                filtered.map((item) => (
                  <tr key={item.id}
                    ref={isHighlighted(item.id) ? highlightRef : null}
                    style={isHighlighted(item.id) ? { outline: '2px solid #667eea', background: 'rgba(102,126,234,0.08)' } : undefined}>
                    <td className="font-mono text-xs text-slate-500">{item.sku || item.imei || '—'}</td>
                    <td>
                      {/* R-INVENTORY-PRODUCT-PHOTOS-V1: thumbnail when image set. */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        {item.image && (
                          <img
                            src={item.image}
                            alt=""
                            style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: '0.25rem', border: '1px solid var(--border-default)', flexShrink: 0 }}
                          />
                        )}
                        <div style={{ minWidth: 0 }}>
                          <p className="text-sm text-white font-medium">{item.name}</p>
                          {item.description && <p className="text-xs text-slate-500">{item.description}</p>}
                        </div>
                      </div>
                    </td>
                    <td><span className="badge badge-neutral">{item.category}</span></td>
                    {/* R-FINANCIAL-PRIVACY-V2: cost cell owner-only. */}
                    {canSeeOwnerFinancials && <td className="text-right text-sm text-slate-400">{formatCurrency(item.cost)}</td>}
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
                        {/* R-INTEL-INVENTORY-PROMOTE-BUTTON: per-row promote
                            shortcut. Triggers the same Product Push engine
                            the chat handler uses (single-source). */}
                        {/* R-PERF-INVENTORY-PROMOTE-PRELOAD: hover/focus
                            kicks off the intel chunk download in parallel
                            so the eventual click feels instant. */}
                        <button onClick={() => handlePromote(item)} onMouseEnter={preloadPromoteIntel} onFocus={preloadPromoteIntel} title={t('inventory.promoteTooltip')} aria-label={t('inventory.promoteBtn')} style={{ width: '2rem', height: '2rem', borderRadius: '0.375rem', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem', background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}>🎯</button>
                        {/* COMPANION: send this item to the manager for approval (discount,
                            price override, etc.). Opens RequestApprovalModal with the item
                            preselected so cost/margin context is auto-attached. Reads
                            Companion session at click time — if not paired yet, toasts
                            a hint and skips. */}
                        <button onClick={() => handleRequestApprovalForItem(item)} title={t('inventory.approvalRequest.tooltip')} aria-label={t('inventory.approvalRequest.btn')} style={{ width: '2rem', height: '2rem', borderRadius: '0.375rem', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem', background: 'rgba(56,189,248,0.15)', color: '#38bdf8' }}>📲</button>
                        <button onClick={() => { setEditItem(item); setShowModal(true); emitInventoryLookup({ sku: item.sku, itemName: item.name }); }} title={lang === 'es' ? 'Editar artículo' : 'Edit item'} style={{ padding: '0 0.5rem', height: '2rem', borderRadius: '0.375rem', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 600, gap: '0.25rem', background: 'rgba(168,85,247,0.15)', color: '#a855f7', whiteSpace: 'nowrap' }}>✏️ {lang === 'es' ? 'Editar' : 'Edit'}</button>
                        {/* R-LOSSES-SHRINKAGE-V1: Mark as Loss — opens the
                            shrinkage modal; manager-PIN guarded on commit. */}
                        <button onClick={() => openMarkAsLoss(item)} title={t('inventory.loss.button')} style={{ width: '2rem', height: '2rem', borderRadius: '0.375rem', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem', background: 'rgba(234,88,12,0.15)', color: '#fb923c' }}>📉</button>
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
          customCategories={customCategories}
          allInventory={inventory}
          allSales={sales}
          allPurchaseOrders={purchaseOrders}
          fieldConfig={fieldConfig}
          onAddCategory={(newCat) => {
            // BUG-CAT (R-SIM-INTAKE): persist custom categories so they survive
            // reloads and "no items in this category" states. Skips duplicates
            // against existing inventory-derived categories AND built-in
            // CATEGORIES tuple (case-insensitive).
            const trimmed = newCat.trim();
            if (!trimmed) return;
            const lower = trimmed.toLowerCase();
            const knownLower = new Set([
              ...categories.map((c) => c.toLowerCase()),
              ...customCategories.map((c) => c.toLowerCase()),
            ]);
            if (knownLower.has(lower)) {
              toast(t('inventory.categoryAdded', trimmed), 'info');
              return;
            }
            const next = [...customCategories, trimmed];
            setCustomCategories(next);
            saveLocal('inventory_custom_categories', next);
            toast(t('inventory.categoryAdded', trimmed), 'success');
          }}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditItem(null); }}
          lang={lang}
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
          toast(t('inventory.fieldsUpdated'), 'success');
        }}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteConfirm}
        title={t('inventory.delete')}
        message={t('inventory.deleteConfirm')}
        variant="danger"
        onConfirm={() => deleteConfirm && handleDelete(deleteConfirm)}
        onCancel={() => setDeleteConfirm(null)}
      />

      {/* R-SIM-MANAGER-UI: dedicated SIM Card manager modal. Renders only
          when toolbar button toggled showSimManager=true. Owns its own
          state (selectedCarrier filter, sub-form, editingSim) and writes
          directly via persist + setInventory — bypasses the generic
          InventoryFormModal flow per spec. */}
      <SimManagerModal
        open={showSimManager}
        onClose={() => setShowSimManager(false)}
        inventory={inventory}
        setInventory={setInventory}
        toast={toast}
        t={t}
      />

      {/* R-LOSSES-SHRINKAGE-V1: Mark as Loss modal — qty + reason + notes,
          shows unit cost and total loss preview, gated by AdminPinGate
          on Continue. Inventory qty decrement and InventoryLoss record
          creation happen in handleCommitLoss after the PIN succeeds. */}
      {lossTarget && (() => {
        const qtyNum = parseInt(lossQty, 10);
        const validQty = Number.isFinite(qtyNum) && qtyNum > 0 && qtyNum <= (lossTarget.qty || 0);
        const previewTotal = (validQty ? qtyNum : 0) * (lossTarget.cost || 0);
        const REASONS: LossReason[] = ['defective','damaged','unsellable_return','vendor_non_returnable','opened_package','other'];
        return (
          <Modal
            open={!!lossTarget && !lossPinOpen}
            onClose={() => { setLossTarget(null); setLossReason(''); setLossNotes(''); }}
            title={`📉 ${t('inventory.loss.title')}`}
            size="max-w-md"
            footer={
              <>
                <button className="btn btn-secondary" onClick={() => { setLossTarget(null); setLossReason(''); setLossNotes(''); }}>
                  {t('cancel')}
                </button>
                <button
                  className="btn"
                  style={{ background: '#ea580c', color: '#fff', fontWeight: 700, border: 'none' }}
                  disabled={!validQty || !lossReason || committingLoss}
                  onClick={() => setLossPinOpen(true)}
                >
                  {t('inventory.loss.continue')}
                </button>
              </>
            }
          >
            <div className="space-y-3">
              <div className="text-xs text-slate-400">
                {t('inventory.loss.itemLabel')}: <strong className="text-slate-200">{lossTarget.name}</strong>
                {lossTarget.sku ? <> · <span style={{ fontFamily: 'monospace' }}>{lossTarget.sku}</span></> : null}
                <br />
                {t('inventory.loss.onHandLabel')}: <strong className="text-slate-200">{lossTarget.qty}</strong>
                {' · '}
                {t('inventory.loss.unitCostLabel')}: <strong className="text-amber-300">{formatCurrency(lossTarget.cost || 0)}</strong>
              </div>
              <div>
                <label className="text-xs text-slate-400 font-semibold block mb-1">
                  {t('inventory.loss.qtyLabel')} <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="number"
                  min={1}
                  max={lossTarget.qty}
                  className="input"
                  value={lossQty}
                  onChange={(e) => setLossQty(e.target.value)}
                />
                {!validQty && lossQty.trim() !== '' && (
                  <p className="text-[11px] mt-1" style={{ color: '#fca5a5' }}>
                    {t('inventory.loss.invalidQtyHint')}
                  </p>
                )}
              </div>
              <div>
                <label className="text-xs text-slate-400 font-semibold block mb-1">
                  {t('inventory.loss.reasonLabel')} <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <select className="select" value={lossReason} onChange={(e) => setLossReason(e.target.value as LossReason)}>
                  <option value="">{t('inventory.loss.reasonPick')}</option>
                  {REASONS.map((r) => (
                    <option key={r} value={r}>{t(`inventory.loss.reason.${r}`)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400 font-semibold block mb-1">
                  {t('inventory.loss.notesLabel')}
                </label>
                <textarea
                  className="input"
                  rows={2}
                  value={lossNotes}
                  onChange={(e) => setLossNotes(e.target.value)}
                  placeholder={t('inventory.loss.notesPlaceholder')}
                />
              </div>
              <div className="rounded-md p-3" style={{ background: 'rgba(234,88,12,0.08)', border: '1px solid rgba(234,88,12,0.25)' }}>
                <div className="flex justify-between text-xs">
                  <span style={{ color: '#fdba74' }}>{t('inventory.loss.totalLossLabel')}</span>
                  <strong style={{ color: '#fb923c' }}>{formatCurrency(previewTotal)}</strong>
                </div>
                <p className="text-[11px] mt-2" style={{ color: '#fdba74', lineHeight: 1.5 }}>
                  ⚠️ {t('inventory.loss.warning')}
                </p>
              </div>
            </div>
          </Modal>
        );
      })()}

      {/* R-LOSSES-SHRINKAGE-V1: PIN gate — opens only after user confirms
          qty + reason. Successful authorization commits the loss + qty
          decrement via handleCommitLoss. */}
      <AdminPinGate
        open={lossPinOpen && !!lossTarget}
        adminPin={settings.adminPin || ''}
        onSuccess={handleCommitLoss}
        onCancel={() => setLossPinOpen(false)}
      />

      {/* COMPANION: per-row Request Approval modal. Only renders the
          modal subtree when a session is present (set by the click handler). */}
      {approvalSession && (
        <Suspense fallback={null}>
          <RequestApprovalModal
            open={approvalModalOpen}
            session={approvalSession}
            prefilledItem={approvalPrefillItem}
            onClose={() => setApprovalModalOpen(false)}
            onCreated={(id) => {
              void id;
              toast(t('inventory.approvalRequest.sent'), 'success');
              setApprovalModalOpen(false);
            }}
          />
        </Suspense>
      )}
    </>
  );
}

// ── Autocomplete keyboard nav hook (BUG-12 R-INV-FORM-UX) ────────────────
// Adds ↓↑ navigation, Enter-to-select, Esc/Tab-to-close to the existing
// onMouseDown-only suggestion lists used by name/supplier/brand inputs.
// Reset rules: activeIdx → -1 whenever the input value changes (re-typeo
// invalidates stale highlight) or after a selection. Tab does NOT
// preventDefault — the focus moves naturally and the dropdown closes.
function useAutocompleteKeyboard(opts: {
  inputValue: string;
  suggestions: string[];
  onSelect: (s: string) => void;
  onClose: () => void;
}): {
  activeIdx: number;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
} {
  const [activeIdx, setActiveIdx] = useState(-1);

  // Reset highlight whenever the input value changes (typing invalidates
  // the previously highlighted suggestion).
  useEffect(() => {
    setActiveIdx(-1);
  }, [opts.inputValue]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      const len = opts.suggestions.length;
      if (len === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, len - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && activeIdx >= 0 && activeIdx < len) {
        e.preventDefault();
        opts.onSelect(opts.suggestions[activeIdx]);
        opts.onClose();
        setActiveIdx(-1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        opts.onClose();
        setActiveIdx(-1);
      } else if (e.key === 'Tab') {
        // Don't preventDefault — let focus move naturally to next input.
        opts.onClose();
        setActiveIdx(-1);
      }
    },
    [opts, activeIdx],
  );

  return { activeIdx, onKeyDown };
}

// R-INVENTORY-SKUIMEI-V2: classify a unified scan-field value as
// IMEI-like vs SKU-like so we can keep the UI as one field while the
// underlying record stays correctly partitioned (imei vs sku).
//
// Rules:
//  - strip spaces and dashes (scanners and stickers vary)
//  - must be all digits after normalization
//  - 14–16 digits = IMEI (15) / IMEISV (16) / MEID-decimal-ish (14)
// Anything else (alphanumeric SKUs, short codes, blanks) is treated
// as a normal SKU.
function isLikelyImei(raw: string): boolean {
  const s = (raw || '').replace(/[\s-]/g, '');
  if (!/^\d+$/.test(s)) return false;
  return s.length >= 14 && s.length <= 16;
}

// R-INVENTORY-SCAN-DEDUP-V1: strip spaces and dashes for IMEI/barcode
// comparisons. Cashiers may type or scan formats with separators
// (e.g. "350-776-860-691-071") that should still match the canonical
// digit-only stored value.
function normalizeIdentifier(v: string | undefined | null): string {
  return String(v ?? '').replace(/[\s-]/g, '');
}

// ── Inventory Form Modal ──────────────────────────────────

function InventoryFormModal({
  item,
  categories,
  customCategories,
  allInventory,
  allSales,
  allPurchaseOrders,
  fieldConfig,
  onAddCategory,
  onSave,
  onClose,
  lang,
  settings,
}: {
  item: InventoryItem | null;
  categories: string[];
  customCategories: string[];
  allInventory: InventoryItem[];
  allSales: Sale[];
  allPurchaseOrders: PurchaseOrder[];
  fieldConfig: import('@/store/types').InventoryFieldConfig;
  onAddCategory: (newCat: string) => void;
  onSave: (data: Partial<InventoryItem>, opts?: { skipMerge?: boolean }) => void;
  onClose: () => void;
  lang: string;
  settings: { detectedPrinters?: string[] };
}) {
  const { t } = useTranslation();
  const isEdit = !!item;
  const { toast } = useToast();
  const { printHtml } = usePrint();
  const [zeroPriceConfirm, setZeroPriceConfirm] = useState(false);

  const [form, setForm] = useState({
    // R-INVENTORY-SKUIMEI-V2: form.sku holds whatever the unified field
    // shows (SKU or IMEI as typed). On submit, doSubmit routes IMEI-like
    // values into the imei column and clears sku. Fall back to item.imei
    // here so editing an IMEI-only legacy record still surfaces the value
    // in the unified input. form.imei keeps the canonical IMEI value and
    // is preserved unless the user explicitly types a new IMEI.
    sku:               item?.sku || item?.imei || '',
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
    // R-INVENTORY-PRODUCT-PHOTOS-V1: local-only product photo (data URL).
    // No remote upload, no online image search — owner picks a file from
    // disk, FileReader → data URL → stored on the inventory record.
    image:             item?.image || '',
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

  // R-INVENTORY-SKUIMEI-V1: ref for the unified SKU/IMEI input so we can
  // restore focus after a successful add — cashier-scan flow.
  const skuInputRef = useRef<HTMLInputElement>(null);

  // R-INVENTORY-FOCUS-HARDEN-V1: belt-and-suspenders focus helper.
  // The previous double-rAF pattern was racing against late renders
  // triggered by autofill setForm, banner mount/unmount, the Add Item
  // button's disable/enable, label-print toasts, and the duplicate
  // banner. This helper:
  //   1. defers via rAF past the current commit
  //   2. focuses + selects (so the next scan replaces any leftover
  //      text, e.g. an autofilled identifier)
  //   3. queues a setTimeout(0) tail that re-asserts focus after any
  //      task-queue microtasks (toast render, setForm follow-ups)
  // Stable identity (empty deps) — safe to include in effect deps.
  const focusSkuInput = useCallback(() => {
    requestAnimationFrame(() => {
      skuInputRef.current?.focus();
      skuInputRef.current?.select?.();
      setTimeout(() => skuInputRef.current?.focus(), 0);
    });
  }, []);

  // R-INVENTORY-SKU-FOCUS-RECLAIM-HARDENING-V1: tracks whether a window
  // focus listener is already pending so rapid saves never stack duplicates.
  const skuFocusListenerActiveRef = useRef(false);

  // R-INVENTORY-SKU-FOCUS-PREVIEW-MODAL-V1: dedup guard so the in-app
  // print-preview-close poll never stacks across rapid saves.
  const skuPreviewPollActiveRef = useRef(false);

  // R-INVENTORY-SKU-FOCUS-RECLAIM-HARDENING-V1: hardened SKU/IMEI focus
  // restore for new-item create flow only (isEdit guard lives at call site).
  //
  // SKU/IMEI focus is operator-speed critical — losing it after a label
  // print forces manual mouse clicks between every item add in a cashier
  // scan flow.
  //
  // Two-phase strategy:
  //   Phase 1 — immediate: focusSkuInput() via rAF covers the normal save
  //              path where no print dialog is shown.
  //   Phase 2 — deferred: a deduped window 'focus' listener fires when the
  //              Electron/browser print dialog closes and the main window
  //              regains focus, re-asserting SKU focus at that moment.
  //              skuFocusListenerActiveRef prevents ghost listeners from
  //              stacking on rapid saves or re-entrancy.
  const restoreSkuFocusAfterCreate = useCallback(() => {
    // Phase 1: immediate (no-print-dialog path).
    focusSkuInput();
    // Phase 2: deduped window listener (OS / browser print-dialog-close path).
    if (!skuFocusListenerActiveRef.current) {
      skuFocusListenerActiveRef.current = true;
      const handler = () => {
        skuFocusListenerActiveRef.current = false;
        focusSkuInput();
      };
      window.addEventListener('focus', handler, { once: true });
    }
    // Phase 3 — R-INVENTORY-SKU-FOCUS-PREVIEW-MODAL-V2: the single-item add
    // path prints with silent:false, which routes to the Electron in-app
    // PrintPreviewModal. That modal does NOT blur the window, so Phase 2 never
    // fires. V1 reclaimed focus with a single shot the moment the preview
    // closed — but a late React commit (the New Item form re-rendering after
    // the preview unmounts) stole it back, leaving no field focused. V2 splits
    // into two stages:
    //   Stage A — observe the preview modal's #print-content node (read-only —
    //     no print-logic coupling) until it has opened and then closed. If it
    //     never opens (labels skipped / silent batch), proceed after a grace.
    //   Stage B — double-rAF past the unmount/re-render commit, then a bounded
    //     RETRY loop (~120ms × up to 1.5s) that re-asserts SKU focus until it
    //     actually STICKS (document.activeElement === the input), surviving the
    //     late render that defeated V1.
    // Bounded + deduped so it can never run away or stack across rapid saves.
    if (!skuPreviewPollActiveRef.current) {
      skuPreviewPollActiveRef.current = true;
      let waitTicks = 0;
      let sawPreview = false;
      const GRACE_TICKS = 4;       // ~0.8s mount window before giving up on a preview
      const MAX_WAIT_TICKS = 40;   // ~8s hard ceiling
      const waitPoll = window.setInterval(() => {
        waitTicks++;
        const previewOpen = !!document.getElementById('print-content');
        if (previewOpen) {
          sawPreview = true;
          if (waitTicks < MAX_WAIT_TICKS) return;     // still open — keep waiting
        } else if (!sawPreview && waitTicks < GRACE_TICKS) {
          return;                                      // not mounted yet — wait briefly
        }
        // Preview is gone (closed, never appeared, or ceiling hit).
        window.clearInterval(waitPoll);
        console.debug('[InventoryFocus] preview closed');
        // Stage B: defer past the unmount/re-render commit, then retry until
        // focus sticks. Do NOT focus if the New Item input is gone (modal
        // closed) — el will stay null and the loop simply times out.
        requestAnimationFrame(() => requestAnimationFrame(() => {
          let attempts = 0;
          const MAX_ATTEMPTS = 12;     // ~1.5s at 120ms
          const tryFocus = () => {
            const el = skuInputRef.current;
            const visible = !!el && el.offsetParent !== null && !el.disabled;
            if (el && visible) {
              el.focus();
              el.select?.();
            }
            if (el && document.activeElement === el) {
              console.debug('[InventoryFocus] sku focus restored');
              skuPreviewPollActiveRef.current = false;
              return;                                  // stuck — done
            }
            attempts++;
            if (attempts >= MAX_ATTEMPTS) {
              console.debug('[InventoryFocus] sku focus retry failed');
              skuPreviewPollActiveRef.current = false;
              return;                                  // give up (modal likely closed)
            }
            window.setTimeout(tryFocus, 120);
          };
          tryFocus();
        }));
      }, 200);
    }
  }, [focusSkuInput]);

  // R-INVENTORY-SCAN-DEDUP-V1 + R-INVENTORY-FOCUS-HARDEN-V1: auto-focus
  // the unified SKU/IMEI input on Add Item modal open so the cashier
  // can scan immediately. Edit-mode skipped because the user may want
  // to land on a different field. Now routed through focusSkuInput so
  // the focus survives late renders (button enabling, async printer
  // load, etc.).
  useEffect(() => {
    if (!isEdit) {
      focusSkuInput();
    }
    // Mount-only: depending on isEdit (immutable for a given modal
    // instance) means this fires exactly once per modal open.
  }, [isEdit, focusSkuInput]);

  // ── Existing-item detection ────────────────────────────
  // R-INVENTORY-SCAN-DEDUP-V1: matches across sku, imei, and barcode
  // so a scan/typed value finds the existing record regardless of which
  // identifier slot it lives in. Tracks WHICH field matched so the
  // banner and the doSubmit guard can react appropriately (qty-merge
  // path for SKU; hard-block for IMEI/barcode since those are unique
  // per physical item).
  const [duplicateItem, setDuplicateItem] = useState<InventoryItem | null>(null);
  const [duplicateMatchField, setDuplicateMatchField] =
    useState<'sku' | 'imei' | 'barcode' | null>(null);
  const isDuplicate = !!duplicateItem;

  const checkDuplicate = useCallback((value: string) => {
    if (!value.trim() || isEdit) {
      setDuplicateItem(null);
      setDuplicateMatchField(null);
      return;
    }
    const lower = value.trim().toLowerCase();
    const norm = normalizeIdentifier(value);
    let match: InventoryItem | null = null;
    let field: 'sku' | 'imei' | 'barcode' | null = null;
    for (const i of allInventory) {
      if (i.sku && i.sku.trim().toLowerCase() === lower) {
        match = i; field = 'sku'; break;
      }
      if (norm && i.imei && normalizeIdentifier(i.imei) === norm) {
        match = i; field = 'imei'; break;
      }
      if (i.barcode) {
        const bcLower = i.barcode.trim().toLowerCase();
        const bcNorm = normalizeIdentifier(i.barcode);
        if (bcLower === lower || (norm && bcNorm === norm)) {
          match = i; field = 'barcode'; break;
        }
      }
    }
    setDuplicateItem(match);
    setDuplicateMatchField(field);
  }, [allInventory, isEdit]);

  // R-INVENTORY-AUTOFILL-V1: when a scan/typed identifier resolves to
  // an existing item, pull its fields into the form so the cashier can
  // see what was found. Driven by `duplicateItem` changing identity
  // (not by every keystroke) and gated by a ref so manual edits made
  // *after* autofill are preserved — re-autofill only fires when the
  // matched item changes (different identifier scanned) or when the
  // user clears the input and scans the same one again.
  //
  // form.sku is intentionally NOT overwritten — the user's typed value
  // stays in the unified input, so they don't lose what they scanned.
  // form.qty is preserved (it represents "qty to add" for the SKU
  // qty-merge path, not the existing stock count which the banner
  // already shows).
  const lastAutofilledIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (isEdit) return;
    if (!duplicateItem) {
      lastAutofilledIdRef.current = null;
      return;
    }
    if (lastAutofilledIdRef.current === duplicateItem.id) return;
    lastAutofilledIdRef.current = duplicateItem.id;
    const matched = duplicateItem;
    setForm((prev) => ({
      ...prev,
      name:              matched.name || '',
      description:       matched.description || '',
      category:          matched.category || prev.category,
      condition:         matched.condition || prev.condition,
      cost:              matched.cost || 0,
      price:             matched.price || 0,
      supplier:          matched.supplier || '',
      brand:             matched.brand || '',
      taxable:           matched.taxable ?? prev.taxable,
      cbeEligible:       matched.cbeEligible ?? prev.cbeEligible,
      screenFeeEligible: matched.screenFeeEligible ?? prev.screenFeeEligible,
      image:             matched.image || '',
      barcode:           matched.barcode || '',
      imei:              matched.imei || '',
      customFields:      { ...((matched.customFields as Record<string, string | number>) || {}) },
    }));
    // R-INVENTORY-FOCUS-HARDEN-V1: re-assert focus through the hardened
    // helper after autofill, in case the setForm-driven rerender
    // briefly shifted focus elsewhere. Also selects the existing text
    // so the cashier's next scan replaces it cleanly.
    focusSkuInput();
  }, [duplicateItem, isEdit, focusSkuInput]);

  // R-INVENTORY-FOCUS-RESTORE-V1 + R-INVENTORY-FOCUS-HARDEN-V1: shared
  // post-add / manual-clear reset helper. Wipes the form and all
  // dedup/autofill bookkeeping, then re-focuses via the hardened
  // focusSkuInput helper (rAF + focus + select + setTimeout(0) tail)
  // so focus survives the cascade of follow-up renders triggered by
  // the state clears above, the auto-print-label toast, and the
  // duplicate banner unmount.
  const resetFormAndFocus = useCallback(() => {
    setForm({
      sku: '', imei: '', barcode: '', name: '', description: '',
      category: 'accessory', condition: 'New',
      cost: 0, price: 0, qty: 1,
      supplier: '', brand: '',
      taxable: true, cbeEligible: false, screenFeeEligible: false,
      image: '',
      customFields: {},
    });
    setDuplicateItem(null);
    setDuplicateMatchField(null);
    lastAutofilledIdRef.current = null;
    focusSkuInput();
  }, [focusSkuInput]);

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

  // BUG-12 (R-INV-FORM-UX): keyboard nav for the 3 autocompletes (name,
  // supplier, brand). Each call wires its own activeIdx + onKeyDown handler.
  // Functional setForm prevents stale closure on rapid Enter selections.
  const nameSuggs = suggestionsForField('name', form.name);
  const supplierSuggs = suggestionsForField('supplier', form.supplier);
  const brandSuggs = suggestionsForField('brand', form.brand);
  const nameKb = useAutocompleteKeyboard({
    inputValue: form.name,
    suggestions: nameSuggs,
    onSelect: (s) => setForm((f) => ({ ...f, name: s })),
    onClose: () => setActiveSuggestField(null),
  });
  const supplierKb = useAutocompleteKeyboard({
    inputValue: form.supplier,
    suggestions: supplierSuggs,
    onSelect: (s) => setForm((f) => ({ ...f, supplier: s })),
    onClose: () => setActiveSuggestField(null),
  });
  const brandKb = useAutocompleteKeyboard({
    inputValue: form.brand,
    suggestions: brandSuggs,
    onSelect: (s) => setForm((f) => ({ ...f, brand: s })),
    onClose: () => setActiveSuggestField(null),
  });

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
            customerName: sale.customerName || 'Walk-in',
          });
        }
      }
    }
    matches.sort((a, b) => b.date.localeCompare(a.date));
    return matches.slice(0, 8);
  }, [form.name, allSales]);

  // ── Purchase History from POs (v1 parity) ─────────────
  // "Cuánto pagué la última vez que metí este modelo" — cross-references
  // POItem.name with what the user is typing. Uses receivedAt when available
  // (actual reception date), else createdAt. Unit cost from POItem.cost.
  interface PurchaseHistoryEntry {
    date: string;              // ISO
    cost: number;              // cents — unit cost from vendor
    qty: number;               // qtyReceived (or qtyOrdered if never received)
    vendor: string;
    poNumber: string;
  }
  const purchaseHistory: PurchaseHistoryEntry[] = useMemo(() => {
    if (!form.name || form.name.trim().length < 3) return [];
    const nameLower = form.name.trim().toLowerCase();
    const matches: PurchaseHistoryEntry[] = [];
    for (const po of allPurchaseOrders) {
      if (!Array.isArray(po.items)) continue;
      for (const poItem of po.items) {
        if (!poItem.name) continue;
        const itemLower = poItem.name.toLowerCase();
        // Same forward-match rule as sales history for consistency.
        if (itemLower.includes(nameLower)) {
          const dateVal = po.receivedAt || po.createdAt;
          const dateStr = typeof dateVal === 'string'
            ? dateVal
            : new Date(dateVal as unknown as string | Date).toISOString();
          matches.push({
            date: dateStr,
            cost: poItem.cost || 0,
            qty: poItem.qtyReceived || poItem.qtyOrdered || 0,
            vendor: po.vendor || t('inventory.form.vendor'),
            poNumber: po.poNumber || '',
          });
        }
      }
    }
    matches.sort((a, b) => b.date.localeCompare(a.date));
    return matches.slice(0, 8);
  }, [form.name, allPurchaseOrders, t]);

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
  // BUG-5 (R-INV-BUGS): accept overrides so doSubmit can auto-print one label
  // per item in batch mode (each with its own incremented SKU). silent=true
  // bypasses the preview modal — required for batch so N calls don't overwrite
  // each other's modal state. Manual click of the 🏷️ Label button passes no
  // overrides and keeps the preview-modal UX.
  const handleLabel = (overrides?: { sku?: string; silent?: boolean }) => {
    const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c] as string));
    const skuForLabel = overrides?.sku ?? form.sku;
    const code = esc(skuForLabel || form.imei || form.barcode || form.name.slice(0, 12));
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
      /* R-BARCODE-TEXT-READABILITY-V1: thermal/label printers were
         rendering the prior 7pt monospace too thin to read at arm's
         length. Bumped to 9pt + bold + Courier New (printer-safe
         monospace) with extra letter-spacing and a touch more margin
         from the barcode bars. Stays within the 1.25in label height. */
      .code { font-size: 9pt; font-weight: 700; font-family: 'Courier New', monospace; letter-spacing: 0.05em; text-align: center; margin-top: 2px; color: #000; }
      @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    </style></head><body>
      <div class="price">${price}</div>
      <div class="name">${name}</div>
      ${barcodeSvg}
      <div class="code">${code}</div>
    </body></html>`;

    printHtml(html, { silent: overrides?.silent ?? false, printer: settings.detectedPrinters?.[0] });
  };

  const isServiceLikeCategory = (cat: string) => {
    const c = (cat || '').toLowerCase();
    return c === 'service' || c === 'services' || c === 'servicio' || c === 'servicios';
  };

  const doSubmit = () => {
    // R-INVENTORY-SCAN-DEDUP-V1: hard-block on IMEI/barcode duplicates
    // for new items. SKU collisions intentionally fall through to the
    // existing qty-merge path in handleSave (parent), but IMEI and
    // barcode identify a unique physical item — silently creating a
    // second record would corrupt inventory accounting. Edit-mode is
    // skipped (the item itself is the "match"), and batch mode is
    // skipped because users only batch SKU-prefixed runs (IMEI-mode
    // batches don't make sense — each phone has its own IMEI).
    if (
      !isEdit &&
      !batchMode &&
      duplicateItem &&
      (duplicateMatchField === 'imei' || duplicateMatchField === 'barcode')
    ) {
      toast(
        duplicateMatchField === 'imei'
          ? t('inventory.form.imeiExists')
          : t('inventory.form.barcodeExists'),
        'error',
      );
      return;
    }

    // R-INVENTORY-SKUIMEI-V2: route the typed unified value to the
    // correct underlying column. IMEI-like input (digits, 14–16 chars
    // after normalization) lands in `imei` and clears `sku`; everything
    // else writes to `sku` and preserves the existing `imei` (per spec:
    // form.imei is replaced only when an IMEI is explicitly entered).
    const typed = form.sku;
    const routed = isLikelyImei(typed)
      ? { ...form, imei: typed.replace(/[\s-]/g, ''), sku: '' }
      : form;

    if (batchMode && batchCount > 1) {
      // Find max existing suffix for this SKU prefix to avoid collisions on re-run.
      // E.g. if "ABC-1", "ABC-2", "ABC-3" already exist, start the new batch at "ABC-4".
      let startIdx = 1;
      if (routed.sku) {
        const escaped = routed.sku.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`^${escaped}-(\\d+)$`, 'i');
        const max = allInventory.reduce((m, it) => {
          const match = (it.sku || '').match(re);
          return match ? Math.max(m, parseInt(match[1], 10)) : m;
        }, 0);
        startIdx = max + 1;
      }
      // Batch: create N distinct items, qty=1 each (UI clarifies this).
      // skipMerge prevents accidental merging into existing SKU on subsequent iterations.
      // BUG-5 (R-INV-BUGS): auto-print one label per item with its incremented
      // SKU. silent=true so N back-to-back calls go straight to the configured
      // printer instead of fighting over the preview-modal state.
      for (let i = 0; i < batchCount; i++) {
        const itemSku = routed.sku ? `${routed.sku}-${startIdx + i}` : '';
        onSave({
          ...routed,
          sku: itemSku,
          qty: 1,
        } as Partial<InventoryItem>, { skipMerge: true });
        if (!isEdit) handleLabel({ sku: itemSku, silent: true });
      }
    } else {
      onSave(routed as Partial<InventoryItem>);
      // BUG-5: auto-print label after creating a single new item. Edit-mode
      // saves don't trigger auto-print (label content didn't change in
      // a meaningful way for the operator).
      if (!isEdit) {
        handleLabel();
        // R-INVENTORY-SKU-FOCUS-RECLAIM-HARDENING-V1: hardened helper covers
        // both normal-save (immediate rAF) and print-dialog (deduped window
        // 'focus' listener) focus reclaim paths.
        restoreSkuFocusAfterCreate();
      }
    }
    if (!isEdit) {
      // BUG-11 (R-INV-FORM-UX): full reset post-save instead of partial.
      // R-INVENTORY-FOCUS-RESTORE-V1: routed through the shared
      // resetFormAndFocus helper so dup/autofill bookkeeping is cleared
      // alongside the form, and focus is double-rAF'd onto the
      // SKU/IMEI input. Covers single-add, batch-add, and SKU
      // qty-merge paths (handleSave returns synchronously in all three).
      resetFormAndFocus();
    }
  };

  const handleSubmit = () => {
    if (!form.name.trim()) {
      toast(t('inventory.form.itemNameRequired'), 'error');
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

  // R-FINANCIAL-PRIVACY-V2: also gate the in-form margin indicator. Reads
  // isAdminMode + currentEmployee inline (settings is already available
  // via props) so InventoryFormModal stays additive.
  const { state: { isAdminMode: _isAdminFormMode, currentEmployee: _currentEmpForm } } = useApp();
  const formCanSeeOwnerFinancials = canViewOwnerFinancials(
    settings,
    _isAdminFormMode || _currentEmpForm?.role === 'owner',
  );

  const CATEGORIES = [
    { value: 'phone',     label: t('inventory.form.cat.phones') },
    { value: 'accessory', label: t('inventory.form.cat.accessories') },
    { value: 'part',      label: t('inventory.form.cat.parts') },
    { value: 'service',   label: t('inventory.form.cat.services') },
    // R-SIM-INTAKE: built-in 'sim' category. The CATEGORIES `value` is the
    // canonical lowercase form; the inventory tab/normCat uppercase it for
    // display ('SIM').
    { value: 'sim',       label: t('inventory.form.cat.sim') },
    { value: 'top_up',    label: 'Top Up' },
    { value: 'other',     label: t('inventory.form.cat.other') },
  ];

  const CONDITIONS = ['New', 'Excellent', 'Good', 'Fair', 'Refurbished', 'For Parts'];
  const CONDITION_LABELS: Record<string, string> = {
    New: t('condition.new'),
    Excellent: t('condition.excellent'),
    Good: t('condition.good'),
    Fair: t('condition.fair'),
    Refurbished: t('condition.refurbished'),
    'For Parts': t('condition.forParts'),
  };

  return (
    <>
    <Modal
      open
      onClose={onClose}
      title={isEdit ? `✏️ ${t('inventory.form.editTitle')}` : `📦 ${t('inventory.form.newTitle')}`}
      size="max-w-lg"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem', maxHeight: '68vh', overflowY: 'auto', paddingRight: '2px' }}>

        {/* SKU / IMEI + Generate + Label.
            R-INVENTORY-SKUIMEI-V1: unified scan field. Accepts either a
            normal SKU or an IMEI — whatever the cashier scans/types lands
            in form.sku. Existing form.imei is preserved on edit (the form
            state is initialized from item?.imei) so phones with IMEIs
            captured prior to this change keep their value. */}
        {show('sku') && (
        <div>
          <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>
            {t('inventory.skuImei')}{req('sku') && ' *'}
          </label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              ref={skuInputRef}
              className="input"
              style={{ flex: 1 }}
              placeholder={t('inventory.skuImei')}
              value={form.sku}
              onChange={(e) => {
                const v = e.target.value;
                setForm({ ...form, sku: v });
                // R-INVENTORY-SCAN-DEDUP-V1: pass the raw typed value;
                // the broader checkDuplicate matches across sku, imei,
                // and barcode (with space/dash normalization for IMEI
                // and numeric barcodes). Distinguishes match type so
                // the banner and the doSubmit guard react correctly.
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
              {t('inventory.form.generate')}
            </button>
            <button
              onClick={() => handleLabel()}
              style={{
                padding: '0 0.875rem', borderRadius: '0.5rem',
                border: 'none',
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                color: 'white', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
            >
              🏷️ {t('inventory.form.labelBtn')}
            </button>
          </div>
        </div>
        )}

        {/* ── Existing-item warning banner ──
            R-INVENTORY-SCAN-DEDUP-V1: title + description switch on the
            matched identifier. SKU keeps the qty-merge wording (handleSave
            still merges qty for SKU collisions). IMEI/barcode show the
            hard-block wording — those identifiers are unique per item, so
            saving is rejected. */}
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
            ⚠️ <strong>
              {duplicateMatchField === 'imei' && t('inventory.form.imeiExists')}
              {duplicateMatchField === 'barcode' && t('inventory.form.barcodeExists')}
              {(duplicateMatchField === 'sku' || duplicateMatchField === null) && t('inventory.form.skuExists')}
            </strong> —{' '}
            {duplicateMatchField === 'sku'
              ? t('inventory.form.skuExistsDesc', duplicateItem.name, duplicateItem.qty)
              : t('inventory.form.itemExistsDesc', duplicateItem.name)}
          </div>
        )}

        {/* Item Name */}
        <div style={{ position: 'relative' }}>
          <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>
            {t('inventory.form.itemName')} *
          </label>
          <input
            className="input"
            placeholder={t('inventory.form.itemNamePlaceholder')}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            onFocus={() => setActiveSuggestField('name')}
            onBlur={() => setTimeout(() => setActiveSuggestField(null), 150)}
            onKeyDown={nameKb.onKeyDown}
            autoFocus={!isEdit}
            style={{ fontSize: '1rem' }}
          />
          {activeSuggestField === 'name' && nameSuggs.length > 0 && (
            <div style={dropdownStyle}>
              {nameSuggs.map((s, idx) => (
                <button key={s} type="button"
                  style={{ ...dropdownItemStyle, background: idx === nameKb.activeIdx ? 'rgba(102,126,234,0.15)' : 'transparent' }}
                  onMouseDown={(e) => { e.preventDefault(); setForm({ ...form, name: s }); setActiveSuggestField(null); }}>
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Purchase History panel (v1 parity — what you PAID) ── */}
        {purchaseHistory.length > 0 && (
          <div style={{
            background: 'rgba(251,146,60,0.07)',
            border: '1px solid rgba(251,146,60,0.3)',
            borderRadius: '0.5rem',
            padding: '0.6rem 0.75rem',
          }}>
            <div style={{ fontSize: '0.72rem', color: '#fb923c', fontWeight: 700, marginBottom: '0.4rem' }}>
              🛒 {t('inventory.form.purchaseHistory')} ({purchaseHistory.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', maxHeight: '140px', overflowY: 'auto' }}>
              {purchaseHistory.map((ph, idx) => (
                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#cbd5e1', gap: '0.5rem' }}>
                  <span style={{ color: '#64748b', minWidth: '5.5rem' }}>{ph.date.slice(0, 10)}</span>
                  <span style={{ color: '#94a3b8', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ph.vendor}{ph.poNumber ? ` · ${ph.poNumber}` : ''}
                  </span>
                  <span style={{ color: '#94a3b8', minWidth: '2.5rem', textAlign: 'right' }}>× {ph.qty}</span>
                  <span style={{ fontWeight: 700, color: '#fdba74', minWidth: '4.5rem', textAlign: 'right' }}>{formatCurrency(ph.cost)}</span>
                </div>
              ))}
            </div>
            {(() => {
              const costs = purchaseHistory.map((p) => p.cost);
              const lastCost = purchaseHistory[0].cost;
              const avg = costs.reduce((s, c) => s + c, 0) / costs.length;
              const min = Math.min(...costs);
              const max = Math.max(...costs);
              return (
                <>
                  <div style={{ marginTop: '0.4rem', paddingTop: '0.4rem', borderTop: '1px solid rgba(251,146,60,0.25)', display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem' }}>
                    <span style={{ color: '#64748b' }}>{t('inventory.form.last')}: <strong style={{ color: '#fdba74' }}>{formatCurrency(lastCost)}</strong></span>
                    <span style={{ color: '#64748b' }}>{t('inventory.form.avg')}: <strong style={{ color: '#cbd5e1' }}>{formatCurrency(Math.round(avg))}</strong></span>
                    <span style={{ color: '#64748b' }}>{t('inventory.form.min')}: <strong style={{ color: '#cbd5e1' }}>{formatCurrency(min)}</strong></span>
                    <span style={{ color: '#64748b' }}>{t('inventory.form.max')}: <strong style={{ color: '#cbd5e1' }}>{formatCurrency(max)}</strong></span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, cost: lastCost }))}
                    style={{
                      marginTop: '0.4rem',
                      width: '100%',
                      background: 'rgba(251,146,60,0.12)',
                      border: '1px solid rgba(251,146,60,0.4)',
                      color: '#fdba74',
                      borderRadius: '0.4rem',
                      padding: '0.35rem 0.5rem',
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    📋 {t('inventory.form.useLastCost', formatCurrency(lastCost))}
                  </button>
                </>
              );
            })()}
          </div>
        )}

        {/* ── Sales Price History panel ── */}
        {priceHistory.length > 0 && (
          <div style={{
            background: 'rgba(34,211,238,0.06)',
            border: '1px solid rgba(34,211,238,0.25)',
            borderRadius: '0.5rem',
            padding: '0.6rem 0.75rem',
          }}>
            <div style={{ fontSize: '0.72rem', color: '#67e8f9', fontWeight: 700, marginBottom: '0.4rem' }}>
              💰 {t('inventory.form.salesHistory')} ({priceHistory.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', maxHeight: '140px', overflowY: 'auto' }}>
              {priceHistory.map((ph, idx) => (
                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#cbd5e1', gap: '0.5rem' }}>
                  <span style={{ color: '#64748b', minWidth: '5.5rem' }}>{ph.date.slice(0, 10)}</span>
                  <span style={{ color: '#94a3b8', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ph.customerName}</span>
                  <span style={{ color: '#94a3b8', minWidth: '2.5rem', textAlign: 'right' }}>× {ph.qty}</span>
                  <span style={{ fontWeight: 700, color: '#86efac', minWidth: '4.5rem', textAlign: 'right' }}>{formatCurrency(ph.price)}</span>
                </div>
              ))}
            </div>
            {(() => {
              const prices = priceHistory.map((p) => p.price);
              const lastPrice = priceHistory[0].price;
              const avg = prices.reduce((s, p) => s + p, 0) / prices.length;
              const min = Math.min(...prices);
              const max = Math.max(...prices);
              return (
                <>
                  <div style={{ marginTop: '0.4rem', paddingTop: '0.4rem', borderTop: '1px solid rgba(34,211,238,0.2)', display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem' }}>
                    <span style={{ color: '#64748b' }}>{t('inventory.form.last')}: <strong style={{ color: '#86efac' }}>{formatCurrency(lastPrice)}</strong></span>
                    <span style={{ color: '#64748b' }}>{t('inventory.form.avg')}: <strong style={{ color: '#cbd5e1' }}>{formatCurrency(Math.round(avg))}</strong></span>
                    <span style={{ color: '#64748b' }}>{t('inventory.form.min')}: <strong style={{ color: '#cbd5e1' }}>{formatCurrency(min)}</strong></span>
                    <span style={{ color: '#64748b' }}>{t('inventory.form.max')}: <strong style={{ color: '#cbd5e1' }}>{formatCurrency(max)}</strong></span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, price: lastPrice }))}
                    style={{
                      marginTop: '0.4rem',
                      width: '100%',
                      background: 'rgba(34,211,238,0.1)',
                      border: '1px solid rgba(34,211,238,0.35)',
                      color: '#86efac',
                      borderRadius: '0.4rem',
                      padding: '0.35rem 0.5rem',
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    📋 {t('inventory.form.useLastPrice', formatCurrency(lastPrice))}
                  </button>
                </>
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
              {t('inventory.category')}{req('category') && ' *'}
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
                {/* BUG-CAT (R-SIM-INTAKE): user-added custom categories. */}
                {customCategories
                  .filter((c) => {
                    const lc = c.toLowerCase();
                    return !categories.some((cat) => cat.toLowerCase() === lc)
                      && !CATEGORIES.some((cat) => cat.value.toLowerCase() === lc);
                  })
                  .map((c) => (
                    <option key={`custom-${c}`} value={c}>{c}</option>
                  ))}
                <option value="__add__">{t('inventory.form.addNew')}</option>
              </select>
            ) : (
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <input
                  className="input"
                  style={{ flex: 1 }}
                  placeholder={t('inventory.form.catNamePlaceholder')}
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
              {t('inventory.form.condition')}{req('condition') && ' *'}
            </label>
            <select
              className="select"
              value={form.condition}
              onChange={(e) => setForm({ ...form, condition: e.target.value })}
            >
              {CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABELS[c] ?? c}</option>)}
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
              {t('inventory.form.supplier')}{req('supplier') && ' *'}
            </label>
            <input
              className="input"
              placeholder={t('inventory.form.vendorPlaceholder')}
              value={form.supplier}
              onChange={(e) => setForm({ ...form, supplier: e.target.value })}
              onFocus={() => setActiveSuggestField('supplier')}
              onBlur={() => setTimeout(() => setActiveSuggestField(null), 150)}
              onKeyDown={supplierKb.onKeyDown}
            />
            {activeSuggestField === 'supplier' && supplierSuggs.length > 0 && (
              <div style={dropdownStyle}>
                {supplierSuggs.map((s, idx) => (
                  <button key={s} type="button"
                    style={{ ...dropdownItemStyle, background: idx === supplierKb.activeIdx ? 'rgba(102,126,234,0.15)' : 'transparent' }}
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
              {t('inventory.form.brand')}{req('brand') && ' *'}
            </label>
            <input
              className="input"
              placeholder="Apple, Samsung, etc."
              value={form.brand}
              onChange={(e) => setForm({ ...form, brand: e.target.value })}
              onFocus={() => setActiveSuggestField('brand')}
              onBlur={() => setTimeout(() => setActiveSuggestField(null), 150)}
              onKeyDown={brandKb.onKeyDown}
            />
            {activeSuggestField === 'brand' && brandSuggs.length > 0 && (
              <div style={dropdownStyle}>
                {brandSuggs.map((s, idx) => (
                  <button key={s} type="button"
                    style={{ ...dropdownItemStyle, background: idx === brandKb.activeIdx ? 'rgba(102,126,234,0.15)' : 'transparent' }}
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
              {t('inventory.cost')}{req('cost') && ' *'}
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
              {t('inventory.price')}{req('price') && ' *'}
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
              {t('inventory.form.quantity')}{req('qty') && ' *'}
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

        {/* Margin indicator — R-FINANCIAL-PRIVACY-V2: owner-only. */}
        {formCanSeeOwnerFinancials && form.cost > 0 && form.price > 0 && (
          <div style={{
            padding: '0.5rem 0.75rem',
            background: marginDollars >= 0 ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
            border: `1px solid ${marginDollars >= 0 ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
            borderRadius: '0.5rem',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
              {isLoss ? t('inventory.form.potentialLoss') : t('inventory.form.potentialProfit')}
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
            {t('inventory.form.notes')}{req('description') && ' *'}
          </label>
          <textarea
            className="textarea"
            rows={2}
            placeholder={t('inventory.form.notesPlaceholder')}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            style={{ resize: 'vertical' }}
          />
        </div>
        )}

        {/* ── Product photo (R-INVENTORY-PRODUCT-PHOTOS-V1) ──
            Local-only file → data URL via FileReader. No remote upload,
            no online image search, no AI-generated images. Soft 2MB cap
            keeps localStorage from bloating with phone-camera dumps. */}
        <div>
          <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>
            {t('inventory.form.photoLabel')}
          </label>
          {form.image ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem', border: '1px solid var(--border-default)', borderRadius: '0.5rem', background: 'var(--bg-input)' }}>
              <img
                src={form.image}
                alt={form.name || 'product'}
                style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: '0.375rem', border: '1px solid var(--border-strong)' }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{t('inventory.form.photoLoaded')}</div>
              </div>
              <button
                type="button"
                onClick={() => setForm({ ...form, image: '' })}
                className="btn btn-secondary btn-sm"
              >
                {t('inventory.form.photoRemove')}
              </button>
            </div>
          ) : (
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 2 * 1024 * 1024) {
                  toast(t('inventory.form.photoTooLarge'), 'warning');
                  e.target.value = '';
                  return;
                }
                const reader = new FileReader();
                reader.onload = () => {
                  const dataUrl = typeof reader.result === 'string' ? reader.result : '';
                  if (dataUrl) setForm((f) => ({ ...f, image: dataUrl }));
                };
                reader.onerror = () => toast(t('inventory.form.photoReadError'), 'error');
                reader.readAsDataURL(file);
              }}
              className="input"
              style={{ padding: '0.4rem' }}
            />
          )}
        </div>

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
              {t('inventory.form.customFields')}
            </div>
            {fieldConfig.customFields.map((cf) => {
              const displayLabel = lang === 'es' && cf.labelEs ? cf.labelEs : cf.label;
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
                        {t('inventory.form.customSelect')}
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
            { key: 'taxable', label: t('inventory.form.taxable') },
            { key: 'cbeEligible', label: 'CBE Fee' },
            { key: 'screenFeeEligible', label: t('inventory.form.screenFee') },
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
              {t('inventory.form.batchCount')}
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
          {t('inventory.form.cancel')}
        </button>

        {/* Clear — R-INVENTORY-FOCUS-RESTORE-V1: shared helper so the
            manual clear path also clears dedup/autofill state and lands
            focus back on SKU/IMEI for the next scan.
            R-INVENTORY-ITEM-EDIT-AND-FOCUS-FLOW-V1: hidden in edit mode
            (resetFormAndFocus blanks to defaults, not back to item values). */}
        {!isEdit && <button
          onClick={resetFormAndFocus}
          style={{
            padding: '0 0.875rem', borderRadius: '0.625rem',
            border: '1px solid rgba(255,255,255,0.15)',
            background: 'rgba(255,255,255,0.06)',
            color: '#94a3b8', cursor: 'pointer', fontSize: '0.82rem',
            display: 'flex', alignItems: 'center', gap: '0.35rem',
          }}
          title={t('inventory.form.clear')}
        >
          🗑️ {t('inventory.form.clear')}
        </button>}

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
            📦 {t('inventory.form.batchModeBtn')}
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
            <>{t('inventory.form.save')}</>
          ) : (
            <>✓ {batchMode ? `${t('inventory.add')} ${batchCount}` : t('inventory.addItem')}</>
          )}
        </button>
      </div>
    </Modal>
    <ConfirmDialog
      open={zeroPriceConfirm}
      title={t('inventory.form.zeroPriceTitle')}
      message={t('inventory.form.zeroPriceMsg')}
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

// ============================================================
// R-SIM-MANAGER-UI: dedicated SIM Card manager modal.
// Carrier-aware quick-add for cashier intake. Bypasses the
// generic InventoryFormModal — writes directly via persist +
// setInventory, with category='sim' / taxable=true / condition='New'
// hardcoded per spec.
// ============================================================

const SIM_CARRIERS = ['Verizon', 'AT&T', 'T-Mobile', 'H2O', 'Simple Mobile', 'Other'];

interface SimManagerModalProps {
  open: boolean;
  onClose: () => void;
  inventory: InventoryItem[];
  setInventory: (next: InventoryItem[]) => void;
  toast: (msg: string, kind?: 'success' | 'error' | 'info' | 'warning') => void;
  t: (key: string, ...args: any[]) => string;
}

function SimManagerModal({
  open, onClose, inventory, setInventory, toast, t,
}: SimManagerModalProps) {
  const [selectedCarrier, setSelectedCarrier] = useState<string>('All');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingSim, setEditingSim] = useState<InventoryItem | null>(null);
  const [batchScan, setBatchScan] = useState(false);
  const [subForm, setSubForm] = useState({
    carrier: '',
    name: '',
    imei: '',  // ICCID stored in imei field per spec (no types.ts touch)
    sku: '',
    cost: 0,
    price: 0,
    qty: 1,
  });
  const iccidInputRef = useRef<HTMLInputElement>(null);
  // Tracks the most recent value we auto-filled into subForm.name. If the
  // user later edits name, we won't clobber their text on the next carrier
  // change because prev.name will no longer match this ref.
  const lastAutoFillNameRef = useRef<string>('');

  // SIMs from inventory (category='sim' case-insensitive)
  const allSims = useMemo(
    () => inventory.filter((i) => (i.category || '').toLowerCase() === 'sim'),
    [inventory],
  );

  // Carriers present in current SIM inventory (for filter buttons).
  // Brand field doubles as carrier for SIMs (set in sub-form).
  const carriers = useMemo(() => {
    const set = new Set<string>();
    for (const s of allSims) {
      const c = (s.brand || (s as any).carrier || '').trim();
      if (c) set.add(c);
    }
    return Array.from(set).sort();
  }, [allSims]);

  // Filtered list — Available first, then Sold (per spec).
  const filteredSims = useMemo(() => {
    const base = selectedCarrier === 'All'
      ? allSims
      : allSims.filter((s) => (s.brand || '').toLowerCase() === selectedCarrier.toLowerCase());
    return [...base].sort((a, b) => {
      const aAvail = (a.qty || 0) > 0 ? 0 : 1;
      const bAvail = (b.qty || 0) > 0 ? 0 : 1;
      if (aAvail !== bAvail) return aAvail - bAvail;
      return (a.name || '').localeCompare(b.name || '');
    });
  }, [allSims, selectedCarrier]);

  const availableCount = useMemo(() => allSims.filter((s) => (s.qty || 0) > 0).length, [allSims]);
  const soldCount = allSims.length - availableCount;

  // Reset sub-form but KEEP the carrier — UX for batch entry of same carrier.
  // R-SIM-MANAGER-UX: also re-prime the auto-filled name so the next save
  // path (manual or batch) doesn't trip handleSubmit's nameRequired check.
  // R-SIM-BATCH-SMART: keep prev.cost and prev.price too — in batch mode the
  // cashier sets these once and reuses them across the whole batch.
  const resetSubFormKeepCarrier = () => {
    setSubForm((prev) => {
      const autoName = prev.carrier ? `${prev.carrier} Activation SIM` : '';
      lastAutoFillNameRef.current = autoName;
      return {
        carrier: prev.carrier,
        name: autoName,
        imei: '',
        sku: '',
        cost: prev.cost,
        price: prev.price,
        qty: 1,
      };
    });
  };

  // R-SIM-MANAGER-UX FIX 1: when carrier changes, auto-fill name with
  // "{Carrier} Activation SIM" — but only if the name is empty or matches
  // the previous auto-fill (i.e. user hasn't manually overridden it).
  const handleCarrierChange = (newCarrier: string) => {
    const newAutoName = newCarrier ? `${newCarrier} Activation SIM` : '';
    setSubForm((prev) => {
      const wasAutoFilled = prev.name === '' || prev.name === lastAutoFillNameRef.current;
      const nextName = wasAutoFilled ? newAutoName : prev.name;
      lastAutoFillNameRef.current = newAutoName;
      return { ...prev, carrier: newCarrier, name: nextName };
    });
  };

  const handleSubmit = () => {
    if (!subForm.name.trim()) {
      toast(t('inventory.simManager.nameRequired'), 'error');
      return;
    }
    const priceCents = Math.round(subForm.price * 100);
    const costCents = Math.round(subForm.cost * 100);

    if (editingSim) {
      const updated: InventoryItem = {
        ...editingSim,
        name: subForm.name.trim(),
        brand: subForm.carrier,
        imei: subForm.imei.trim(),
        sku: subForm.sku.trim(),
        barcode: subForm.sku.trim() || editingSim.barcode,
        cost: costCents,
        price: priceCents,
        qty: subForm.qty,
        category: 'sim',
        taxable: true,
        condition: 'New',
        updatedAt: new Date().toISOString(),
      } as InventoryItem;
      setInventory(inventory.map((i) => (i.id === updated.id ? updated : i)));
      persist.inventory(updated.id, updated as unknown as Record<string, unknown>);
      toast(t('inventory.saved'), 'success');
      setEditingSim(null);
      setShowAddForm(false);
      resetSubFormKeepCarrier();
    } else {
      const newSim: InventoryItem = {
        id: generateId(),
        sku: subForm.sku.trim(),
        barcode: subForm.sku.trim() || undefined,
        imei: subForm.imei.trim(),
        name: subForm.name.trim(),
        category: 'sim',
        condition: 'New',
        brand: subForm.carrier,
        cost: costCents,
        price: priceCents,
        qty: subForm.qty,
        cbeEligible: false,
        screenFeeEligible: false,
        taxable: true,
        createdAt: new Date().toISOString(),
      } as InventoryItem;
      setInventory([...inventory, newSim]);
      persist.inventory(newSim.id, newSim as unknown as Record<string, unknown>);
      toast(t('inventory.itemAdded'), 'success');
      // Stay in add-mode so the cashier can add more SIMs of the same carrier.
      resetSubFormKeepCarrier();
    }
  };

  // R-SIM-MANAGER-UX FIX 2: batch scan path. Carrier + cost + price are
  // entered once; ICCID is the only field that changes per scan. Saves
  // immediately, clears ICCID, refocuses input.
  // R-SIM-BATCH-SMART FIX 3: smart merge — if an existing SIM already has
  // the same ICCID, skip with a warning toast (each ICCID is one physical
  // SIM, so duplicates are operator error, not stock).
  const handleBatchSave = () => {
    if (!subForm.carrier) return;
    const iccid = subForm.imei.trim();
    if (!iccid) return;

    const dup = inventory.find(
      (i) => (i.category || '').toLowerCase() === 'sim' && (i.imei || '') === iccid,
    );
    if (dup) {
      toast('⚠️ ICCID already in inventory — skipped', 'warning');
      setSubForm((prev) => ({ ...prev, imei: '' }));
      setTimeout(() => iccidInputRef.current?.focus(), 0);
      return;
    }

    const autoName = `${subForm.carrier} Activation SIM`;
    const skuPrefix = subForm.carrier.slice(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, 'S');
    const autoSku = `${skuPrefix}-${Date.now().toString().slice(-6)}`;
    const priceCents = Math.round(subForm.price * 100);
    const costCents = Math.round(subForm.cost * 100);

    const newSim: InventoryItem = {
      id: generateId(),
      sku: autoSku,
      barcode: autoSku,
      imei: iccid,
      name: autoName,
      category: 'sim',
      condition: 'New',
      brand: subForm.carrier,
      cost: costCents,
      price: priceCents,
      qty: 1,
      cbeEligible: false,
      screenFeeEligible: false,
      taxable: true,
      createdAt: new Date().toISOString(),
    } as InventoryItem;
    setInventory([...inventory, newSim]);
    persist.inventory(newSim.id, newSim as unknown as Record<string, unknown>);
    toast('✅ SIM added — scan next', 'success');

    setSubForm((prev) => ({ ...prev, imei: '' }));
    // Refocus on the next tick so the value clear has flushed.
    setTimeout(() => iccidInputRef.current?.focus(), 0);
  };

  // R-SIM-MANAGER-UX FIX 2: when batch turns on (or carrier changes while
  // batch is already on), focus the ICCID input so a barcode scanner can
  // start firing keystrokes immediately.
  useEffect(() => {
    if (batchScan && subForm.carrier && iccidInputRef.current) {
      iccidInputRef.current.focus();
    }
  }, [batchScan, subForm.carrier]);

  const handleEditClick = (sim: InventoryItem) => {
    setEditingSim(sim);
    setShowAddForm(true);
    setBatchScan(false);
    lastAutoFillNameRef.current = '';
    setSubForm({
      carrier: sim.brand || '',
      name: sim.name || '',
      imei: sim.imei || '',
      sku: sim.sku || '',
      cost: (sim.cost || 0) / 100,
      price: (sim.price || 0) / 100,
      qty: sim.qty || 0,
    });
  };

  const handleAddClick = () => {
    setEditingSim(null);
    setShowAddForm(true);
    lastAutoFillNameRef.current = '';
    setSubForm({ carrier: '', name: '', imei: '', sku: '', cost: 0, price: 0, qty: 1 });
  };

  const handleCancelSubForm = () => {
    setEditingSim(null);
    setShowAddForm(false);
  };

  const handleGenerateSku = () => {
    const prefix = (subForm.carrier || 'SIM').slice(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, 'S');
    const ts = Date.now().toString().slice(-6);
    setSubForm({ ...subForm, sku: `${prefix}-${ts}` });
  };

  if (!open) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title={t('inventory.simManager.title')}
      size="max-w-2xl"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem', maxHeight: '72vh' }}>
        {/* R-SIM-MANAGER-UX FIX 3: scroll only the header+list. Sub-form
            lives OUTSIDE this container so it stays visible while the
            cashier scrolls the SIM list (essential for batch scanning). */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem', overflowY: 'auto', flex: 1, minHeight: 0 }}>

          {/* ── Section A: Header ── */}
          <div>
            <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: '0.5rem' }}>
              <span style={{ color: '#22c55e', fontWeight: 700 }}>{availableCount}</span>
              {' '}available · {' '}
              <span style={{ color: '#f87171', fontWeight: 700 }}>{soldCount}</span>
              {' '}sold
            </div>

            {/* Carrier filter buttons — only show carriers with >= 1 SIM */}
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
              <button
                type="button"
                onClick={() => setSelectedCarrier('All')}
                style={{
                  padding: '0.3rem 0.6rem', fontSize: '0.75rem', fontWeight: 700,
                  borderRadius: '0.4rem', cursor: 'pointer',
                  background: selectedCarrier === 'All' ? 'rgba(34,211,238,0.2)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${selectedCarrier === 'All' ? 'rgba(34,211,238,0.5)' : 'rgba(255,255,255,0.12)'}`,
                  color: selectedCarrier === 'All' ? '#67e8f9' : '#94a3b8',
                }}
              >
                {t('inventory.simManager.allCarriers')} ({allSims.length})
              </button>
              {carriers.map((c) => {
                const count = allSims.filter((s) => (s.brand || '').toLowerCase() === c.toLowerCase()).length;
                const active = selectedCarrier === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setSelectedCarrier(c)}
                    style={{
                      padding: '0.3rem 0.6rem', fontSize: '0.75rem', fontWeight: 700,
                      borderRadius: '0.4rem', cursor: 'pointer',
                      background: active ? 'rgba(34,211,238,0.2)' : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${active ? 'rgba(34,211,238,0.5)' : 'rgba(255,255,255,0.12)'}`,
                      color: active ? '#67e8f9' : '#cbd5e1',
                    }}
                  >
                    {c} ({count})
                  </button>
                );
              })}
            </div>

            {!showAddForm && (
              <button
                type="button"
                onClick={handleAddClick}
                className="btn btn-primary btn-sm"
              >
                {t('inventory.simManager.addSim')}
              </button>
            )}
          </div>

          {/* ── Section B: List of existing SIMs ── */}
          <div>
            {filteredSims.length === 0 ? (
              <div style={{
                padding: '1.5rem',
                textAlign: 'center',
                color: '#64748b',
                fontSize: '0.85rem',
                border: '1px dashed rgba(255,255,255,0.1)',
                borderRadius: '0.5rem',
              }}>
                {t('inventory.noItemsFound')}
              </div>
            ) : (
              <div style={{ overflowX: 'auto', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.5rem' }}>
                <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                      <th style={{ textAlign: 'left',  padding: '0.4rem 0.625rem', color: '#94a3b8', fontWeight: 700 }}>{t('inventory.simManager.carrier')}</th>
                      <th style={{ textAlign: 'left',  padding: '0.4rem 0.625rem', color: '#94a3b8', fontWeight: 700 }}>{t('inventory.form.itemName')}</th>
                      <th style={{ textAlign: 'left',  padding: '0.4rem 0.625rem', color: '#94a3b8', fontWeight: 700 }}>ICCID</th>
                      <th style={{ textAlign: 'left',  padding: '0.4rem 0.625rem', color: '#94a3b8', fontWeight: 700 }}>SKU</th>
                      <th style={{ textAlign: 'right', padding: '0.4rem 0.625rem', color: '#94a3b8', fontWeight: 700 }}>Qty</th>
                      <th style={{ textAlign: 'left',  padding: '0.4rem 0.625rem', color: '#94a3b8', fontWeight: 700 }}>Status</th>
                      <th style={{ textAlign: 'right', padding: '0.4rem 0.625rem', color: '#94a3b8', fontWeight: 700 }}>{t('inventory.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSims.map((sim) => {
                      const available = (sim.qty || 0) > 0;
                      return (
                        <tr key={sim.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                          <td style={{ padding: '0.4rem 0.625rem', color: '#cbd5e1', fontWeight: 600 }}>{sim.brand || '—'}</td>
                          <td style={{ padding: '0.4rem 0.625rem', color: '#e2e8f0' }}>{sim.name}</td>
                          <td style={{ padding: '0.4rem 0.625rem', color: '#94a3b8', fontFamily: 'monospace', fontSize: '0.72rem' }}>{sim.imei || '—'}</td>
                          <td style={{ padding: '0.4rem 0.625rem', color: '#94a3b8', fontFamily: 'monospace', fontSize: '0.72rem' }}>{sim.sku || '—'}</td>
                          <td style={{ padding: '0.4rem 0.625rem', color: '#cbd5e1', textAlign: 'right' }}>{sim.qty || 0}</td>
                          <td style={{ padding: '0.4rem 0.625rem' }}>
                            <span style={{
                              fontSize: '0.7rem', fontWeight: 700,
                              color: available ? '#22c55e' : '#f87171',
                            }}>
                              {available ? t('inventory.simManager.available') : t('inventory.simManager.sold')}
                            </span>
                          </td>
                          <td style={{ padding: '0.4rem 0.625rem', textAlign: 'right' }}>
                            <button
                              type="button"
                              onClick={() => handleEditClick(sim)}
                              style={{
                                padding: '0.2rem 0.5rem',
                                borderRadius: '0.35rem',
                                border: '1px solid rgba(255,255,255,0.12)',
                                background: 'rgba(255,255,255,0.05)',
                                color: '#cbd5e1',
                                cursor: 'pointer',
                                fontSize: '0.78rem',
                              }}
                              title={t('inventory.titleEdit')}
                            >
                              ✏️
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </div>

        {/* ── Section C: Sub-form (anchored below scroll, always visible) ── */}
        {showAddForm && (
          <div style={{
            border: '1px solid rgba(34,211,238,0.3)',
            borderRadius: '0.5rem',
            padding: '0.875rem',
            background: 'rgba(34,211,238,0.06)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.625rem',
          }}>
            {/* R-SIM-MANAGER-UX FIX 2: batch scan toggle. Off by default —
                non-batch flow is unchanged. */}
            {!editingSim && (
              <label style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem',
                fontSize: '0.78rem', color: '#cbd5e1', fontWeight: 600, cursor: 'pointer',
                padding: '0.4rem 0.6rem', borderRadius: '0.4rem',
                background: batchScan ? 'rgba(34,211,238,0.15)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${batchScan ? 'rgba(34,211,238,0.4)' : 'rgba(255,255,255,0.08)'}`,
              }}>
                <input
                  type="checkbox"
                  checked={batchScan}
                  onChange={(e) => setBatchScan(e.target.checked)}
                  style={{ width: '1rem', height: '1rem', cursor: 'pointer' }}
                />
                <span>⚡ Batch Scan Mode{batchScan ? ' — pick carrier, then scan ICCIDs' : ''}</span>
              </label>
            )}

            {batchScan ? (
              // R-SIM-BATCH-SMART FIX 1: Cost + Price entered once, reused
              // by every SIM saved in the batch. Carrier sits next to them.
              <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr', gap: '0.625rem' }}>
                <div>
                  <label style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>
                    {t('inventory.simManager.carrier')} *
                  </label>
                  <select
                    className="select"
                    value={subForm.carrier}
                    onChange={(e) => handleCarrierChange(e.target.value)}
                    style={{ width: '100%' }}
                  >
                    <option value="">— Select —</option>
                    {SIM_CARRIERS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>
                    Cost ($)
                  </label>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    min="0"
                    value={subForm.cost || ''}
                    onChange={(e) => setSubForm({ ...subForm, cost: parseFloat(e.target.value) || 0 })}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>
                    Price ($)
                  </label>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    min="0"
                    value={subForm.price || ''}
                    onChange={(e) => setSubForm({ ...subForm, price: parseFloat(e.target.value) || 0 })}
                    placeholder="0.00"
                  />
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.625rem' }}>
                <div>
                  <label style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>
                    {t('inventory.simManager.carrier')} *
                  </label>
                  <select
                    className="select"
                    value={subForm.carrier}
                    onChange={(e) => handleCarrierChange(e.target.value)}
                    style={{ width: '100%' }}
                  >
                    <option value="">— Select —</option>
                    {SIM_CARRIERS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>
                    {t('inventory.form.itemName')} *
                  </label>
                  <input
                    className="input"
                    placeholder="e.g. Verizon Activation SIM"
                    value={subForm.name}
                    onChange={(e) => setSubForm({ ...subForm, name: e.target.value })}
                  />
                </div>
              </div>
            )}

            <div>
              <label style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>
                {t('inventory.simManager.iccid')}
              </label>
              <input
                ref={iccidInputRef}
                className="input"
                placeholder={batchScan ? 'Scan ICCID — Enter to save' : 'Scan or type ICCID'}
                value={subForm.imei}
                onChange={(e) => setSubForm({ ...subForm, imei: e.target.value })}
                onKeyDown={(e) => {
                  if (batchScan && e.key === 'Enter') {
                    e.preventDefault();
                    handleBatchSave();
                  }
                }}
                onBlur={() => {
                  if (batchScan && subForm.imei.trim()) handleBatchSave();
                }}
                disabled={batchScan && !subForm.carrier}
                style={{ fontFamily: 'monospace', letterSpacing: '0.04em' }}
              />
            </div>

            {!batchScan && (
              <div>
                <label style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>
                  SKU
                </label>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <input
                    className="input"
                    style={{ flex: 1 }}
                    placeholder="SKU"
                    value={subForm.sku}
                    onChange={(e) => setSubForm({ ...subForm, sku: e.target.value })}
                  />
                  <button
                    type="button"
                    onClick={handleGenerateSku}
                    style={{
                      padding: '0 0.75rem', borderRadius: '0.4rem',
                      border: '1px solid rgba(255,255,255,0.15)',
                      background: 'rgba(255,255,255,0.07)',
                      color: '#e2e8f0', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {t('inventory.form.generate')}
                  </button>
                </div>
              </div>
            )}

            {!batchScan && (
              // R-SIM-BATCH-SMART FIX 2: Cost added next to Price (same
              // order as InventoryFormModal). Qty kept as 3rd column.
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.625rem' }}>
                <div>
                  <label style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>
                    Cost ($)
                  </label>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    min="0"
                    value={subForm.cost || ''}
                    onChange={(e) => setSubForm({ ...subForm, cost: parseFloat(e.target.value) || 0 })}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>
                    Price ($)
                  </label>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    min="0"
                    value={subForm.price || ''}
                    onChange={(e) => setSubForm({ ...subForm, price: parseFloat(e.target.value) || 0 })}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>
                    Qty
                  </label>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="1"
                    value={subForm.qty}
                    onChange={(e) => setSubForm({ ...subForm, qty: parseInt(e.target.value, 10) || 0 })}
                  />
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
              <button
                type="button"
                onClick={handleCancelSubForm}
                className="btn btn-secondary"
                style={{ flex: 1 }}
              >
                {batchScan ? 'Done' : t('inventory.form.cancel')}
              </button>
              {!batchScan && (
                <button
                  type="button"
                  onClick={handleSubmit}
                  className="btn btn-primary"
                  style={{ flex: 2 }}
                >
                  {editingSim ? t('inventory.form.save') : t('inventory.simManager.saveBtn')}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
