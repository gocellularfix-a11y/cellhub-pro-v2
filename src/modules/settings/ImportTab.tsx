// ============================================================
// CellHub Pro — CSV Importer (R-IMPORTER-V1)
//
// Lets the cashier import customers or inventory from any CSV
// (RepairDesk, RepairShopr, Square export, Excel, etc.). Inline
// CSV parser (no PapaParse dep), auto-mapping with field aliases,
// preview, and per-row dedup before persistence.
//
// State machine: idle → mapping → preview → done. Each step has
// its own render block. Cancel/Back returns to the previous step.
//
// Decisions (see R-IMPORTER-V1 phase-1 report):
//  - Inline CSV parser (Option B): no new dependencies.
//  - Lives as a sub-section of the existing Settings → Backup tab.
//  - Persist + setCustomers/setInventory in batch so new records
//    appear immediately in their respective modules.
//  - Customer name auto-splits to firstName/lastName when only
//    `name` is mapped (preserves data on legacy single-column CSVs).
//  - normalizePhone applied before dedup so "(805) 555-1234" and
//    "8055551234" hit the same dedup bucket.
// ============================================================

import { useState, useMemo } from 'react';
import { useApp } from '@/store/AppProvider';
import { useToast } from '@/components/ui/Toast';
import { useTranslation } from '@/i18n';
import { generateId } from '@/utils/dates';
import { normalizePhone } from '@/utils/normalize';
import { persist } from '@/services/persist';
import type { Customer, InventoryItem, InventoryCategory } from '@/store/types';

// ── Inline CSV parser ─────────────────────────────────────
// Handles: quoted fields, escaped quotes ("" → "), CRLF/LF, trim.
// Does NOT handle: multiline cells, BOM. Sufficient for typical
// RepairDesk / Square / Excel CSV exports. PapaParse can be added
// in a follow-up round if a customer hits an edge case.
function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  // Strip UTF-8 BOM if present (common on Excel exports)
  const cleaned = text.replace(/^﻿/, '');
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const splitRow = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && line[i + 1] === '"' && inQ) {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQ = !inQ;
      } else if (ch === ',' && !inQ) {
        out.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out.map((c) => c.trim());
  };

  const headers = splitRow(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const cells = splitRow(line);
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => {
      rec[h] = cells[i] ?? '';
    });
    return rec;
  });
  return { headers, rows };
}

// ── Field aliases for auto-detection ──────────────────────
const CUSTOMER_FIELD_ALIASES: Record<string, string[]> = {
  name:      ['name', 'full_name', 'fullname', 'customer_name', 'customer', 'nombre', 'cliente'],
  firstName: ['first_name', 'firstname', 'first', 'nombre_pila', 'primer_nombre'],
  lastName:  ['last_name', 'lastname', 'last', 'apellido', 'apellidos'],
  phone:     ['phone', 'phone_number', 'mobile', 'cell', 'cellphone', 'telefono', 'celular', 'movil'],
  email:     ['email', 'email_address', 'correo', 'correo_electronico', 'e_mail'],
  address:   ['address', 'street', 'street_address', 'direccion', 'addr'],
  notes:     ['notes', 'note', 'comments', 'comment', 'notas', 'comentarios'],
};

const INVENTORY_FIELD_ALIASES: Record<string, string[]> = {
  name:     ['name', 'item_name', 'product_name', 'product', 'description', 'item', 'nombre', 'producto'],
  sku:      ['sku', 'barcode', 'upc', 'code', 'item_code', 'product_code', 'codigo'],
  price:    ['price', 'sale_price', 'retail_price', 'list_price', 'precio'],
  cost:     ['cost', 'cost_price', 'purchase_price', 'wholesale', 'costo'],
  quantity: ['quantity', 'qty', 'stock', 'on_hand', 'cantidad', 'inventario'],
  category: ['category', 'type', 'product_type', 'categoria'],
  brand:    ['brand', 'manufacturer', 'make', 'marca'],
  supplier: ['supplier', 'vendor', 'proveedor'],
};

const SKIP = '__skip__';

// Normalize header name for alias matching (lowercase, replace separators with _).
function normalizeHeader(h: string): string {
  return h.toLowerCase().trim().replace(/[\s\-/.]+/g, '_').replace(/[^a-z0-9_]/g, '');
}

