// ============================================================
// CellHub Pro — RMA Return Label Modal
// Create 4×6 return shipping labels with saved companies
// ============================================================

import { useState } from 'react';
import { useApp } from '@/store/AppProvider';
import { useTranslation } from '@/i18n';
import { Modal, ConfirmDialog } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { openPrintWindow } from '@/hooks/usePrint';
import { loadLocal, saveLocal } from '@/services/storage';
import { escHtml } from '@/utils/escHtml';

interface RMACompany {
  id: number;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

interface RMAEntry {
  id: number;
  rmaNumber: string;
  qrCode: string;
  notes: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function RMALabelModal({ open, onClose }: Props) {
  const { state: { settings } } = useApp();
  const { t } = useTranslation();
  const { toast } = useToast();

  // Recipient form
  const [recipientName, setRecipientName] = useState('');
  const [recipientAddress, setRecipientAddress] = useState('');
  const [recipientCity, setRecipientCity] = useState('');
  const [recipientState, setRecipientState] = useState('');
  const [recipientZip, setRecipientZip] = useState('');

  // RMA entries (multiple)
  const [entries, setEntries] = useState<RMAEntry[]>([
    { id: Date.now(), rmaNumber: '', qrCode: '', notes: '' },
  ]);

  // Saved companies
  const [companies, setCompanies] = useState<RMACompany[]>(() => loadLocal('rmaCompanies', []));
  const [showManageTab, setShowManageTab] = useState(false);
  const [newCompany, setNewCompany] = useState({ name: '', address: '', city: '', state: '', zip: '' });
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  const saveCompanies = (list: RMACompany[]) => {
    setCompanies(list);
    saveLocal('rmaCompanies', list);
  };

  const selectCompany = (co: RMACompany) => {
    setRecipientName(co.name);
    setRecipientAddress(co.address);
    setRecipientCity(co.city);
    setRecipientState(co.state);
    setRecipientZip(co.zip);
  };

  const addEntry = () => setEntries((prev) => [...prev, { id: Date.now(), rmaNumber: '', qrCode: '', notes: '' }]);
  const removeEntry = (id: number) => setEntries((prev) => prev.filter((e) => e.id !== id));
  const updateEntry = (id: number, field: keyof RMAEntry, value: string) =>
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, [field]: value } : e)));

  const handleQRUpload = (entryId: number, file: File) => {
    const reader = new FileReader();
    reader.onload = (ev) => updateEntry(entryId, 'qrCode', ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleQRPaste = async (entryId: number) => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imgTypes = item.types.filter((t) => t.startsWith('image/'));
        if (imgTypes.length > 0) {
          const blob = await item.getType(imgTypes[0]);
          const reader = new FileReader();
          reader.onload = (ev) => updateEntry(entryId, 'qrCode', ev.target?.result as string);
          reader.readAsDataURL(blob);
          return;
        }
      }
      toast(t('rmaLabel.noClipboardImage'), 'warning');
    } catch {
      toast(t('rmaLabel.errorPasting'), 'error');
    }
  };

  const validEntries = entries.filter((e) => e.rmaNumber.trim());

  const handleGenerate = () => {
    if (!recipientName || !recipientAddress || !recipientCity || !recipientState || !recipientZip) {
      toast(t('rmaLabel.fillRecipient'), 'warning');
      return;
    }
    if (validEntries.length === 0) {
      toast(t('rmaLabel.atLeastOneRMA'), 'warning');
      return;
    }

    // Generate 4×6 label HTML for each entry.
    // escHtml on settings + user fields prevents injected markup from
    // breaking label structure or executing in the print window.
    const senderAddr = `${escHtml(settings.storeName || 'GO CELLULAR')}\n${escHtml(settings.storeAddress || '516 N MILPAS ST')}\nSANTA BARBARA CA 93103`;

    const labelsHtml = validEntries.map((entry) => `
      <div class="label" style="width:4in;height:6in;border:2px solid #000;padding:0.3in;box-sizing:border-box;page-break-after:always;display:flex;flex-direction:column;justify-content:space-between;font-family:Arial,sans-serif;">
        <div>
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#666;margin-bottom:0.1in;">FROM:</div>
          <div style="font-size:13px;font-weight:600;white-space:pre-line;">${senderAddr}</div>
        </div>
        <div style="border-top:2px solid #000;padding-top:0.2in;margin-top:0.15in;">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#666;margin-bottom:0.1in;">TO:</div>
          <div style="font-size:16px;font-weight:800;line-height:1.4;">
            ${escHtml(recipientName.toUpperCase())}<br/>
            ${escHtml(recipientAddress.toUpperCase())}<br/>
            ${escHtml(recipientCity.toUpperCase())}, ${escHtml(recipientState.toUpperCase())} ${escHtml(recipientZip)}
          </div>
        </div>
        <div style="border-top:2px dashed #000;padding-top:0.15in;margin-top:0.15in;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-size:10px;font-weight:700;color:#666;text-transform:uppercase;">RMA #:</div>
            <div style="font-size:20px;font-weight:900;font-family:monospace;">${escHtml(entry.rmaNumber)}</div>
            ${entry.notes ? `<div style="font-size:11px;color:#666;margin-top:0.05in;">${escHtml(entry.notes)}</div>` : ''}
          </div>
          ${entry.qrCode ? `<img src="${escHtml(entry.qrCode)}" style="width:1.2in;height:1.2in;object-fit:contain;border:1px solid #ccc;" />` : ''}
        </div>
      </div>
    `).join('');

    const printHtml = `<html><head><title>RMA Labels</title><style>
      @page { size: 4in 6in; margin: 0; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { width: 4in; margin: 0; padding: 0; }
      @media print { .label { page-break-inside: avoid; } }
    </style></head><body>${labelsHtml}</body></html>`;

    // r-print-audit: open in system Chrome for full print preview
    openPrintWindow(printHtml);
  };

  return (
    <Modal open={open} onClose={onClose} title={`📦 ${t('rmaLabel.modalTitle')}`} size="max-w-2xl">
      {/* SENDER (Fixed) */}
      <div style={{
        background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)',
        borderRadius: '0.75rem', padding: '0.75rem 1rem', marginBottom: '1rem',
      }}>
        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#6ee7b7', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {t('rmaLabel.senderFixed')}
        </div>
        <div style={{ fontWeight: 700 }}>
          {settings.storeName || 'GO CELLULAR'} · {settings.storeAddress || '516 N MILPAS ST, SANTA BARBARA CA 93103'}
        </div>
      </div>

      {/* COMPANY SELECTOR */}
      <div style={{
        background: 'rgba(59,130,246,0.07)', border: '1px solid rgba(59,130,246,0.25)',
        borderRadius: '0.75rem', padding: '1rem', marginBottom: '1rem',
      }}>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.85rem' }}>
          <button onClick={() => setShowManageTab(false)} style={{
            flex: 1, padding: '0.45rem 0', borderRadius: '0.4rem', fontWeight: 700,
            fontSize: '0.82rem', cursor: 'pointer', border: 'none',
            background: !showManageTab ? 'rgba(59,130,246,0.3)' : 'var(--bg-input)',
            color: !showManageTab ? '#93c5fd' : 'var(--text-secondary)',
          }}>
            🏢 {t('rmaLabel.selectCompany')}
          </button>
          <button onClick={() => setShowManageTab(true)} style={{
            flex: 1, padding: '0.45rem 0', borderRadius: '0.4rem', fontWeight: 700,
            fontSize: '0.82rem', cursor: 'pointer', border: 'none',
            background: showManageTab ? 'rgba(16,185,129,0.3)' : 'var(--bg-input)',
            color: showManageTab ? '#6ee7b7' : 'var(--text-secondary)',
          }}>
            ➕ {t('rmaLabel.saveNewCompany')}
          </button>
        </div>

        {/* Tab: Select saved */}
        {!showManageTab && (
          <div>
            {companies.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '0.75rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                {t('rmaLabel.noSavedCompanies')}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '0.75rem' }}>
                {companies.map((co) => (
                  <div key={co.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <button
                      onClick={() => selectCompany(co)}
                      style={{
                        flex: 1, textAlign: 'left', padding: '0.5rem 0.75rem',
                        borderRadius: '0.4rem', cursor: 'pointer',
                        border: recipientName === co.name ? '2px solid #3b82f6' : '1px solid var(--border-default)',
                        background: recipientName === co.name ? 'rgba(59,130,246,0.2)' : 'var(--bg-input)',
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: '0.88rem', color: recipientName === co.name ? '#93c5fd' : 'var(--text-primary)' }}>{co.name}</div>
                      <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>{co.address}, {co.city} {co.state} {co.zip}</div>
                    </button>
                    <button className="btn btn-danger btn-sm" style={{ padding: '0.25rem 0.4rem', flexShrink: 0 }}
                      onClick={() => setDeleteConfirm(co.id)}>
                      🗑️
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab: Save new */}
        {showManageTab && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <input className="input" placeholder={t('rmaLabel.companyNamePlaceholder')}
              value={newCompany.name} onChange={(e) => setNewCompany({ ...newCompany, name: e.target.value })} />
            <input className="input" placeholder={t('rmaLabel.streetAddressPlaceholder')}
              value={newCompany.address} onChange={(e) => setNewCompany({ ...newCompany, address: e.target.value })} />
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '0.5rem' }}>
              <input className="input" placeholder={t('rmaLabel.cityPlaceholder')}
                value={newCompany.city} onChange={(e) => setNewCompany({ ...newCompany, city: e.target.value })} />
              <input className="input" placeholder="State" maxLength={2}
                value={newCompany.state} onChange={(e) => setNewCompany({ ...newCompany, state: e.target.value.toUpperCase() })}
                style={{ textTransform: 'uppercase' }} />
              <input className="input" placeholder="ZIP"
                value={newCompany.zip} onChange={(e) => setNewCompany({ ...newCompany, zip: e.target.value })} />
            </div>
            <button className="btn btn-success" style={{ width: '100%', marginTop: '0.25rem' }} onClick={() => {
              if (!newCompany.name.trim() || !newCompany.address.trim() || !newCompany.city.trim()) {
                toast(t('rmaLabel.nameAddressCityRequired'), 'warning');
                return;
              }
              const co = { ...newCompany, id: Date.now() };
              saveCompanies([...companies, co]);
              selectCompany(co as RMACompany);
              setNewCompany({ name: '', address: '', city: '', state: '', zip: '' });
              setShowManageTab(false);
            }}>
              ✅ {t('rmaLabel.saveCompany')}
            </button>
          </div>
        )}

        {/* Editable recipient fields */}
        <div style={{ marginTop: '0.75rem', borderTop: '1px solid var(--border-default)', paddingTop: '0.75rem' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {t('rmaLabel.recipientHeader')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <input className="input" placeholder={t('rmaLabel.namePlaceholder')}
              value={recipientName} onChange={(e) => setRecipientName(e.target.value)} />
            <input className="input" placeholder={t('rmaLabel.addressPlaceholder')}
              value={recipientAddress} onChange={(e) => setRecipientAddress(e.target.value)} />
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '0.5rem' }}>
              <input className="input" placeholder={t('rmaLabel.cityPlaceholder')}
                value={recipientCity} onChange={(e) => setRecipientCity(e.target.value)} />
              <input className="input" placeholder="State" maxLength={2}
                value={recipientState} onChange={(e) => setRecipientState(e.target.value.toUpperCase())}
                style={{ textTransform: 'uppercase' }} />
              <input className="input" placeholder="ZIP" maxLength={10}
                value={recipientZip} onChange={(e) => setRecipientZip(e.target.value.replace(/[^0-9-]/g, ''))} />
            </div>
          </div>
        </div>
      </div>

      {/* RMA ENTRIES */}
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
          <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>
            🔖 {t('rmaLabel.itemsCount', entries.length)}
          </div>
          <button className="btn btn-success btn-sm" onClick={addEntry}>
            ➕ {t('rmaLabel.addRMA')}
          </button>
        </div>

        {entries.map((entry, idx) => (
          <div key={entry.id} style={{
            background: 'rgba(139,92,246,0.07)', border: '1px solid rgba(139,92,246,0.25)',
            borderRadius: '0.75rem', padding: '0.85rem', marginBottom: '0.6rem',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#a78bfa' }}>
                #{idx + 1} RMA
              </div>
              {entries.length > 1 && (
                <button className="btn btn-danger btn-sm" style={{ padding: '0.1rem 0.35rem' }}
                  onClick={() => removeEntry(entry.id)}>🗑️</button>
              )}
            </div>
            <input className="input" style={{ fontFamily: 'monospace', fontWeight: 700, marginBottom: '0.4rem' }}
              placeholder={t('rmaLabel.rmaNumberPlaceholder')}
              value={entry.rmaNumber} onChange={(e) => updateEntry(entry.id, 'rmaNumber', e.target.value)} />
            <input className="input" style={{ marginBottom: '0.4rem' }}
              placeholder={t('rmaLabel.rmaNotesPlaceholder')}
              value={entry.notes} onChange={(e) => updateEntry(entry.id, 'notes', e.target.value)} />

            {/* QR */}
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {entry.qrCode ? (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1,
                  background: 'rgba(139,92,246,0.1)', borderRadius: '0.4rem', padding: '0.3rem 0.5rem',
                }}>
                  <img src={entry.qrCode} alt="QR" style={{ width: '36px', height: '36px', objectFit: 'contain', background: 'white', borderRadius: '2px' }} />
                  <span style={{ fontSize: '0.75rem', color: '#a78bfa', flex: 1 }}>✓ QR {t('rmaLabel.qrLoaded')}</span>
                  <button className="btn btn-danger btn-sm" style={{ padding: '0.1rem 0.3rem' }}
                    onClick={() => updateEntry(entry.id, 'qrCode', '')}>✕</button>
                </div>
              ) : (
                <>
                  <label style={{ flex: 1 }}>
                    <input type="file" accept="image/*" style={{ display: 'none' }}
                      onChange={(e) => { if (e.target.files?.[0]) handleQRUpload(entry.id, e.target.files[0]); }} />
                    <div className="btn btn-secondary btn-sm" style={{ width: '100%', cursor: 'pointer', fontSize: '0.78rem' }}>
                      📤 {t('rmaLabel.qrImage')}
                    </div>
                  </label>
                  <button className="btn btn-secondary btn-sm" style={{ flex: 1, fontSize: '0.78rem' }}
                    onClick={() => handleQRPaste(entry.id)}>
                    📋 {t('rmaLabel.pasteQR')}
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Generate button */}
      <button className="btn btn-primary" style={{ width: '100%', padding: '0.9rem', fontSize: '1.05rem' }}
        onClick={handleGenerate}>
        📄 {t('rmaLabel.generateButton', validEntries.length)}
      </button>

      {/* Delete confirm */}
      <ConfirmDialog
        open={deleteConfirm !== null}
        title={t('rmaLabel.deleteCompanyTitle')}
        message={t('rmaLabel.deleteCompanyMessage')}
        variant="danger"
        onConfirm={() => {
          if (deleteConfirm !== null) saveCompanies(companies.filter((c) => c.id !== deleteConfirm));
          setDeleteConfirm(null);
        }}
        onCancel={() => setDeleteConfirm(null)}
      />
    </Modal>
  );
}
