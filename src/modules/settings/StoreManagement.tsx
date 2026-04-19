// ============================================================
// CellHub Pro — Store Management (Multi-Store UI)
// ============================================================

import { useState } from 'react';
import { useMultiStore } from '@/store/MultiStoreProvider';
import { Modal, ConfirmDialog } from '@/components/ui';
import type { StoreProfile } from '@/store/multiStoreTypes';

interface StoreManagementProps {
  lang: string;
  L: Record<string, any>;
}

export default function StoreManagement({ lang, L }: StoreManagementProps) {
  const {
    state: { stores, currentStore, registration, enabled, consolidatedView },
    addStore, updateStore, deactivateStore, registerComputer, setConsolidatedView,
  } = useMultiStore();

  const [showAddModal, setShowAddModal] = useState(false);
  const [editStore, setEditStore] = useState<StoreProfile | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '', address: '', phone: '', email: '', website: '',
    taxRate: 0.0925, timezone: 'America/Los_Angeles',
    inventoryMode: 'shared' as 'per_store' | 'shared',
  });

  const activeStores = stores.filter((s) => s.active);

  const openAdd = () => {
    setEditStore(null);
    setForm({
      name: '', address: '', phone: '', email: '', website: '',
      taxRate: 0.0925, timezone: 'America/Los_Angeles', inventoryMode: 'shared',
    });
    setShowAddModal(true);
  };

  const openEdit = (store: StoreProfile) => {
    setEditStore(store);
    setForm({
      name: store.name, address: store.address, phone: store.phone,
      email: store.email, website: store.website || '',
      taxRate: store.taxRate, timezone: store.timezone,
      inventoryMode: store.inventoryMode,
    });
    setShowAddModal(true);
  };

  const handleSave = () => {
    if (!form.name.trim()) return;
    if (editStore) {
      updateStore(editStore.id, form);
    } else {
      addStore(form);
    }
    setShowAddModal(false);
    setEditStore(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">🏪 {lang === 'es' ? 'Multi-Tienda' : 'Multi-Store'}</h2>
        <button onClick={openAdd} className="btn btn-primary btn-sm">
          + {lang === 'es' ? 'Nueva Tienda' : 'Add Store'}
        </button>
      </div>

      {/* Current registration */}
      {registration && currentStore && (
        <div className="rounded-lg bg-brand-500/10 border border-brand-500/20 p-4">
          <p className="text-xs text-slate-400 uppercase mb-1">{lang === 'es' ? 'Esta computadora' : 'This Computer'}</p>
          <p className="text-sm text-white font-medium">
            📍 {currentStore.name}
            <span className="text-slate-500 ml-2">({registration.computerName})</span>
          </p>
        </div>
      )}

      {/* Consolidated view toggle */}
      {enabled && (
        <label className="flex items-center justify-between py-2 cursor-pointer">
          <span className="text-sm text-slate-300">
            {lang === 'es' ? 'Vista consolidada (todas las tiendas)' : 'Consolidated view (all stores)'}
          </span>
          <div
            className={`w-10 h-5 rounded-full transition-all relative cursor-pointer ${consolidatedView ? 'bg-brand-500' : 'bg-white/20'}`}
            onClick={() => setConsolidatedView(!consolidatedView)}
          >
            <div className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all ${consolidatedView ? 'left-5' : 'left-0.5'}`} />
          </div>
        </label>
      )}

      {/* Store list */}
      <div className="space-y-2">
        {activeStores.length === 0 ? (
          <div className="text-center py-8 text-slate-500">
            <span className="text-3xl block mb-2">🏪</span>
            <p className="text-sm">{lang === 'es' ? 'No hay tiendas configuradas' : 'No stores configured'}</p>
            <p className="text-xs text-slate-600 mt-1">
              {lang === 'es' ? 'Agrega tu primera tienda para empezar' : 'Add your first store to get started'}
            </p>
          </div>
        ) : (
          activeStores.map((store) => {
            const isCurrent = store.id === currentStore?.id;
            return (
              <div
                key={store.id}
                className={`glass-card p-4 transition-all ${
                  isCurrent ? 'border-brand-500/40' : ''
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm text-white font-medium">{store.name}</p>
                      {isCurrent && (
                        <span className="badge badge-success text-[10px]">Current</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">{store.address}</p>
                    <p className="text-xs text-slate-500">{store.phone}</p>
                    <div className="flex gap-3 mt-1 text-xs text-slate-600">
                      <span>Tax: {(store.taxRate * 100).toFixed(2)}%</span>
                      <span>Inventory: {store.inventoryMode === 'shared' ? 'Shared' : 'Per-store'}</span>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {!isCurrent && (
                      <button
                        onClick={() => registerComputer(store.id)}
                        className="btn btn-ghost btn-sm text-xs text-brand-400"
                        title="Switch to this store"
                      >
                        📍 Switch
                      </button>
                    )}
                    <button onClick={() => openEdit(store)} className="btn btn-ghost btn-sm">✏️</button>
                    <button onClick={() => setDeleteConfirm(store.id)} className="btn btn-ghost btn-sm text-red-400">🗑️</button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Add/Edit Modal */}
      <Modal
        open={showAddModal}
        onClose={() => { setShowAddModal(false); setEditStore(null); }}
        title={`🏪 ${editStore ? (lang === 'es' ? 'Editar Tienda' : 'Edit Store') : (lang === 'es' ? 'Nueva Tienda' : 'New Store')}`}
        size="max-w-md"
      >
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-400 block mb-1">{lang === 'es' ? 'Nombre de la tienda' : 'Store Name'} *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" placeholder="Go Cellular — Main" autoFocus />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">{lang === 'es' ? 'Dirección' : 'Address'}</label>
            <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="input" placeholder="516 N. Milpas St., Santa Barbara, CA 93103" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">{lang === 'es' ? 'Teléfono' : 'Phone'}</label>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="input" />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Email</label>
              <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">{lang === 'es' ? 'Tasa de Impuesto' : 'Tax Rate'}</label>
              <input type="number" value={form.taxRate} onChange={(e) => setForm({ ...form, taxRate: parseFloat(e.target.value) || 0 })} className="input" step="0.0001" />
              <p className="text-xs text-slate-500 mt-0.5">{(form.taxRate * 100).toFixed(2)}%</p>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">{lang === 'es' ? 'Inventario' : 'Inventory Mode'}</label>
              <select value={form.inventoryMode} onChange={(e) => setForm({ ...form, inventoryMode: e.target.value as any })} className="select">
                <option value="shared">{lang === 'es' ? 'Compartido' : 'Shared across stores'}</option>
                <option value="per_store">{lang === 'es' ? 'Por tienda' : 'Per store (separate)'}</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">Timezone</label>
            <select value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} className="select">
              <option value="America/Los_Angeles">Pacific (LA)</option>
              <option value="America/Denver">Mountain (Denver)</option>
              <option value="America/Chicago">Central (Chicago)</option>
              <option value="America/New_York">Eastern (NY)</option>
            </select>
          </div>
        </div>
        <div className="flex gap-3 mt-4 pt-4 border-t border-white/10">
          <button onClick={() => setShowAddModal(false)} className="btn btn-secondary flex-1">{L.cancel}</button>
          <button onClick={handleSave} className="btn btn-primary flex-1">{editStore ? L.save : L.create}</button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteConfirm}
        title={lang === 'es' ? 'Desactivar Tienda' : 'Deactivate Store'}
        message={lang === 'es' ? '¿Desactivar esta tienda? Los datos se conservarán.' : 'Deactivate this store? Data will be preserved.'}
        variant="danger"
        onConfirm={() => { if (deleteConfirm) deactivateStore(deleteConfirm); setDeleteConfirm(null); }}
        onCancel={() => setDeleteConfirm(null)}
      />
    </div>
  );
}
