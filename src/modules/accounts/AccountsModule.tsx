// ============================================================
// CellHub Pro — Accounts Module (full rewrite matching original)
// Tracks Google, iCloud, Samsung, Microsoft accounts created for customers
// Features:
//   - Stats: total, google count, icloud count, revenue
//   - Table view: date, customer, type badge, email, password toggle, charged, actions
//   - Customer autocomplete from customers list
//   - Print account receipt (formatted)
//   - Add to cart (for charging)
//   - Full modal: customer info, account info, service info
//   - Security questions, recovery email/phone, device used
// ============================================================

import { useState, useMemo, useCallback } from 'react';
import { useApp } from '@/store/AppProvider';
import { useToast } from '@/components/ui/Toast';
import { Modal, ConfirmDialog, SearchInput } from '@/components/ui';
import { getLabels } from '@/config/i18n';
import { generateId, formatDate } from '@/utils/dates';
import { matchesSearch } from '@/utils/fuzzyMatch';
import { formatCurrency } from '@/utils/currency';
import { loadLocal, saveLocal } from '@/services/storage';
import { persist, remove } from '@/services/persist';

interface Account {
  id: string;
  firstName?: string;
  lastName?: string;
  customerName: string;
  customerPhone: string;
  accountType: string;
  email: string;
  password: string;
  recoveryEmail?: string;
  recoveryPhone?: string;
  securityQuestions?: string;
  dateCreated?: string;
  deviceUsed?: string;
  chargedAmount?: string;
  notes?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt?: string;
}

const ACCOUNT_TYPES = ['Google', 'iCloud / Apple ID', 'Samsung', 'Microsoft', 'Other'];

const typeIcon = (type: string) =>
  type === 'Google' ? '🔵' : type.includes('iCloud') ? '🍎' : type === 'Samsung' ? '📱' : '🔑';

const typeBadgeStyle = (type: string): React.CSSProperties => ({
  padding: '0.2rem 0.5rem', borderRadius: '0.25rem', fontSize: '0.75rem', fontWeight: 700,
  background: type === 'Google' ? 'rgba(66,133,244,0.15)' : type.includes('iCloud') ? 'rgba(163,170,174,0.15)' : type === 'Samsung' ? 'rgba(21,101,192,0.15)' : 'rgba(139,92,246,0.15)',
  color: type === 'Google' ? '#4285f4' : type.includes('iCloud') ? '#a3aaae' : type === 'Samsung' ? '#60a5fa' : '#8b5cf6',
});

const defaultForm = (): Partial<Account> => ({
  firstName: '', lastName: '', customerName: '', customerPhone: '', accountType: 'Google',
  email: '', password: '', recoveryEmail: '', recoveryPhone: '',
  securityQuestions: '', dateCreated: new Date().toISOString().split('T')[0],
  deviceUsed: '', chargedAmount: '', notes: '', createdBy: '',
});