function autoDetect(
  headers: string[],
  aliases: Record<string, string[]>,
): Record<string, string> {
  const used = new Set<string>();
  const mapping: Record<string, string> = {};
  for (const h of headers) {
    const norm = normalizeHeader(h);
    let found: string | null = null;
    for (const [field, aliasList] of Object.entries(aliases)) {
      if (used.has(field)) continue;
      if (aliasList.includes(norm)) {
        found = field;
        break;
      }
    }
    if (found) {
      mapping[h] = found;
      used.add(found);
    } else {
      mapping[h] = SKIP;
    }
  }
  return mapping;
}

// ── Component types ───────────────────────────────────────
type ImportType = 'customers' | 'inventory';
type Step = 'idle' | 'mapping' | 'preview' | 'done';

interface ImportResult {
  imported: number;
  skipped: number;
  errors: number;
}

// ── Main component ────────────────────────────────────────
export default function ImportTab() {
  const {
    state: { customers, inventory, settings, currentStoreId },
    setCustomers,
    setInventory,
  } = useApp();
  const { t } = useTranslation();
  const { toast } = useToast();

  const [importType, setImportType] = useState<ImportType>('customers');
  const [step, setStep] = useState<Step>('idle');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ImportResult | null>(null);

  // ── File upload ─────────────────────────────────────────
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const { headers: hdrs, rows: rs } = parseCSV(text);
      if (hdrs.length === 0 || rs.length === 0) {
        toast(t('import.noRows'), 'error');
        return;
      }
      setFileName(file.name);
      setHeaders(hdrs);
      setRows(rs);
      const aliases = importType === 'customers' ? CUSTOMER_FIELD_ALIASES : INVENTORY_FIELD_ALIASES;
      setMapping(autoDetect(hdrs, aliases));
      setStep('mapping');
    } catch {
      toast(t('import.parseError'), 'error');
    }
    // Reset file input so re-selecting the same file fires onChange.
    e.target.value = '';
  };

  // ── Build mapped row (apply current mapping to a CSV row) ──
  const applyMapping = (row: Record<string, string>): Record<string, string> => {
    const mapped: Record<string, string> = {};
    for (const [csvHeader, field] of Object.entries(mapping)) {
      if (field !== SKIP) mapped[field] = row[csvHeader] ?? '';
    }
    return mapped;
  };

  // ── Required-field validation per row ───────────────────
  const rowHasError = (mapped: Record<string, string>): boolean => {
    if (importType === 'customers') {
      // name required (or firstName/lastName combined)
      const name = (mapped.name || '').trim();
      const fn = (mapped.firstName || '').trim();
      const ln = (mapped.lastName || '').trim();
      return !name && !fn && !ln;
    }
    // inventory: name required
    return !(mapped.name || '').trim();
  };

  // ── Preview rows + counts ───────────────────────────────
  const preview = useMemo(() => {
    return rows.slice(0, 5).map((r) => applyMapping(r));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, mapping]);

  const counts = useMemo(() => {
    let ok = 0;
    let err = 0;
    for (const row of rows) {
      const mapped = applyMapping(row);
      if (rowHasError(mapped)) err++;
      else ok++;
    }
    return { ok, err };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, mapping]);

  // ── Available fields list for the mapping dropdown ──────
  const availableFields = useMemo(() => {
    const aliases = importType === 'customers' ? CUSTOMER_FIELD_ALIASES : INVENTORY_FIELD_ALIASES;
    return Object.keys(aliases);
  }, [importType]);

  // ── Import (final step) ─────────────────────────────────
  const handleImport = () => {
    let imported = 0;
    let skipped = 0;
    let errors = 0;
    const newCustomers: Customer[] = [];
    const newItems: InventoryItem[] = [];

    // Build a Set of existing dedup keys for efficiency.
    const existingPhones = new Set(
      customers.map((c) => normalizePhone(c.phone || '')).filter(Boolean),
    );
    const existingSkus = new Set(
      inventory.flatMap((i) => [
        (i.sku || '').toLowerCase(),
        (i.barcode || '').toLowerCase(),
      ]).filter(Boolean),
    );

    const prefix = settings.customerNumberPrefix || 'GC';

    for (const row of rows) {
      const mapped = applyMapping(row);

      if (importType === 'customers') {
        // Resolve name parts. If only `name` is present, split on whitespace
        // so firstName/lastName get populated (preserves data on legacy CSVs).
        let firstName = (mapped.firstName || '').trim();
        let lastName = (mapped.lastName || '').trim();
        let fullName = (mapped.name || '').trim();
        if (fullName && !firstName && !lastName) {
          const parts = fullName.split(/\s+/);
          firstName = parts[0] || '';
          lastName = parts.slice(1).join(' ');
        }
        if (!fullName && (firstName || lastName)) {
          fullName = `${firstName} ${lastName}`.trim();
        }
        if (!fullName) {
          errors++;
          continue;
        }

        // Dedup by phone (normalized). Empty phone never dedups (multiple
        // walk-in customers without phone would all clash otherwise).
        const phone = normalizePhone(mapped.phone || '');
        if (phone && existingPhones.has(phone)) {
          skipped++;
          continue;
        }
        if (phone) existingPhones.add(phone);

        const ts = Date.now().toString().slice(-8);
        const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
        newCustomers.push({
          id: generateId(),
          storeId: currentStoreId || 'default',
          firstName,
          lastName,
          name: fullName,
          phone,
          phones: phone ? [phone] : [],
          email: (mapped.email || '').trim(),
          address: (mapped.address || '').trim(),
          loyaltyPoints: 0,
          storeCredit: 0,
          customerNumber: `${prefix}-${ts}-${rand}`,
          notes: (mapped.notes || '').trim(),
          communicationConsent: false,
          createdAt: new Date().toISOString(),
        } as Customer);
        imported++;
      } else {
        // Inventory
        const name = (mapped.name || '').trim();
        if (!name) {
          errors++;
          continue;
        }
        const sku = (mapped.sku || '').trim();
        if (sku && existingSkus.has(sku.toLowerCase())) {
          skipped++;
          continue;
        }
        if (sku) existingSkus.add(sku.toLowerCase());

        const priceCents = Math.round((parseFloat(mapped.price || '0') || 0) * 100);
        const costCents = Math.round((parseFloat(mapped.cost || '0') || 0) * 100);
        const qty = parseInt(mapped.quantity || '1', 10) || 0;

        newItems.push({
          id: generateId(),
          storeId: currentStoreId || 'default',
          sku,
          barcode: sku || undefined,
          name,
          category: ((mapped.category || 'accessory').toLowerCase()) as InventoryCategory,
          brand: (mapped.brand || '').trim(),
          supplier: (mapped.supplier || '').trim(),
          condition: 'New',
          cost: costCents,
          price: priceCents,
          qty,
          cbeEligible: false,
          screenFeeEligible: false,
          taxable: true,
          createdAt: new Date().toISOString(),
        } as InventoryItem);
        imported++;
      }
    }

    // Batched state update + persist. State first so the UI shows new
    // records immediately; persist after so localStorage / Firestore
    // catches up async.
    if (newCustomers.length > 0) {
      setCustomers([...customers, ...newCustomers]);
      for (const c of newCustomers) {
        persist.customer(c.id, c as unknown as Record<string, unknown>);
      }
    }
    if (newItems.length > 0) {
      setInventory([...inventory, ...newItems]);
      for (const it of newItems) {
        persist.inventory(it.id, it as unknown as Record<string, unknown>);
      }
    }

    setResult({ imported, skipped, errors });
    setStep('done');
  };

  const reset = () => {
    setStep('idle');
    setFileName('');
    setHeaders([]);
    setRows([]);
    setMapping({});
    setResult(null);
  };

  // ── Render ──────────────────────────────────────────────
  return (
    <div style={{
      border: '1px solid rgba(102,126,234,0.3)',
      borderRadius: '0.75rem',
      padding: '1.25rem',
      background: 'rgba(102,126,234,0.05)',
    }}>
      <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#a5b4fc', marginBottom: '0.25rem' }}>
        📥 {t('import.title')}
      </h3>
      <p style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: '1rem' }}>
        {t('import.subtitle')}
      </p>

      {step === 'idle' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          <div>
            <label style={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 600, display: 'block', marginBottom: '0.4rem' }}>
              {t('import.selectType')}
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {(['customers', 'inventory'] as ImportType[]).map((tp) => (
                <button
                  key={tp}
                  type="button"
                  onClick={() => setImportType(tp)}
                  style={{
                    flex: 1,
                    padding: '0.6rem 0.75rem',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    borderRadius: '0.5rem',
                    cursor: 'pointer',
                    background: importType === tp ? 'rgba(102,126,234,0.2)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${importType === tp ? 'rgba(102,126,234,0.5)' : 'rgba(255,255,255,0.12)'}`,
                    color: importType === tp ? '#c7d2fe' : '#94a3b8',
                  }}
                >
                  {tp === 'customers' ? t('import.typeCustomers') : t('import.typeInventory')}
                </button>
              ))}
            </div>
          </div>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              padding: '1.5rem 0.875rem',
              borderRadius: '0.5rem',
              border: '2px dashed rgba(102,126,234,0.4)',
              background: 'rgba(102,126,234,0.05)',
              cursor: 'pointer',
              fontSize: '0.85rem',
              color: '#a5b4fc',
              fontWeight: 600,
            }}
          >
            📁 {t('import.selectFile')}
            <input type="file" accept=".csv,text/csv" onChange={handleFile} style={{ display: 'none' }} />
          </label>
        </div>
      )}

      {step === 'mapping' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
            {t('import.fileSelected', fileName)} · {rows.length} rows
          </div>
          <div>
            <h4 style={{ fontSize: '0.88rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '0.25rem' }}>
              {t('import.mappingTitle')}
            </h4>
            <p style={{ fontSize: '0.72rem', color: '#64748b' }}>{t('import.mappingHint')}</p>
          </div>
          <div style={{ maxHeight: '240px', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.5rem' }}>
            <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                  <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: '#94a3b8', fontWeight: 700 }}>
                    {t('import.csvColumn')}
                  </th>
                  <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: '#94a3b8', fontWeight: 700 }}>
                    {t('import.cellhubField')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {headers.map((h) => (
                  <tr key={h} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '0.4rem 0.75rem', color: '#e2e8f0', fontFamily: 'monospace' }}>{h}</td>
                    <td style={{ padding: '0.4rem 0.75rem' }}>
                      <select
                        className="select"
                        value={mapping[h] || SKIP}
                        onChange={(e) => setMapping((m) => ({ ...m, [h]: e.target.value }))}
                        style={{ width: '100%' }}
                      >
                        <option value={SKIP}>{t('import.skip')}</option>
                        {availableFields.map((f) => (
                          <option key={f} value={f}>{f}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={reset} className="btn btn-secondary" style={{ flex: 1 }}>
              {t('import.cancel')}
            </button>
            <button onClick={() => setStep('preview')} className="btn btn-primary" style={{ flex: 2 }}>
              {t('import.next')}
            </button>
          </div>
        </div>
      )}

      {step === 'preview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <h4 style={{ fontSize: '0.88rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '0.25rem' }}>
              {t('import.previewTitle')}
            </h4>
            <p style={{ fontSize: '0.72rem', color: '#64748b' }}>{t('import.previewHint')}</p>
            <p style={{ fontSize: '0.78rem', color: '#a5b4fc', marginTop: '0.35rem' }}>
              {t('import.readyCount', counts.ok, counts.err)}
            </p>
          </div>
          <div style={{ maxHeight: '260px', overflowX: 'auto', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.5rem' }}>
            <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                  {availableFields.map((f) => (
                    <th key={f} style={{ textAlign: 'left', padding: '0.4rem 0.6rem', color: '#94a3b8', fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {f}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((mapped, idx) => {
                  const err = rowHasError(mapped);
                  return (
                    <tr key={idx} style={{
                      borderTop: '1px solid rgba(255,255,255,0.05)',
                      background: err ? 'rgba(239,68,68,0.08)' : 'transparent',
                    }}>
                      {availableFields.map((f) => (
                        <td key={f} style={{ padding: '0.35rem 0.6rem', color: err ? '#fca5a5' : '#e2e8f0', whiteSpace: 'nowrap' }}>
                          {mapped[f] || ''}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={() => setStep('mapping')} className="btn btn-secondary" style={{ flex: 1 }}>
              {t('import.back')}
            </button>
            <button
              onClick={handleImport}
              className="btn btn-primary"
              style={{ flex: 2 }}
              disabled={counts.ok === 0}
            >
              {t('import.doImport', counts.ok)}
            </button>
          </div>
        </div>
      )}

      {step === 'done' && result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#22c55e' }}>
            ✓ {t('import.resultTitle')}
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.85rem' }}>
            <div style={{ color: '#22c55e' }}>✅ {t('import.imported', result.imported)}</div>
            {result.skipped > 0 && (
              <div style={{ color: '#fbbf24' }}>⏭️ {t('import.skippedCount', result.skipped)}</div>
            )}
            {result.errors > 0 && (
              <div style={{ color: '#f87171' }}>❌ {t('import.errorsCount', result.errors)}</div>
            )}
          </div>
          <button onClick={reset} className="btn btn-primary">
            {t('import.resetButton')}
          </button>
        </div>
      )}
    </div>
  );
}