export default function AccountsModule() {
  const { state: { customers, settings, currentEmployee, cart, lang }, setCart } = useApp();
  const { toast } = useToast();
  const L = getLabels(lang);
  const es = lang === 'es';

  const [accounts, setAccounts] = useState<Account[]>(() => loadLocal('customerAccounts', []));
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('All');
  const [showModal, setShowModal] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [editAccount, setEditAccount] = useState<Account | null>(null);
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState<Partial<Account>>(defaultForm());
  const [custSuggestions, setCustSuggestions] = useState<any[]>([]);

  const saveAccounts = useCallback((updated: Account[], changedId?: string, deleted = false) => {
    setAccounts(updated);
    saveLocal('customerAccounts', updated);
    // Sync to Firebase so both store computers stay in sync
    if (changedId) {
      if (deleted) {
        remove.account(changedId);
      } else {
        const record = updated.find((a) => a.id === changedId);
        if (record) persist.account(changedId, record as unknown as Record<string, unknown>);
      }
    }
  }, []);

  // ── Stats ─────────────────────────────────────────────────
  const googleCount = useMemo(() => accounts.filter((a) => a.accountType === 'Google').length, [accounts]);
  const icloudCount = useMemo(() => accounts.filter((a) => (a.accountType || '').includes('iCloud')).length, [accounts]);
  const totalRevenue = useMemo(() => accounts.reduce((s, a) => s + (parseFloat(a.chargedAmount || '0') || 0), 0), [accounts]);

  // ── Filtered list ─────────────────────────────────────────
  const filtered = useMemo(() =>
    accounts
      .filter((a) => filterType === 'All' || a.accountType === filterType)
      .filter((a) => !search.trim() || matchesSearch(search, a.customerName, a.customerPhone, a.email, a.deviceUsed))
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
    [accounts, search, filterType]
  );

  // ── Modal helpers ─────────────────────────────────────────
  const openNew = () => {
    setEditAccount(null);
    setForm({ ...defaultForm(), createdBy: currentEmployee?.name || '' });
    setShowModal(true);
  };

  const openEdit = (a: Account) => {
    setEditAccount(a);
    const parts = (a.customerName || '').trim().split(' ');
    setForm({ ...a, firstName: (a as any).firstName || parts[0] || '', lastName: (a as any).lastName || parts.slice(1).join(' ') || '' });
    setShowModal(true);
  };

  const upd = (field: string, val: any) => setForm((f) => ({ ...f, [field]: val }));

  // Customer autocomplete — firstName/lastName split
  const handleCustomerNameChange = (val: string) => {
    // Update firstName as user types (full name search still works)
    upd('firstName', val);
    upd('customerName', val); // keep for search compatibility
    if (val.length >= 2 && Array.isArray(customers)) {
      const matches = customers.filter((c) =>
        (c.name || '').toLowerCase().includes(val.toLowerCase()) ||
        (`${(c as any).firstName || ''} ${(c as any).lastName || ''}`).toLowerCase().includes(val.toLowerCase())
      ).slice(0, 5);
      setCustSuggestions(matches);
    } else {
      setCustSuggestions([]);
    }
  };

  const selectCustomer = (c: any) => {
    const name = c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim();
    const parts = name.split(' ');
    setForm((f) => ({
      ...f,
      firstName: parts[0] || '',
      lastName: parts.slice(1).join(' ') || '',
      customerName: name,
      customerPhone: c.phone || '',
    }));
    setCustSuggestions([]);
  };

  // ── Save ──────────────────────────────────────────────────
  const handleSave = useCallback(() => {
    const firstName = ((form as any).firstName || '').trim();
    const lastName  = ((form as any).lastName  || '').trim();
    const customerName = `${firstName} ${lastName}`.trim();
    if (!customerName) { toast(es ? 'Nombre del cliente requerido' : 'Customer name required', 'error'); return; }
    if (!form.email?.trim()) { toast(es ? 'Email/cuenta requerido' : 'Email/account required', 'error'); return; }

    const formWithName = { ...form, firstName, lastName, customerName };
    if (editAccount) {
      saveAccounts(
        accounts.map((a) => a.id === editAccount.id ? { ...a, ...formWithName, updatedAt: new Date().toISOString() } as Account : a),
        editAccount.id,
      );
      toast(L.saved || 'Updated!', 'success');
    } else {
      const newAcc = { id: generateId(), ...formWithName, createdAt: new Date().toISOString() } as Account;
      saveAccounts([newAcc, ...accounts], newAcc.id);
      toast(es ? 'Cuenta registrada' : 'Account registered!', 'success');
    }
    setShowModal(false);
    setEditAccount(null);
  }, [form, editAccount, accounts, es, L, saveAccounts, toast]);

  const handleDelete = (id: string) => {
    setPendingDeleteId(id);
  };

  // ── Add to cart ───────────────────────────────────────────
  const addToCart = (acc: Account) => {
    const amount = parseFloat(acc.chargedAmount || '0');
    if (!amount || amount <= 0) {
      toast(es ? 'Esta cuenta no tiene monto cobrado. Edítala primero.' : 'No charge amount set. Edit the account first.', 'error');
      return;
    }
    const item = {
      id: generateId(),
      name: `${acc.accountType} ${es ? 'Creación de Cuenta' : 'Account Setup'} — ${acc.customerName}`,
      category: 'service',
      price: Math.round(amount * 100),
      qty: 1, taxable: false, cbeEligible: false,
      notes: acc.email,
    };
    setCart([...cart, item]);
    toast(es ? `$${amount.toFixed(2)} agregado al carrito` : `$${amount.toFixed(2)} added to cart`, 'success');
  };

  // ── Print receipt ─────────────────────────────────────────
  const printAccount = (acc: Account) => {
    const storeName = settings.storeName || '';
    const storePhone = settings.storePhone || '';
    const storeAddress = settings.storeAddress || '';
    const date = new Date(acc.dateCreated || acc.createdAt).toLocaleDateString(es ? 'es-US' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const icon = typeIcon(acc.accountType);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Account Receipt</title><style>
body{font-family:Arial,sans-serif;max-width:400px;margin:0 auto;padding:20px;color:#111}
.header{text-align:center;border-bottom:2px solid #333;padding-bottom:12px;margin-bottom:16px}
.header h1{font-size:1.3rem;margin:0 0 4px}.header p{margin:2px 0;font-size:.85rem;color:#555}
.section{margin-bottom:14px}.section h3{font-size:.8rem;text-transform:uppercase;color:#666;border-bottom:1px solid #ddd;padding-bottom:4px;margin-bottom:8px}
.row{display:flex;justify-content:space-between;font-size:.9rem;margin-bottom:4px}
.label{color:#555}.value{font-weight:600;max-width:60%;text-align:right;word-break:break-all}
.password-box{background:#f5f5f5;border:1px dashed #999;padding:8px 12px;border-radius:4px;font-family:monospace;font-size:1rem;font-weight:700;text-align:center;margin-top:4px;letter-spacing:2px}
.charged{text-align:center;font-size:1.1rem;font-weight:700;color:#166534;background:#dcfce7;padding:8px;border-radius:6px;margin:12px 0}
.footer{text-align:center;margin-top:20px;padding-top:12px;border-top:1px solid #ddd;font-size:.75rem;color:#777}
@media print{body{padding:0}}
</style></head><body>
<div class="header">
  <h1>${storeName}</h1>
  ${storeAddress ? `<p>${storeAddress}</p>` : ''}
  ${storePhone ? `<p>${storePhone}</p>` : ''}
  <p style="margin-top:8px;font-weight:700;font-size:1rem;">${es ? 'COMPROBANTE DE CUENTA' : 'ACCOUNT RECEIPT'}</p>
  <p>${date}</p>
</div>
<div class="section">
  <h3>${es ? 'Información del Cliente' : 'Customer Info'}</h3>
  <div class="row"><span class="label">${es ? 'Nombre' : 'Name'}:</span><span class="value">${acc.customerName || '-'}</span></div>
  ${acc.customerPhone ? `<div class="row"><span class="label">${es ? 'Teléfono' : 'Phone'}:</span><span class="value">${acc.customerPhone}</span></div>` : ''}
  ${acc.deviceUsed ? `<div class="row"><span class="label">${es ? 'Equipo' : 'Device'}:</span><span class="value">${acc.deviceUsed}</span></div>` : ''}
</div>
<div class="section">
  <h3>${icon} ${acc.accountType} ${es ? 'Cuenta' : 'Account'}</h3>
  <div class="row"><span class="label">Email:</span><span class="value">${acc.email || '-'}</span></div>
  ${acc.recoveryEmail ? `<div class="row"><span class="label">${es ? 'Email Recuperación' : 'Recovery Email'}:</span><span class="value">${acc.recoveryEmail}</span></div>` : ''}
  ${acc.recoveryPhone ? `<div class="row"><span class="label">${es ? 'Tel. Recuperación' : 'Recovery Phone'}:</span><span class="value">${acc.recoveryPhone}</span></div>` : ''}
  <div style="margin-top:8px;font-size:.8rem;color:#555;">${es ? 'Contraseña' : 'Password'}:</div>
  <div class="password-box">${acc.password || '—'}</div>
  ${acc.securityQuestions ? `<div style="margin-top:8px;font-size:.8rem;color:#555;">${es ? 'Preguntas de Seguridad' : 'Security Questions'}:</div><div style="font-size:.85rem;margin-top:4px;white-space:pre-wrap;">${acc.securityQuestions}</div>` : ''}
</div>
${acc.chargedAmount ? `<div class="charged">${es ? 'Total Cobrado' : 'Amount Charged'}: $${parseFloat(acc.chargedAmount).toFixed(2)}</div>` : ''}
${acc.notes ? `<div class="section"><h3>${es ? 'Notas' : 'Notes'}</h3><div style="font-size:.85rem;">${acc.notes}</div></div>` : ''}
<div class="footer">
  <p>${es ? '¡Guarde este comprobante en lugar seguro!' : 'Keep this receipt in a safe place!'}</p>
  <p>${es ? 'No compartir con nadie.' : 'Do not share with anyone.'}</p>
</div>
<script>window.onload=function(){setTimeout(function(){window.print();},400)}<\/script>
</body></html>`;
    const win = window.open('', '_blank');
    if (win) { win.document.write(html); win.document.close(); }
  };

  // ── Render ─────────────────────────────────────────────────
  return (
    <>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h2 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '0.25rem', color: '#fff' }}>
            🔑 {es ? 'Registro de Cuentas' : 'Account Registry'}
          </h2>
          <p style={{ color: '#64748b', fontSize: '0.875rem' }}>
            {es ? 'Cuentas Google, iCloud y más creadas para clientes' : 'Google, iCloud & more accounts created for customers'}
          </p>
        </div>
        <button onClick={openNew} className="btn btn-primary">
          + {es ? 'Nueva Cuenta' : 'New Account'}
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '0.75rem', marginBottom: '1.25rem' }}>
        {[
          { label: es ? 'TOTAL CUENTAS' : 'TOTAL ACCOUNTS', value: accounts.length, color: '#e2e8f0' },
          { label: 'GOOGLE', value: googleCount, color: '#4285f4' },
          { label: 'iCLOUD', value: icloudCount, color: '#a3aaae' },
          { label: es ? 'COBRADO' : 'REVENUE', value: `$${totalRevenue.toFixed(2)}`, color: '#22c55e' },
        ].map((s) => (
          <div key={s.label} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.75rem', padding: '0.875rem 1rem' }}>
            <div style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 700, marginBottom: '0.25rem' }}>{s.label}</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Search + Filter */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: '200px' }}>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={es ? 'Buscar por nombre, email, teléfono...' : 'Search by name, email, phone...'}
          />
        </div>
        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
          {['All', ...ACCOUNT_TYPES].map((t) => (
            <button key={t} onClick={() => setFilterType(t)}
              className={`btn btn-sm ${filterType === t ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '0.78rem' }}>
              {t === 'All' ? (es ? 'Todos' : 'All') : `${typeIcon(t)} ${t}`}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#475569' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔑</div>
          <p>{es ? 'No hay cuentas registradas' : 'No accounts registered yet'}</p>
        </div>
      ) : (
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.75rem', overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                {[es?'Fecha':'Date', es?'Cliente':'Customer', es?'Tipo':'Type', 'Email', es?'Contraseña':'Password', es?'Cobrado':'Charged', es?'Acciones':'Actions'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '0.625rem 0.875rem', color: '#64748b', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((acc) => (
                <tr key={acc.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ padding: '0.625rem 0.875rem', color: '#64748b', fontSize: '0.75rem' }}>
                    {new Date(acc.dateCreated || acc.createdAt).toLocaleDateString()}
                  </td>
                  <td style={{ padding: '0.625rem 0.875rem' }}>
                    <div style={{ fontWeight: 700, color: '#e2e8f0' }}>{acc.customerName}</div>
                    {acc.customerPhone && <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{acc.customerPhone}</div>}
                  </td>
                  <td style={{ padding: '0.625rem 0.875rem' }}>
                    <span style={typeBadgeStyle(acc.accountType)}>
                      {typeIcon(acc.accountType)} {acc.accountType}
                    </span>
                  </td>
                  <td style={{ padding: '0.625rem 0.875rem', fontFamily: 'monospace', fontSize: '0.8rem', color: '#a5b4fc' }}>{acc.email}</td>
                  <td style={{ padding: '0.625rem 0.875rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontFamily: 'monospace', fontSize: '0.82rem', color: '#e2e8f0' }}>
                        {showPasswords[acc.id] ? acc.password : '••••••••'}
                      </span>
                      <button onClick={() => setShowPasswords((p) => ({ ...p, [acc.id]: !p[acc.id] }))}
                        className="btn btn-ghost btn-sm" style={{ padding: '0.15rem 0.35rem', fontSize: '0.7rem' }}>
                        {showPasswords[acc.id] ? '🙈' : '👁️'}
                      </button>
                    </div>
                  </td>
                  <td style={{ padding: '0.625rem 0.875rem', fontWeight: 700, color: '#22c55e' }}>
                    {acc.chargedAmount ? `$${parseFloat(acc.chargedAmount).toFixed(2)}` : '—'}
                  </td>
                  <td style={{ padding: '0.625rem 0.875rem' }}>
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      <button onClick={() => addToCart(acc)} className="btn btn-sm" title={es ? 'Cobrar' : 'Add to cart'}
                        style={{ background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', color: '#22c55e', padding: '0.25rem 0.4rem' }}>
                        🛒
                      </button>
                      <button onClick={() => printAccount(acc)} className="btn btn-secondary btn-sm" title={es ? 'Imprimir' : 'Print'}
                        style={{ padding: '0.25rem 0.4rem' }}>
                        🖨️
                      </button>
                      <button onClick={() => openEdit(acc)} className="btn btn-secondary btn-sm" style={{ padding: '0.25rem 0.4rem' }}>
                        ✏️
                      </button>
                      <button onClick={() => handleDelete(acc.id)} className="btn btn-sm" style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', padding: '0.25rem 0.4rem' }}>
                        🗑️
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      <Modal open={showModal} onClose={() => { setShowModal(false); setEditAccount(null); }}
        title={`🔑 ${editAccount ? (es ? 'Editar Cuenta' : 'Edit Account') : (es ? 'Registrar Nueva Cuenta' : 'Register New Account')}`}
        size="max-w-2xl">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem', maxHeight: '65vh', overflowY: 'auto', paddingRight: '2px' }}>

          {/* Customer Info */}
          <div style={{ background: 'rgba(102,126,234,0.08)', border: '1px solid rgba(102,126,234,0.2)', borderRadius: '0.75rem', padding: '1rem' }}>
            <h4 style={{ fontSize: '0.82rem', fontWeight: 700, color: '#a5b4fc', marginBottom: '0.75rem' }}>
              👤 {es ? 'Información del Cliente' : 'Customer Info'}
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div style={{ position: 'relative' }}>
                <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>
                  {es ? 'Nombre *' : 'First Name *'}
                </label>
                <input className="input" value={(form as any).firstName || ''}
                  onChange={(e) => handleCustomerNameChange(e.target.value)}
                  placeholder={es ? 'Buscar o escribir nombre...' : 'Search or type name...'} />
                {custSuggestions.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '0.5rem', marginTop: '0.25rem', overflow: 'hidden' }}>
                    {custSuggestions.map((c) => (
                      <button key={c.id} type="button" onClick={() => selectCustomer(c)}
                        style={{ width: '100%', textAlign: 'left', padding: '0.5rem 0.75rem', background: 'transparent', border: 'none', color: '#e2e8f0', cursor: 'pointer', fontSize: '0.82rem', display: 'flex', justifyContent: 'space-between' }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(102,126,234,0.15)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                        <strong>{c.name || `${c.firstName||''} ${c.lastName||''}`.trim()}</strong>
                        <span style={{ color: '#64748b' }}>{c.phone}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>
                  {es ? 'Apellido' : 'Last Name'}
                </label>
                <input className="input" value={(form as any).lastName || ''}
                  onChange={(e) => upd('lastName', e.target.value)}
                  placeholder={es ? 'Apellido' : 'Last name'} />
              </div>
            </div>
            <div style={{ marginTop: '0.75rem' }}>
              <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>
                {es ? 'Teléfono del Cliente' : 'Customer Phone'}
              </label>
              <input type="tel" className="input" value={form.customerPhone || ''}
                onChange={(e) => upd('customerPhone', e.target.value)} placeholder="(805) 555-1234" />
            </div>
          </div>

          {/* Account Info */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.75rem', padding: '1rem' }}>
            <h4 style={{ fontSize: '0.82rem', fontWeight: 700, color: '#94a3b8', marginBottom: '0.75rem' }}>
              🔑 {es ? 'Información de la Cuenta' : 'Account Info'}
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <div>
                <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>
                  {es ? 'Tipo de Cuenta *' : 'Account Type *'}
                </label>
                <select className="select" value={form.accountType || 'Google'} onChange={(e) => upd('accountType', e.target.value)}>
                  {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>
                  {es ? 'Fecha de Creación' : 'Date Created'}
                </label>
                <input type="date" className="input" value={form.dateCreated || ''} onChange={(e) => upd('dateCreated', e.target.value)} />
              </div>
            </div>
            <div style={{ marginBottom: '0.75rem' }}>
              <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>
                Email / {es ? 'Cuenta' : 'Account'} *
              </label>
              <input className="input" value={form.email || ''} onChange={(e) => upd('email', e.target.value)} placeholder="example@gmail.com" />
            </div>
            <div style={{ marginBottom: '0.75rem' }}>
              <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>
                {es ? 'Contraseña' : 'Password'}
              </label>
              <input className="input" style={{ fontFamily: 'monospace', letterSpacing: '0.05em' }}
                value={form.password || ''} onChange={(e) => upd('password', e.target.value)}
                placeholder={es ? 'Contraseña de la cuenta' : 'Account password'} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <div>
                <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>
                  {es ? 'Email de Recuperación' : 'Recovery Email'}
                </label>
                <input className="input" value={form.recoveryEmail || ''} onChange={(e) => upd('recoveryEmail', e.target.value)}
                  placeholder={es ? 'Email alterno' : 'Alternate email'} />
              </div>
              <div>
                <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>
                  {es ? 'Teléfono de Recuperación' : 'Recovery Phone'}
                </label>
                <input className="input" value={form.recoveryPhone || ''} onChange={(e) => upd('recoveryPhone', e.target.value)}
                  placeholder={es ? 'Número de recuperación' : 'Recovery number'} />
              </div>
            </div>
            <div>
              <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>
                {es ? 'Preguntas de Seguridad' : 'Security Questions'}
              </label>
              <textarea className="textarea" rows={2} value={form.securityQuestions || ''}
                onChange={(e) => upd('securityQuestions', e.target.value)}
                placeholder={es ? 'Preguntas y respuestas de seguridad...' : 'Security questions and answers...'} />
            </div>
          </div>

          {/* Service Info */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.75rem', padding: '1rem' }}>
            <h4 style={{ fontSize: '0.82rem', fontWeight: 700, color: '#94a3b8', marginBottom: '0.75rem' }}>
              💰 {es ? 'Información del Servicio' : 'Service Info'}
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <div>
                <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>
                  {es ? 'Equipo Usado' : 'Device Used'}
                </label>
                <input className="input" value={form.deviceUsed || ''} onChange={(e) => upd('deviceUsed', e.target.value)}
                  placeholder="iPhone 15, Samsung S24..." />
              </div>
              <div>
                <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>
                  {es ? 'Cobrado ($)' : 'Charged ($)'}
                </label>
                <input type="number" step="0.01" className="input" value={form.chargedAmount || ''}
                  onChange={(e) => upd('chargedAmount', e.target.value)} placeholder="0.00" />
              </div>
            </div>
            <div>
              <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>
                {es ? 'Notas' : 'Notes'}
              </label>
              <textarea className="textarea" rows={2} value={form.notes || ''}
                onChange={(e) => upd('notes', e.target.value)}
                placeholder={es ? 'Notas adicionales...' : 'Additional notes...'} />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', gap: '0.5rem', paddingTop: '1rem', marginTop: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <button onClick={() => { setShowModal(false); setEditAccount(null); }} className="btn btn-secondary" style={{ flex: 1 }}>
            {L.cancel || 'Cancel'}
          </button>
          {!editAccount && (
            <button onClick={() => setForm({ ...defaultForm(), createdBy: currentEmployee?.name || '' })}
              className="btn btn-secondary" style={{ flex: 0.7 }}>
              🗑️ {es ? 'Limpiar' : 'Clear'}
            </button>
          )}
          {editAccount && (
            <button onClick={() => printAccount(form as Account)} className="btn btn-secondary" style={{ flex: 0.7 }}>
              🖨️ {es ? 'Imprimir' : 'Print'}
            </button>
          )}
          <button onClick={handleSave} className="btn btn-primary" style={{ flex: 1 }}>
            ✓ {editAccount ? (es ? 'Actualizar' : 'Update') : (es ? 'Guardar Cuenta' : 'Save Account')}
          </button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!pendingDeleteId}
        title={es ? '¿Eliminar cuenta?' : 'Delete account?'}
        message={es ? 'Esta acción no se puede deshacer.' : 'This action cannot be undone.'}
        onConfirm={() => {
          if (pendingDeleteId) {
            saveAccounts(accounts.filter((a) => a.id !== pendingDeleteId), pendingDeleteId, true);
            toast(es ? 'Eliminado' : 'Deleted', 'info');
            setPendingDeleteId(null);
          }
        }}
        onCancel={() => setPendingDeleteId(null)}
      />
    </>
  );
}
