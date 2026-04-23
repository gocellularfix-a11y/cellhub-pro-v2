// ============================================================
// CellHub Pro — Settings Module
// ============================================================

import { useState, useCallback } from 'react';
import { useApp } from '@/store/AppProvider';
import { useToast } from '@/components/ui/Toast';
import { Modal, ConfirmDialog } from '@/components/ui';
import { getLabels } from '@/config/i18n';
import { exportBackup, importBackup } from '@/services/storage';
import { persistSettings } from '@/services/persist';
import { DEFAULT_PAYMENT_PORTALS, type PaymentPortal } from '@/config/paymentPortals';
import { isWeakPin } from '@/utils/pinHash';
import { isElectron, getElectronAPI } from '@/utils/platform';
import EmployeeSection from '@/modules/employees/EmployeeSection';
import StoreManagement from './StoreManagement';
import FirebaseSetupModal from './FirebaseSetupModal';
import { SMS_PROVIDERS, isLegacyProvider, type SmsProviderId } from '@/services/smsProviders';

const SECTIONS = [
  { id: 'store',       icon: '🏪',  label: 'Store Info' },
  { id: 'multistore',  icon: '🏬',  label: 'Multi-Store' },
  { id: 'taxes',       icon: '💰',  label: 'Tax Rates & Fees' },
  // r-settings-2b1: commissions tab unifies carriers + top-ups (moved out of
  // the taxes tab where they were embedded for historical reasons). The 5
  // sub-sections (carrier commissions, spiffs, phone carriers, payment
  // portals, international top-ups) all share the "commission income" theme.
  { id: 'commissions', icon: '💰',  label: 'Commission Income' },
  { id: 'hardware',    icon: '🖨️', label: 'Hardware' },
  { id: 'sms',         icon: '📱',  label: 'SMS Notifications' },
  { id: 'whatsapp',    icon: '💬',  label: 'WhatsApp' },
  { id: 'ai',          icon: '🤖',  label: 'AI Assistant' },
  { id: 'employees',   icon: '👥',  label: 'Employees' },
  { id: 'backup',      icon: '💾',  label: 'Backup & Restore' },
];

// ── Field/Toggle helpers — HOISTED (r26 fix C1) ──────────────
// Previously these were declared inside SettingsModule(), which
// caused React to remount the underlying input on every keystroke
// (new component identity per render → focus loss + cursor jump).
// Now they live at module scope so identity is stable across renders.

interface FieldProps {
  label: string;
  settingsKey: string;
  settings: Record<string, any>;
  update: (key: string, value: unknown) => void;
  type?: string;
  placeholder?: string;
  step?: string;
  min?: string;
  max?: string;
}

function Field({ label, settingsKey, settings, update, type = 'text', placeholder = '', step, min, max }: FieldProps) {
  return (
    <div>
      <label className="text-xs text-slate-400 block mb-1">{label}</label>
      <input
        type={type}
        value={settings[settingsKey] ?? ''}
        onChange={(e) => update(settingsKey, type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value)}
        className="input"
        placeholder={placeholder}
        step={step}
        min={min}
        max={max}
      />
    </div>
  );
}

interface ToggleProps {
  label: string;
  settingsKey: string;
  settings: Record<string, any>;
  update: (key: string, value: unknown) => void;
}

// r-settings-2a A-05: Toggle is now a real button with role=switch, keyboard
// support (Space/Enter), focus ring, and ARIA state. Visual appearance is
// preserved. The wrapping element changed from <label> to <div> because
// nesting a <button> inside a <label> + clicking the <div> caused double-fire
// in some browsers — the explicit click handler on the button is canonical.
function Toggle({ label, settingsKey, settings, update }: ToggleProps) {
  const value = !!settings[settingsKey];
  const toggle = () => update(settingsKey, !value);
  return (
    <div className="flex items-center justify-between py-2">
      <span id={`toggle-label-${settingsKey}`} className="text-sm text-slate-300">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-labelledby={`toggle-label-${settingsKey}`}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            toggle();
          }
        }}
        className={`w-10 h-5 rounded-full transition-all relative cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500/50 ${value ? 'bg-brand-500' : 'bg-white/20'}`}
      >
        <div className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all ${value ? 'left-5' : 'left-0.5'}`} />
      </button>
    </div>
  );
}

// ── AdminPinField — r-settings-1 A-06 ─────────────────────
// Mirrors SetupWizard's PIN sanitization rules: numeric-only, max 8 digits,
// no leading/trailing whitespace. Prevents users from saving PINs that the
// AdminPinGate cannot match later (e.g. paste with spaces).
interface AdminPinFieldProps {
  label: string;
  settings: Record<string, any>;
  update: (key: string, value: unknown) => void;
}

function AdminPinField({ label, settings, update }: AdminPinFieldProps) {
  const raw = String(settings.adminPin ?? '');
  // Display empty string if the stored value is a bcrypt hash, so the user
  // sees a blank slot to type a new PIN (instead of seeing the hash).
  const isHash = raw.startsWith('$2a$') || raw.startsWith('$2b$') || raw.startsWith('$2y$');
  const display = isHash ? '' : raw;
  // r-settings-2a: soft-warn if current plaintext value matches the weak-PIN
  // blacklist. AdminPinField does NOT block the save (Settings is for owners
  // who know what they're doing) but the warning is always visible.
  // Length-4 minimum gate prevents flagging "12" while user is typing "1234".
  const showWeakWarning = !isHash && display.length >= 4 && isWeakPin(display);
  return (
    <div>
      <label className="text-xs text-slate-400 block mb-1">{label}</label>
      <input
        type="password"
        value={display}
        maxLength={8}
        inputMode="numeric"
        pattern="[0-9]*"
        onChange={(e) => {
          const sanitized = e.target.value.replace(/\D/g, '').slice(0, 8);
          update('adminPin', sanitized);
        }}
        className="input"
        placeholder={isHash ? '••••• (set — type to change)' : 'Numeric only, 4-8 digits'}
      />
      {isHash && (
        <p className="text-xs text-slate-500 mt-1">
          Admin PIN is set and hashed. Type a new PIN to replace it.
        </p>
      )}
      {showWeakWarning && (
        <p className="text-xs text-amber-400 mt-1">
          ⚠️ This PIN is on the common-PIN list. Consider something less guessable.
        </p>
      )}
    </div>
  );
}

// ── UrlField — r-settings-2a A-07 ─────────────────────────
// Soft-warn URL field for cosmetic store URLs (not security-critical).
// Accepts:
//   - Empty value (no warning)
//   - https:// prefix (no warning)
//   - Bare domain like "gocellularsb.com" (no warning — common user style)
// Warns on:
//   - http:// prefix (downgrades security on receipts)
//   - javascript: / data: / vbscript: (XSS surface, but not blocked here —
//     downstream sanitization is the second line of defense)
// Used for storeWebsite, googleReviewUrl, repairStatusBaseUrl.
//
// Strict-block portal URLs (S-03) live inline at the carrier portal site
// because they need access to the carrier-keyed delta state.
interface UrlFieldProps {
  label: string;
  settingsKey: string;
  settings: Record<string, any>;
  update: (key: string, value: unknown) => void;
  placeholder?: string;
}

function classifyUrl(value: string): 'empty' | 'ok' | 'warn-http' | 'warn-script' {
  const v = value.trim();
  if (!v) return 'empty';
  const lower = v.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:')) {
    return 'warn-script';
  }
  if (lower.startsWith('http://')) return 'warn-http';
  // https:// or bare domain → ok
  return 'ok';
}

function UrlField({ label, settingsKey, settings, update, placeholder = '' }: UrlFieldProps) {
  const value = String(settings[settingsKey] ?? '');
  const status = classifyUrl(value);
  return (
    <div>
      <label className="text-xs text-slate-400 block mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => update(settingsKey, e.target.value)}
        className="input"
        placeholder={placeholder}
      />
      {status === 'warn-http' && (
        <p className="text-xs text-amber-400 mt-1">
          ⚠️ Use https:// for security — http links may be blocked on customer devices.
        </p>
      )}
      {status === 'warn-script' && (
        <p className="text-xs text-red-400 mt-1">
          ⚠️ Invalid URL — must start with https:// (or be a plain domain).
        </p>
      )}
    </div>
  );
}

export default function SettingsModule() {
  const {
    // r-settings-1 B-08: sales added so Export Today reads live AppState
    // instead of stale localStorage cache.
    state: { settings, employees, lang, currentEmployee, sales,
      customers, inventory, repairs, unlocks, specialOrders, layaways,
      purchaseOrders, appointments, expenses, customerReturns, vendorReturns },
    setSettings, setEmployees, dispatch,
  } = useApp();

  const { toast } = useToast();

  // ── r-settings-2b2 A-04: detected printers wiring ──────────
  // Scans the Electron bridge for available printers and persists the list
  // into settings.detectedPrinters. Convention preserved from existing
  // consumer sites: index 0 of the array is the "selected" printer. When
  // the user picks a name from the dropdown, the array is reorganized so
  // that the chosen name becomes detectedPrinters[0].
  const [scanningPrinters, setScanningPrinters] = useState(false);

  // R-SMS-SETTINGS-UI: placeholder flag for the "Configure SMS" wizard.
  // Wizard component wiring arrives in R-SMS-WIZARD — this flag just
  // toggles a stub banner for now.
  const [smsWizardOpen, setSmsWizardOpen] = useState(false);

  const scanForPrinters = useCallback(async () => {
    if (!isElectron()) {
      toast(
        lang === 'es'
          ? 'La detección de impresoras solo funciona en la app de escritorio.'
          : 'Printer detection is only available in the desktop app.',
        'info',
      );
      return;
    }
    setScanningPrinters(true);
    try {
      const api = getElectronAPI();
      if (!api) throw new Error('Electron API unavailable');
      const raw = await api.getPrinters();
      const scannedNames = (raw || []).map((p) => p.name).filter(Boolean);

      // Preserve existing selection if still present in the scan result.
      // Otherwise fall back to the Electron-reported isDefault printer.
      // Otherwise fall back to the first scanned name.
      const current = (settings.detectedPrinters || [])[0];
      let selected: string | undefined;
      if (current && scannedNames.includes(current)) {
        selected = current;
      } else {
        const osDefault = (raw || []).find((p) => p.isDefault)?.name;
        selected = osDefault || scannedNames[0];
      }

      const reordered = selected
        ? [selected, ...scannedNames.filter((n) => n !== selected)]
        : scannedNames;

      // r26 C4: delta only — do NOT spread `...settings`.
      setSettings({ detectedPrinters: reordered });
      persistSettings({ detectedPrinters: reordered });

      if (scannedNames.length === 0) {
        toast(
          lang === 'es'
            ? 'No se detectaron impresoras. Verifica que estén conectadas y encendidas.'
            : 'No printers detected. Check that they are connected and powered on.',
          'info',
        );
      } else {
        toast(
          lang === 'es'
            ? `${scannedNames.length} impresora(s) detectada(s)`
            : `${scannedNames.length} printer(s) detected`,
          'success',
        );
      }
    } catch (err) {
      console.error('[scanForPrinters] failed:', err);
      toast(
        lang === 'es'
          ? 'Error al escanear impresoras'
          : 'Failed to scan printers',
        'error',
      );
    } finally {
      setScanningPrinters(false);
    }
  }, [settings.detectedPrinters, setSettings, toast, lang]);

  const selectPrinter = useCallback((name: string) => {
    const current = settings.detectedPrinters || [];
    if (current[0] === name) return; // already selected, no-op
    const reordered = [name, ...current.filter((n) => n !== name)];
    // r26 C4: delta only
    setSettings({ detectedPrinters: reordered });
    persistSettings({ detectedPrinters: reordered });
    toast(
      lang === 'es'
        ? `Impresora seleccionada: ${name}`
        : `Selected printer: ${name}`,
      'success',
    );
  }, [settings.detectedPrinters, setSettings, toast, lang]);
  const L = getLabels(lang);
  const [activeSection, setActiveSection] = useState('store');

  // ── Confirm modal (replaces confirm/alert/prompt) ────────
  const [confirmModal, setConfirmModal] = useState<{
    title: string; body: string; confirmWord?: string;
    onConfirm: () => void;
  } | null>(null);
  const [confirmInput, setConfirmInput] = useState('');

  // r-new-7: cloud sync opt-in toggle target ('on' | 'off' | null)
  const [cloudToggleTarget, setCloudToggleTarget] = useState<'on' | 'off' | null>(null);
  const [showFirebaseSetup, setShowFirebaseSetup] = useState(false);
  const [showRestartPrompt, setShowRestartPrompt] = useState<'enabled' | 'disabled' | null>(null);

  const requireConfirm = (opts: typeof confirmModal) => {
    setConfirmInput('');
    setConfirmModal(opts);
  };

  const update = useCallback(
    (key: string, value: unknown) => {
      setSettings({ [key]: value } as any);
      // Fire-and-forget persist — optimistic update already applied
      persistSettings({ [key]: value } as Record<string, unknown>);
    },
    [setSettings],
  );

  // ── Export / Import ─────────────────────────────────────
  const handleExport = useCallback(() => {
    const data: Record<string, unknown> = {
      sales,
      customers,
      inventory,
      repairs,
      unlocks,
      special_orders: specialOrders,
      employees,
      settings,
      layaways,
      purchase_orders: purchaseOrders,
      appointments,
      expenses,
      customer_returns: customerReturns,
      vendor_returns: vendorReturns,
      _exportedAt: new Date().toISOString(),
      _version: '2.1.0',
    };
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cellhub-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Backup exported!', 'success');
  }, [sales, customers, inventory, repairs, unlocks, specialOrders, employees,
      settings, layaways, purchaseOrders, appointments, expenses, customerReturns, vendorReturns, toast]);

  const handleImport = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const result = await importBackup(data);
        if (result.success) {
          toast(L.backupImportedSuccess || 'Backup imported! Reloading…', 'success');
          setTimeout(() => window.location.reload(), 1500);
        } else {
          toast(`Import failed: ${result.error}`, 'error');
        }
      } catch (err) {
        toast(`Import error: ${err}`, 'error');
      }
    };
    input.click();
  }, [toast, L]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-white">⚙️ {L.settings}</h1>

      <div className="flex gap-6">
        {/* Sidebar nav */}
        <div className="w-48 shrink-0 space-y-1">
          {SECTIONS.map((s) => (
            <button key={s.id} onClick={() => setActiveSection(s.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all ${activeSection === s.id ? 'bg-brand-500/20 text-brand-400' : 'text-slate-400 hover:bg-white/5'}`}>
              {s.icon} {s.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 glass-card p-6">
          {activeSection === 'store' && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-white mb-4">{L.storeInformationTitle || 'Store Information'}</h2>
              <Field settings={settings} update={update} label={L.storeName || 'Store Name'} settingsKey="storeName" placeholder="Go Cellular" />
              <Field settings={settings} update={update} label={L.storeAddress || 'Address'} settingsKey="storeAddress" placeholder="516 N. Milpas St., Santa Barbara, CA 93103" />
              <div className="grid grid-cols-2 gap-3">
                <Field settings={settings} update={update} label={L.storePhone || 'Phone'} settingsKey="storePhone" placeholder="(805) 845-5855" />
                <Field settings={settings} update={update} label="Email" settingsKey="storeEmail" placeholder="gocellularfix@gmail.com" />
              </div>
              <UrlField settings={settings} update={update} label="Website" settingsKey="storeWebsite" placeholder="gocellularsb.com" />
              <Field settings={settings} update={update} label="Business Hours" settingsKey="businessHours" placeholder="Mon-Sat: 10AM-7PM" />
              <Field settings={settings} update={update} label={L.receiptFooter || 'Receipt Footer'} settingsKey="receiptFooter" />
              <Field settings={settings} update={update} label="Warranty Text" settingsKey="warrantyText" />
              <Field settings={settings} update={update} label="Return Policy" settingsKey="returnPolicy" />
              <div className="border-t border-white/10 pt-4 space-y-3">
                <h3 className="text-sm font-semibold text-white">
                  ⭐ {L.showReviewQr || 'Google Reviews QR on Receipts'}
                </h3>
                <Toggle settings={settings} update={update} label={L.showReviewQr || 'Show Google Reviews QR on Receipts'} settingsKey="showReviewQr" />
                {settings.showReviewQr && (
                  <UrlField
                    settings={settings}
                    update={update}
                    label={L.googleReviewUrl || 'Google Review Link'}
                    settingsKey="googleReviewUrl"
                    placeholder="https://g.page/r/CThz_PIcQfrrEBM/review"
                  />
                )}
              </div>
              <div className="border-t border-white/10 pt-4 space-y-3">
                <h3 className="text-sm font-semibold text-white">
                  🔗 {L.repairTrackingLink || 'Customer Repair Tracking'}
                </h3>
                <UrlField
                  settings={settings}
                  update={update}
                  label={L.repairStatusBaseUrl || 'Repair Status Page URL'}
                  settingsKey="repairStatusBaseUrl"
                  placeholder="https://cellhubpro.com/repair-status.html"
                />
                <p className="text-xs text-slate-400">
                  {lang === 'es'
                    ? 'La app genera un link único por ticket. El cliente puede escanear el QR para ver el estado de su reparación en tiempo real.'
                    : 'The app generates a unique link per ticket. Customers scan the QR to see real-time repair status.'}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field settings={settings} update={update} label="Invoice Prefix" settingsKey="invoicePrefix" placeholder="INV" />
                <Field settings={settings} update={update} label="Customer # Prefix" settingsKey="customerNumberPrefix" placeholder="GC" />
              </div>
              {/* r27: adminPin edited here is plaintext at the input boundary, but
                  the boot migration in App.tsx hashes it on the next launch. Long-term
                  this should hash on save — tracked separately.
                  r-settings-1 A-06: AdminPinField sanitizes input (numeric, no spaces). */}
              <AdminPinField settings={settings} update={update} label="Admin PIN" />
            </div>
          )}

          {activeSection === 'taxes' && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-white mb-4">{L.taxRatesFeesTitle || 'Tax Rates & Fees'}</h2>
              <div className="grid grid-cols-2 gap-3">
                <Field settings={settings} update={update} label="Sales Tax Rate" settingsKey="taxRate" type="number" step="0.0001" placeholder="0.0925" />
                <Field settings={settings} update={update} label="Utility Users Tax" settingsKey="utilityUsersTax" type="number" step="0.001" placeholder="0.055" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field settings={settings} update={update} label="Mobile Surcharge ($)" settingsKey="mobileSurcharge" type="number" step="0.01" placeholder="0.41" />
                <Field settings={settings} update={update} label="Credit Card Fee ($)" settingsKey="creditCardFee" type="number" step="0.01" placeholder="5.00" />
              </div>
              <p className="text-xs text-slate-500 -mt-2">
                {lang === 'es'
                  ? 'Cargo fijo por tarjeta. Ej: 5.00 = $5.00 por transacción.'
                  : 'Fixed credit card fee per transaction. Ex: 5.00 = $5.00. Cashiers can override at checkout.'}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Field settings={settings} update={update} label={lang === 'es' ? 'Política de Devolución (días)' : 'Return Policy (days)'} settingsKey="returnPolicyDays" type="number" step="1" min="0" placeholder="30" />
              </div>

              <div className="border-t border-white/10 pt-4">
                <h3 className="text-sm font-semibold text-white mb-3">CBE (Covered Battery-Embedded) Fees</h3>
                <Toggle settings={settings} update={update} label="Enable CBE Fee Collection" settingsKey="cbeFeeEnabled" />
                <div className="grid grid-cols-3 gap-3 mt-3">
                  <Field settings={settings} update={update} label="CBE Rate" settingsKey="cbeFeeRate" type="number" step="0.001" placeholder="0.015" />
                  <Field settings={settings} update={update} label="Max per Unit ($)" settingsKey="cbeFeeMax" type="number" step="0.01" placeholder="15.00" />
                  <Field settings={settings} update={update} label="Screen Fee ($)" settingsKey="screenFeeAmount" type="number" step="0.01" placeholder="0.50" />
                </div>
              </div>

              {/* ── 📊 Tax Calculation Examples ────────────────────── */}
              <div className="border-t border-white/10 pt-4">
                <h3 className="text-sm font-semibold text-white mb-3">📊 {lang === 'es' ? 'Ejemplos de Cálculo' : 'Tax Calculation Examples'}</h3>
                <div className="space-y-3">
                  {(() => {
                    const sr = settings.taxRate ?? 0.0925;
                    const ut = settings.utilityUsersTax || 0.055;
                    const ms = settings.mobileSurcharge || 0.41;
                    return (
                      <>
                        <div className="p-3 rounded-lg bg-white/5 text-sm">
                          <div className="font-semibold text-white mb-2">📱 {lang === 'es' ? 'Ejemplo: Funda de Celular' : 'Phone Case Example'}</div>
                          <div className="text-slate-400 space-y-0.5 text-xs">
                            <div>{lang === 'es' ? 'Precio' : 'Product Price'}: $20.00</div>
                            <div>({(sr * 100).toFixed(4)}%): ${(20 * sr).toFixed(2)}</div>
                            <div className="text-emerald-400 font-bold pt-1">{lang === 'es' ? 'Total' : 'Total'}: ${(20 + 20 * sr).toFixed(2)}</div>
                          </div>
                        </div>
                        <div className="p-3 rounded-lg bg-white/5 text-sm">
                          <div className="font-semibold text-white mb-2">📞 {lang === 'es' ? 'Ejemplo: Pago de Teléfono' : 'Bill Payment Example'}</div>
                          <div className="text-slate-400 space-y-0.5 text-xs">
                            <div>{lang === 'es' ? 'Monto' : 'Payment Amount'} ($): $50.00</div>
                            <div>({(ut * 100).toFixed(2)}%): ${(50 * ut).toFixed(2)}</div>
                            <div>{lang === 'es' ? 'Recargo Móvil CA' : 'CA Mobility Fee'}: ${ms.toFixed(2)}</div>
                            <div className="text-emerald-400 font-bold pt-1">{lang === 'es' ? 'Total' : 'Total'}: ${(50 + 50 * ut + ms).toFixed(2)}</div>
                          </div>
                        </div>
                        <div className="p-3 rounded-lg bg-white/5 text-sm">
                          <div className="font-semibold text-white mb-2">🔧 {lang === 'es' ? 'Ejemplo: Servicio de Reparación' : 'Repair Service Example'}</div>
                          <div className="text-slate-400 space-y-0.5 text-xs">
                            <div>{lang === 'es' ? 'Precio del Servicio' : 'Service Price'}: $100.00</div>
                            <div className="italic">{lang === 'es' ? 'Sin impuestos (solo mano de obra)' : 'No tax (labor only — parts are taxable)'}</div>
                            <div className="text-emerald-400 font-bold pt-1">{lang === 'es' ? 'Total' : 'Total'}: $100.00</div>
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>
                <div className="mt-3 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 text-center">
                  ✓ {lang === 'es' ? 'Todos los cambios se guardan automáticamente.' : 'All changes are saved automatically.'}
                </div>
              </div>
            </div>
          )}

          {activeSection === 'commissions' && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-white mb-4">💰 {lang === 'es' ? 'Ingresos por Comisión' : 'Commission Income'}</h2>
              <p className="text-xs text-slate-500 mb-2">
                {lang === 'es'
                  ? 'Comisiones que ganas por pagos de operadores wireless (carriers) y por recargas internacionales (top-ups). Configura cada operador y proveedor para que CellHub Pro reporte tu income real.'
                  : 'Commissions you earn from wireless carrier payments and international top-ups. Configure each carrier and provider so CellHub Pro reports your actual income accurately.'}
              </p>
              {/* ── 💰 Carrier Commission Rates ───────────────────── */}
              <div className="border-t border-white/10 pt-4">
                <h3 className="text-sm font-semibold text-white mb-1">💰 {lang === 'es' ? 'Comisiones por Operador' : 'Carrier Commission Rates'}</h3>
                <p className="text-xs text-slate-500 mb-3">
                  {lang === 'es'
                    ? 'Configura cuánto ganas de comisión por cada pago de operador. Esto es lo que ganas, no lo que cobras al cliente.'
                    : 'Configure how much commission you earn from each carrier payment. This is your earnings, not what you charge the customer.'}
                </p>
                {/* Default fallback rate (used when a carrier has no rate set) */}
                <div className="flex items-center gap-3 p-2 mb-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                  <span className="flex-1 text-sm text-amber-200">
                    {lang === 'es' ? 'Comisión por defecto (fallback)' : 'Default Commission (fallback)'}
                  </span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={((settings.defaultCommissionRate || 0.07) * 100).toFixed(2)}
                      onChange={(e) => {
                        const pct = parseFloat(e.target.value) || 0;
                        update('defaultCommissionRate', pct / 100);
                      }}
                      className="input"
                      style={{ width: '90px', textAlign: 'right' }}
                    />
                    <span className="text-xs text-slate-400">%</span>
                  </div>
                  <span className="text-xs text-amber-300/70 w-40 text-right">
                    {lang === 'es' ? 'Si carrier no tiene rate' : 'When carrier has no rate'}
                  </span>
                </div>
                <div className="space-y-2">
                  {(settings.phoneCarriers || []).map((carrier) => {
                    const rate = settings.carrierCommissions?.[carrier] ?? 0;
                    return (
                      <div key={carrier} className="flex items-center gap-3 p-2 rounded-lg bg-white/5">
                        <span className="flex-1 text-sm text-slate-200">{carrier}</span>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            max="100"
                            value={(rate * 100).toFixed(2)}
                            onChange={(e) => {
                              const pct = parseFloat(e.target.value) || 0;
                              update('carrierCommissions', {
                                ...(settings.carrierCommissions || {}),
                                [carrier]: pct / 100,
                              });
                            }}
                            className="input"
                            style={{ width: '90px', textAlign: 'right' }}
                          />
                          <span className="text-xs text-slate-400">%</span>
                        </div>
                        <span className="text-xs text-slate-500 w-40 text-right">
                          {lang === 'es' ? 'Ej: $100 pago = $' : 'Ex: $100 payment = $'}{(rate * 100).toFixed(2)}
                        </span>
                      </div>
                    );
                  })}
                  {(settings.phoneCarriers || []).length === 0 && (
                    <p className="text-xs text-slate-500 italic">
                      {lang === 'es' ? 'Agrega operadores en la sección de abajo.' : 'Add carriers in the section below.'}
                    </p>
                  )}
                </div>
              </div>

              {/* ── 🎯 Activation Spiffs ──────────────────────── */}
              <div className="border-t border-white/10 pt-4">
                <h3 className="text-sm font-semibold text-white mb-1">🎯 {lang === 'es' ? 'Bonos por Activación (Spiffs)' : 'Activation Spiffs'}</h3>
                <p className="text-xs text-slate-500 mb-3">
                  {lang === 'es'
                    ? 'Bonos que el carrier te paga por nuevas activaciones. Son income interno (no se cobra al cliente). Si están habilitados, se trackean y se reportan en Taxes.'
                    : 'Bonuses the carrier pays you for new activations. Internal income (not charged to customer). When enabled, they are tracked and reported in Taxes.'}
                </p>
                <Toggle settings={settings} update={update} label={lang === 'es' ? 'Habilitar tracking de spiffs' : 'Enable spiff tracking'} settingsKey="trackActivationSpiffs" />

                {settings.trackActivationSpiffs && (
                  <>
                    <div className="mt-3 p-2 rounded-lg bg-amber-500/5 border border-amber-500/20">
                      <div className="flex items-center gap-3">
                        <span className="flex-1 text-sm text-amber-200">
                          {lang === 'es' ? '% reportable a impuestos' : 'Taxable portion'}
                        </span>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            step="1"
                            min="0"
                            max="100"
                            value={Math.round(((settings.spiffTaxableRatio ?? 1) * 100))}
                            onChange={(e) => {
                              const pct = parseFloat(e.target.value);
                              const ratio = Math.max(0, Math.min(1, (isNaN(pct) ? 100 : pct) / 100));
                              update('spiffTaxableRatio', ratio);
                            }}
                            className="input"
                            style={{ width: '70px', textAlign: 'right' }}
                          />
                          <span className="text-xs text-slate-400">%</span>
                        </div>
                      </div>
                      <p className="text-xs text-amber-300/60 mt-1">
                        {lang === 'es'
                          ? 'Default 100% — todo el spiff cuenta como income reportable.'
                          : 'Default 100% — entire spiff counts as reportable income.'}
                      </p>
                    </div>

                    <div className="mt-3 space-y-2">
                      <p className="text-xs text-slate-400">
                        {lang === 'es' ? 'Monto default por carrier (editable por transacción):' : 'Default amount per carrier (editable per transaction):'}
                      </p>
                      {(settings.phoneCarriers || []).map((carrier) => {
                        const amount = settings.carrierSpiffs?.[carrier] ?? 0;
                        return (
                          <div key={`spiff-${carrier}`} className="flex items-center gap-3 p-2 rounded-lg bg-white/5">
                            <span className="flex-1 text-sm text-slate-200">{carrier}</span>
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-slate-400">$</span>
                              <input
                                type="number"
                                step="1"
                                min="0"
                                value={amount}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 0;
                                  update('carrierSpiffs', {
                                    ...(settings.carrierSpiffs || {}),
                                    [carrier]: val,
                                  });
                                }}
                                className="input"
                                style={{ width: '90px', textAlign: 'right' }}
                              />
                            </div>
                          </div>
                        );
                      })}
                      {(settings.phoneCarriers || []).length === 0 && (
                        <p className="text-xs text-slate-500 italic">
                          {lang === 'es' ? 'Agrega operadores primero.' : 'Add carriers first.'}
                        </p>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* ── 📱 Phone Carriers & Payment Portals ──────────── */}
              <div className="border-t border-white/10 pt-4">
                <h3 className="text-sm font-semibold text-white mb-1">📱 {lang === 'es' ? 'Operadores y Portales de Pago' : 'Phone Carriers & Payment Portals'}</h3>
                <p className="text-xs text-slate-500 mb-3">
                  {lang === 'es'
                    ? 'Gestiona los operadores y configura las URLs de los portales de pago. Cada operador puede tener su propio link para pagos externos.'
                    : 'Manage carriers and configure payment portal URLs. Each carrier can have its own portal link for external payments.'}
                </p>
                <div className="space-y-2">
                  {(settings.phoneCarriers || []).map((carrier, idx) => {
                    const url = settings.carrierPortalUrls?.[carrier] || '';
                    return (
                      <div key={`${carrier}-${idx}`} className="p-3 rounded-lg bg-white/5 space-y-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={carrier}
                            onChange={(e) => {
                              const newName = e.target.value;
                              // r-settings-1 B-01: detect collision with another existing carrier.
                              // Empty input is allowed (lets user clear-then-type without flicker).
                              if (newName.trim() && newName !== carrier) {
                                const collidesAt = (settings.phoneCarriers || []).findIndex(
                                  (c, i) => i !== idx && c === newName,
                                );
                                if (collidesAt !== -1) {
                                  toast(
                                    lang === 'es'
                                      ? `Ya existe un operador llamado "${newName}"`
                                      : `A carrier named "${newName}" already exists`,
                                    'error',
                                  );
                                  return;
                                }
                              }
                              const newList = [...(settings.phoneCarriers || [])];
                              newList[idx] = newName;
                              // Migrate commission, portal URL, and spiff under new name.
                              // r-settings-1 B-02: collision guard above ensures we never
                              // clobber existing data at the target name.
                              // r-settings-1 B-04: include carrierSpiffs in the migration.
                              const newCommissions = { ...(settings.carrierCommissions || {}) };
                              if (newCommissions[carrier] !== undefined) {
                                newCommissions[newName] = newCommissions[carrier];
                                delete newCommissions[carrier];
                              }
                              const newPortals = { ...(settings.carrierPortalUrls || {}) };
                              if (newPortals[carrier] !== undefined) {
                                newPortals[newName] = newPortals[carrier];
                                delete newPortals[carrier];
                              }
                              const newSpiffs = { ...(settings.carrierSpiffs || {}) };
                              if (newSpiffs[carrier] !== undefined) {
                                newSpiffs[newName] = newSpiffs[carrier];
                                delete newSpiffs[carrier];
                              }
                              // r26 C4: send delta only — do NOT spread `settings`
                              // (closure-stale; clobbers concurrent station updates).
                              const delta = {
                                phoneCarriers: newList,
                                carrierCommissions: newCommissions,
                                carrierPortalUrls: newPortals,
                                carrierSpiffs: newSpiffs,
                              };
                              setSettings(delta);
                              persistSettings(delta as Record<string, unknown>);
                            }}
                            className="input flex-1"
                            placeholder="Carrier name"
                            style={{ fontWeight: 600 }}
                          />
                          <button
                            onClick={() => {
                              const newList = (settings.phoneCarriers || []).filter((_, i) => i !== idx);
                              const newCommissions = { ...(settings.carrierCommissions || {}) };
                              delete newCommissions[carrier];
                              const newPortals = { ...(settings.carrierPortalUrls || {}) };
                              delete newPortals[carrier];
                              // r-settings-1 B-03: also clean carrierSpiffs (was being orphaned).
                              const newSpiffs = { ...(settings.carrierSpiffs || {}) };
                              delete newSpiffs[carrier];
                              // r26 C4: delta only
                              const delta = {
                                phoneCarriers: newList,
                                carrierCommissions: newCommissions,
                                carrierPortalUrls: newPortals,
                                carrierSpiffs: newSpiffs,
                              };
                              setSettings(delta);
                              persistSettings(delta as Record<string, unknown>);
                              toast(lang === 'es' ? 'Operador eliminado' : 'Carrier removed', 'info');
                            }}
                            className="btn btn-ghost btn-sm text-red-400"
                            title={lang === 'es' ? 'Eliminar' : 'Remove'}
                          >
                            🗑️
                          </button>
                        </div>
                        {/* r-settings-2a S-03: portal URL strict-block on open.
                            Typing is unrestricted (user needs to edit), but the
                            🔗 button refuses non-https URLs. Red border + helper
                            text appear when the saved value is non-empty and invalid. */}
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-400" style={{ minWidth: '50px' }}>Portal:</span>
                          <input
                            type="url"
                            value={url}
                            onChange={(e) => update('carrierPortalUrls', {
                              ...(settings.carrierPortalUrls || {}),
                              [carrier]: e.target.value,
                            })}
                            className={`input flex-1 font-mono ${url && !url.toLowerCase().startsWith('https://') ? 'border-red-500/60 ring-1 ring-red-500/30' : ''}`}
                            placeholder="https://portal-url.com (optional)"
                            style={{ fontSize: '0.8rem' }}
                          />
                          {url && (
                            <button
                              onClick={() => {
                                if (!url.toLowerCase().startsWith('https://')) {
                                  toast(
                                    lang === 'es'
                                      ? 'URL inválida — debe empezar con https://'
                                      : 'Invalid URL — must start with https://',
                                    'error',
                                  );
                                  return;
                                }
                                window.open(url, '_blank', 'noopener,noreferrer');
                              }}
                              className="btn btn-ghost btn-sm"
                              title={lang === 'es' ? 'Abrir portal' : 'Open portal'}
                            >
                              🔗
                            </button>
                          )}
                        </div>
                        {url && !url.toLowerCase().startsWith('https://') && (
                          <p className="text-xs text-red-400 mt-1" style={{ paddingLeft: '58px' }}>
                            {lang === 'es'
                              ? 'Debe empezar con https://'
                              : 'Must start with https://'}
                          </p>
                        )}
                      </div>
                    );
                  })}
                  <button
                    onClick={() => {
                      // r-settings-1 B-05: find next available "Carrier N" suffix instead
                      // of using length+1 (which collides if any earlier slot was deleted).
                      const existing = settings.phoneCarriers || [];
                      let n = existing.length + 1;
                      while (existing.includes(`Carrier ${n}`)) n++;
                      const newName = `Carrier ${n}`;
                      const newList = [...existing, newName];
                      // r26 C4: delta only
                      setSettings({ phoneCarriers: newList });
                      persistSettings({ phoneCarriers: newList });
                    }}
                    className="btn btn-secondary btn-sm"
                    style={{ width: '100%' }}
                  >
                    + {lang === 'es' ? 'Agregar Operador' : 'Add Carrier'}
                  </button>
                </div>
              </div>

              {/* ── 🌐 Payment Portals (4 wireless retail processors) ── */}
              <div className="border-t border-white/10 pt-4">
                <h3 className="text-sm font-semibold text-white mb-1">🌐 {lang === 'es' ? 'Portales de Pago' : 'Payment Portals'}</h3>
                <p className="text-xs text-slate-500 mb-3">
                  {lang === 'es'
                    ? 'Procesadores externos donde se hacen los pagos de los operadores. WebPOS, QPay, VidaPay, H2O, etc. Edita los nombres, colores, emoji, y palabras clave para auto-resaltar el portal cuando seleccionas un operador en el modal de Pagos.'
                    : 'External processors where carrier payments are made. WebPOS, QPay, VidaPay, H2O, etc. Edit names, colors, emoji, and match keywords to auto-highlight the right portal when a carrier is selected in the Phone Payment modal.'}
                </p>
                <div className="space-y-2">
                  {(((settings as any).paymentPortals as PaymentPortal[]) || DEFAULT_PAYMENT_PORTALS).map((portal, idx) => {
                    const updatePortal = (patch: Partial<PaymentPortal>) => {
                      const current = ((settings as any).paymentPortals as PaymentPortal[]) || DEFAULT_PAYMENT_PORTALS;
                      const next = current.map((p, i) => i === idx ? { ...p, ...patch } : p);
                      // r26 C4: delta only
                      setSettings({ paymentPortals: next } as any);
                      persistSettings({ paymentPortals: next } as Record<string, unknown>);
                    };
                    const removePortal = () => {
                      const current = ((settings as any).paymentPortals as PaymentPortal[]) || DEFAULT_PAYMENT_PORTALS;
                      const next = current.filter((_, i) => i !== idx);
                      // r26 C4: delta only
                      setSettings({ paymentPortals: next } as any);
                      persistSettings({ paymentPortals: next } as Record<string, unknown>);
                      toast(lang === 'es' ? 'Portal eliminado' : 'Portal removed', 'info');
                    };
                    return (
                      <div key={`${portal.id}-${idx}`} className="p-3 rounded-lg bg-white/5 space-y-2" style={{ borderLeft: `3px solid ${portal.color}` }}>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={portal.emoji}
                            onChange={(e) => updatePortal({ emoji: e.target.value })}
                            className="input"
                            style={{ width: '50px', textAlign: 'center', fontSize: '1.1rem' }}
                            maxLength={2}
                            title="Emoji"
                          />
                          <input
                            type="text"
                            value={portal.label}
                            onChange={(e) => updatePortal({ label: e.target.value })}
                            className="input flex-1"
                            placeholder="Portal name"
                            style={{ fontWeight: 700 }}
                          />
                          <input
                            type="color"
                            value={portal.color}
                            onChange={(e) => updatePortal({ color: e.target.value })}
                            style={{ width: '38px', height: '34px', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '0.4rem', cursor: 'pointer', background: 'transparent' }}
                            title={lang === 'es' ? 'Color' : 'Color'}
                          />
                          <button
                            onClick={removePortal}
                            className="btn btn-ghost btn-sm text-red-400"
                            title={lang === 'es' ? 'Eliminar' : 'Remove'}
                          >
                            🗑️
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs text-slate-500 block mb-0.5">
                              {lang === 'es' ? 'Operadores asociados (coma)' : 'Match carriers (comma)'}
                            </label>
                            <input
                              type="text"
                              value={portal.matchCarriers.join(', ')}
                              onChange={(e) => updatePortal({ matchCarriers: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                              className="input"
                              placeholder="t-mobile, verizon"
                              style={{ fontSize: '0.78rem' }}
                            />
                          </div>
                          <div>
                            <label className="text-xs text-slate-500 block mb-0.5">
                              {lang === 'es' ? 'Fragmentos de URL (coma)' : 'Match URL snippets (comma)'}
                            </label>
                            <input
                              type="text"
                              value={portal.matchUrlSnippets.join(', ')}
                              onChange={(e) => updatePortal({ matchUrlSnippets: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                              className="input"
                              placeholder="paymasterwebpos, epay"
                              style={{ fontSize: '0.78rem' }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <button
                    onClick={() => {
                      const current = ((settings as any).paymentPortals as PaymentPortal[]) || DEFAULT_PAYMENT_PORTALS;
                      // r26 C3: id must be unique and stable. Use timestamp + rand suffix
                      // so renaming the label later doesn't risk collision.
                      const ts = Date.now().toString(36).slice(-6);
                      const rand = Math.random().toString(36).slice(2, 6);
                      const newPortal: PaymentPortal = {
                        id: `portal-${ts}-${rand}`,
                        label: `Portal ${current.length + 1}`,
                        emoji: '🔗',
                        color: '#6b7280',
                        matchCarriers: [],
                        matchUrlSnippets: [],
                      };
                      const next = [...current, newPortal];
                      // r26 C4: delta only
                      setSettings({ paymentPortals: next } as any);
                      persistSettings({ paymentPortals: next } as Record<string, unknown>);
                    }}
                    className="btn btn-secondary btn-sm"
                    style={{ width: '100%' }}
                  >
                    + {lang === 'es' ? 'Agregar Portal' : 'Add Portal'}
                  </button>
                  {((settings as any).paymentPortals as PaymentPortal[] | undefined)?.length === undefined && (
                    <p className="text-xs text-slate-600 mt-1">
                      💡 {lang === 'es'
                        ? 'Mostrando los 4 portales por defecto. Modifica cualquiera para personalizar.'
                        : 'Showing 4 default portals. Edit any one to customize.'}
                    </p>
                  )}
                </div>
              </div>

              {/* ── 🌎 International Top-Up Providers ──────────────── */}
              <div className="border-t border-white/10 pt-4">
                <h3 className="text-sm font-semibold text-white mb-1">🌎 {lang === 'es' ? 'Proveedores de Recarga Internacional' : 'International Top-Up Providers'}</h3>
                <p className="text-xs text-slate-500 mb-3">
                  {lang === 'es'
                    ? 'Lista de proveedores de recarga internacional (Telcel, Movistar, etc.). Agrega, elimina o reordena.'
                    : 'List of international recharge providers (Telcel, Movistar, etc.). Add, remove, or reorder.'}
                </p>
                <div className="space-y-2">
                  {(settings.topUpProviders || []).map((provider, idx) => {
                    // r-settings-2a5: per-provider commission rate. Same shape
                    // as carrierCommissions. Fallback display 0.10 (10%) when
                    // unconfigured, but the underlying value stays undefined
                    // until user explicitly sets it (so the warning logic in
                    // TopUpModal can detect "user never configured this").
                    const rate = ((settings as any).topUpCommissions as Record<string, number> | undefined)?.[provider];
                    const displayRate = rate ?? 0.10;
                    const isUnconfigured = rate === undefined;
                    return (
                      <div key={`${provider}-${idx}`} className="p-2 rounded-lg bg-white/5 space-y-2">
                        <div className="flex items-center gap-2">
                          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: isUnconfigured ? '#fbbf24' : '#10b981', flexShrink: 0 }} />
                          <input
                            type="text"
                            value={provider}
                            onChange={(e) => {
                              const newName = e.target.value;
                              // r-settings-2a5 (B-01 lesson): collision detection.
                              if (newName.trim() && newName !== provider) {
                                const collidesAt = (settings.topUpProviders || []).findIndex(
                                  (p, i) => i !== idx && p === newName,
                                );
                                if (collidesAt !== -1) {
                                  toast(
                                    lang === 'es'
                                      ? `Ya existe un proveedor llamado "${newName}"`
                                      : `A provider named "${newName}" already exists`,
                                    'error',
                                  );
                                  return;
                                }
                              }
                              const newList = [...(settings.topUpProviders || [])];
                              newList[idx] = newName;
                              // r-settings-2a5 (B-04 lesson): migrate commission under new name.
                              const newCommissions = { ...(((settings as any).topUpCommissions as Record<string, number> | undefined) || {}) };
                              if (newCommissions[provider] !== undefined) {
                                newCommissions[newName] = newCommissions[provider];
                                delete newCommissions[provider];
                              }
                              // r26 C4: delta only
                              const delta = {
                                topUpProviders: newList,
                                topUpCommissions: newCommissions,
                              };
                              setSettings(delta as any);
                              persistSettings(delta as Record<string, unknown>);
                            }}
                            className="input flex-1"
                          />
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              max="100"
                              value={(displayRate * 100).toFixed(2)}
                              onChange={(e) => {
                                const pct = parseFloat(e.target.value) || 0;
                                const newRate = pct / 100;
                                const newCommissions = { ...(((settings as any).topUpCommissions as Record<string, number> | undefined) || {}) };
                                newCommissions[provider] = newRate;
                                // r26 C4: delta only
                                setSettings({ topUpCommissions: newCommissions } as any);
                                persistSettings({ topUpCommissions: newCommissions } as Record<string, unknown>);
                              }}
                              className="input"
                              style={{ width: '80px', textAlign: 'right' }}
                              placeholder="10.00"
                            />
                            <span className="text-xs text-slate-400">%</span>
                          </div>
                          <button
                            onClick={() => {
                              const newList = (settings.topUpProviders || []).filter((_, i) => i !== idx);
                              // r-settings-2a5 (B-03 lesson): clean orphan commission.
                              const newCommissions = { ...(((settings as any).topUpCommissions as Record<string, number> | undefined) || {}) };
                              delete newCommissions[provider];
                              // r26 C4: delta only
                              const delta = {
                                topUpProviders: newList,
                                topUpCommissions: newCommissions,
                              };
                              setSettings(delta as any);
                              persistSettings(delta as Record<string, unknown>);
                              toast(lang === 'es' ? 'Proveedor eliminado' : 'Provider removed', 'info');
                            }}
                            className="btn btn-ghost btn-sm text-red-400"
                          >
                            🗑️
                          </button>
                        </div>
                        {isUnconfigured && (
                          <p className="text-xs text-amber-400" style={{ paddingLeft: '20px' }}>
                            ⚠️ {lang === 'es'
                              ? 'Rate por defecto. Configurar el real para precisión fiscal.'
                              : 'Default rate. Configure the real one for tax accuracy.'}
                          </p>
                        )}
                      </div>
                    );
                  })}
                  <button
                    onClick={() => {
                      // r-settings-2a5 (B-05 lesson): find next available
                      // "New Provider N" suffix instead of plain "New Provider"
                      // (which collides on any second click + after deletes).
                      const existing = settings.topUpProviders || [];
                      let n = 1;
                      while (existing.includes(`New Provider ${n}`)) n++;
                      const newName = `New Provider ${n}`;
                      const newList = [...existing, newName];
                      // r26 C4: delta only
                      setSettings({ topUpProviders: newList });
                      persistSettings({ topUpProviders: newList });
                    }}
                    className="btn btn-secondary btn-sm"
                    style={{ width: '100%' }}
                  >
                    + {lang === 'es' ? 'Agregar Proveedor' : 'Add Top-Up Provider'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'hardware' && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-white mb-4">{L.hardwareDevicesTitle || 'Hardware & Devices'}</h2>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Paper Size</label>
                <select value={settings.paperSize} onChange={(e) => update('paperSize', e.target.value)} className="select">
                  <option value="4x6">4×6 Thermal</option>
                  <option value="80mm">80mm Thermal</option>
                  <option value="letter">Letter (8.5×11)</option>
                </select>
              </div>

              {/* ── 🖨️ Receipt Printer — r-settings-2b2 A-04 ─────── */}
              <div className="border-t border-white/10 pt-4">
                <h3 className="text-sm font-semibold text-white mb-2">
                  🖨️ {L.receiptPrinterTitle || 'Receipt Printer'}
                </h3>
                <p className="text-xs text-slate-400 mb-3">
                  {lang === 'es'
                    ? 'Selecciona la impresora predeterminada para recibos, etiquetas, y tickets de reparación.'
                    : 'Select the default printer for receipts, labels, and repair tickets.'}
                </p>

                <div className="flex items-center gap-2 mb-3">
                  <button
                    type="button"
                    onClick={scanForPrinters}
                    disabled={scanningPrinters || !isElectron()}
                    className="btn btn-secondary btn-sm"
                  >
                    {scanningPrinters
                      ? (lang === 'es' ? '⏳ Escaneando...' : '⏳ Scanning...')
                      : (lang === 'es' ? '🔍 Escanear Impresoras' : '🔍 Scan for Printers')}
                  </button>
                  {(settings.detectedPrinters || []).length > 0 && (
                    <span className="text-xs text-slate-400">
                      {lang === 'es'
                        ? `${(settings.detectedPrinters || []).length} detectada(s)`
                        : `${(settings.detectedPrinters || []).length} detected`}
                    </span>
                  )}
                </div>

                {!isElectron() && (
                  <div className="text-xs text-amber-400 p-2 rounded-lg bg-amber-500/5 border border-amber-500/20">
                    ⚠️ {lang === 'es'
                      ? 'La detección de impresoras solo funciona en la app de escritorio. En el navegador, los trabajos de impresión usan el diálogo estándar del navegador.'
                      : 'Printer detection is only available in the desktop app. In browser mode, print jobs use the standard browser dialog.'}
                  </div>
                )}

                {isElectron() && (settings.detectedPrinters || []).length === 0 && (
                  <p className="text-xs text-slate-500">
                    {lang === 'es'
                      ? 'Aún no se han escaneado impresoras. Haz clic en "Escanear Impresoras" arriba.'
                      : 'No printers scanned yet. Click "Scan for Printers" above.'}
                  </p>
                )}

                {isElectron() && (settings.detectedPrinters || []).length > 0 && (
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">
                      {lang === 'es' ? 'Impresora predeterminada' : 'Default printer'}
                    </label>
                    <select
                      value={(settings.detectedPrinters || [])[0] || ''}
                      onChange={(e) => selectPrinter(e.target.value)}
                      className="select"
                    >
                      {(settings.detectedPrinters || []).map((name) => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                    <p className="text-xs text-emerald-400 mt-1">
                      ✓ {lang === 'es'
                        ? `Usando: ${(settings.detectedPrinters || [])[0]}`
                        : `Using: ${(settings.detectedPrinters || [])[0]}`}
                    </p>
                  </div>
                )}
              </div>

              <Field settings={settings} update={update} label="Low Stock Threshold" settingsKey="lowStockThreshold" type="number" min="0" placeholder="0" />
              {/* r-batch-a (2): autoBackup toggle hidden — setting exists but no
                  code actually implements auto-backup. Toggling it gave false
                  confidence to the user. Re-enable when the auto-backup worker
                  is actually wired. */}
              {/* <Toggle settings={settings} update={update} label="Auto Backup" settingsKey="autoBackup" /> */}
            </div>
          )}

          {activeSection === 'sms' && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-white mb-4">{L.smsNotifications || 'SMS Notifications'}</h2>

              {/* R-SMS-SETTINGS-UI: status card + Configure button replaces
                  the old dropdown + API Key pair. Wizard wiring deferred to
                  R-SMS-WIZARD. smsApiSecret, smsFromNumber, and the 3
                  auto-send toggles stay below (unchanged). */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}>
                  {lang === 'es' ? 'Proveedor de SMS' : 'SMS Provider'}
                </label>

                <div
                  style={{
                    padding: 14,
                    border: '1px solid #e5e7eb',
                    borderRadius: 8,
                    background: '#f9fafb',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    {(() => {
                      const provider = (settings.smsProvider || 'none') as SmsProviderId;

                      // State 1: Not configured
                      if (provider === 'none') {
                        return (
                          <>
                            <div style={{ fontWeight: 600, color: '#6b7280' }}>
                              {lang === 'es' ? 'SMS no configurado' : 'SMS not configured'}
                            </div>
                            <div style={{ fontSize: 13, color: '#9ca3af', marginTop: 2 }}>
                              {lang === 'es'
                                ? 'Escoge un proveedor para mandar recibos por SMS'
                                : 'Pick a provider to send receipts via SMS'}
                            </div>
                          </>
                        );
                      }

                      // State 2: Legacy provider (messagebird / nexmo)
                      if (isLegacyProvider(provider)) {
                        return (
                          <>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontWeight: 700 }}>{provider}</span>
                              <span
                                style={{
                                  fontSize: 11,
                                  padding: '2px 8px',
                                  borderRadius: 10,
                                  background: '#fef3c7',
                                  color: '#92400e',
                                  fontWeight: 700,
                                }}
                              >
                                ⚠ {lang === 'es' ? 'Provider legacy' : 'Legacy provider'}
                              </span>
                            </div>
                            <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>
                              {lang === 'es'
                                ? 'Este proveedor no es soportado. Migra a Twilio, Telnyx, o Plivo.'
                                : 'This provider is not supported. Migrate to Twilio, Telnyx, or Plivo.'}
                            </div>
                          </>
                        );
                      }

                      // State 3: Supported provider configured
                      const meta = SMS_PROVIDERS[provider as 'textbelt' | 'twilio' | 'telnyx' | 'plivo'];
                      return (
                        <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontWeight: 700 }}>{meta?.name || provider}</span>
                            <span
                              style={{
                                fontSize: 11,
                                padding: '2px 8px',
                                borderRadius: 10,
                                background: '#d1fae5',
                                color: '#065f46',
                                fontWeight: 700,
                              }}
                            >
                              ✓ {lang === 'es' ? 'Configurado' : 'Configured'}
                            </span>
                          </div>
                          {meta && (
                            <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>
                              {lang === 'es' ? meta.tagline.es : meta.tagline.en}
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>

                  <button
                    onClick={() => setSmsWizardOpen(true)}
                    className="btn"
                    style={{ background: '#3b82f6', color: '#fff', fontWeight: 700 }}
                  >
                    {settings.smsProvider && settings.smsProvider !== 'none'
                      ? lang === 'es'
                        ? 'Cambiar / reconfigurar'
                        : 'Change / reconfigure'
                      : lang === 'es'
                      ? 'Configurar SMS'
                      : 'Configure SMS'}
                  </button>
                </div>

                {/* Placeholder — R-SMS-WIZARD will render <SmsSetupWizard /> here */}
                {smsWizardOpen && (
                  <div
                    style={{
                      marginTop: 10,
                      padding: 12,
                      background: '#fffbeb',
                      border: '1px solid #fde68a',
                      borderRadius: 6,
                      fontSize: 13,
                      color: '#92400e',
                    }}
                  >
                    {lang === 'es'
                      ? 'Wizard pendiente (R-SMS-WIZARD). Cierra este mensaje para continuar.'
                      : 'Wizard pending (R-SMS-WIZARD). Dismiss to continue.'}
                    <button
                      onClick={() => setSmsWizardOpen(false)}
                      style={{
                        marginLeft: 8,
                        background: 'none',
                        border: 'none',
                        textDecoration: 'underline',
                        cursor: 'pointer',
                        color: '#92400e',
                      }}
                    >
                      {lang === 'es' ? 'Cerrar' : 'Dismiss'}
                    </button>
                  </div>
                )}
              </div>

              {settings.smsProvider !== 'none' && (
                <>
                  <Field settings={settings} update={update} label="API Secret" settingsKey="smsApiSecret" type="password" />
                  <Field settings={settings} update={update} label="From Number" settingsKey="smsFromNumber" placeholder="+1XXXXXXXXXX" />
                  <div className="border-t border-white/10 pt-4 space-y-2">
                    <Toggle settings={settings} update={update} label="Auto-send when repair ready" settingsKey="smsAutoRepairReady" />
                    <Toggle settings={settings} update={update} label="Auto-send when unlock ready" settingsKey="smsAutoUnlockReady" />
                    <Toggle settings={settings} update={update} label="Auto-send thank you after sale" settingsKey="smsAutoThankYou" />
                  </div>
                </>
              )}
            </div>
          )}

          {activeSection === 'whatsapp' && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold text-white mb-1">💬 WhatsApp</h2>
              <p className="text-slate-400 text-sm mb-4">
                {lang === 'es'
                  ? 'Botones wa.me que abren WhatsApp con mensajes pre-escritos. Sin costo, sin API.'
                  : 'wa.me buttons that open WhatsApp with pre-filled messages. Free, no API needed.'}
              </p>

              <Toggle settings={settings} update={update} label={lang === 'es' ? 'Mostrar botón WhatsApp en tickets' : 'Show WhatsApp button on tickets'} settingsKey="waEnabled" />

              <div className="border-t border-white/10 pt-4 space-y-1">
                <p className="text-xs text-slate-500 mb-3">
                  {lang === 'es'
                    ? 'Variables disponibles: {nombre/name}, {dispositivo/device}, {balance}, {ticket}, {articulo/item}, {tienda/store}, {telefono/phone}'
                    : 'Available variables: {name}, {device}, {balance}, {ticket}, {item}, {store}, {phone}'}
                  <br />
                  {lang === 'es' ? 'Deja en blanco para usar el template por default.' : 'Leave blank to use the built-in default template.'}
                </p>

                {([
                  { key: 'waTemplateRepairReady',        label: lang === 'es' ? '✅ Reparación lista' : '✅ Repair ready' },
                  { key: 'waTemplateRepairReceived',      label: lang === 'es' ? '📥 Reparación recibida' : '📥 Repair received' },
                  { key: 'waTemplateBalanceDue',          label: lang === 'es' ? '💰 Balance pendiente' : '💰 Balance due' },
                  { key: 'waTemplateSpecialOrderReady',   label: lang === 'es' ? '📦 Orden especial llegó' : '📦 Special order ready' },
                  { key: 'waTemplateLayawayReminder',     label: lang === 'es' ? '🏷️ Recordatorio apartado' : '🏷️ Layaway reminder' },
                  { key: 'waTemplateThankYou',            label: lang === 'es' ? '😊 Gracias' : '😊 Thank you' },
                ] as Array<{ key: keyof typeof settings; label: string }>).map(({ key, label }) => (
                  <div key={String(key)} className="space-y-1">
                    <label className="label">{label}</label>
                    <textarea
                      className="input text-xs"
                      rows={2}
                      value={String(settings[key] || '')}
                      onChange={(e) => update(key as string, e.target.value)}
                      placeholder={lang === 'es' ? 'Deja en blanco para el default...' : 'Leave blank for default...'}
                      style={{ resize: 'vertical', fontFamily: 'inherit' }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeSection === 'ai' && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold text-white mb-4">🤖 AI Assistant</h2>
              {/* Provider selector */}
              <div>
                <label className="text-xs text-slate-400 block mb-2">AI Provider</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  {([
                    { id: 'claude',  label: 'Claude',   emoji: '🟣', sub: 'Anthropic' },
                    { id: 'openai',  label: 'ChatGPT',  emoji: '🟢', sub: 'OpenAI' },
                    { id: 'gemini',  label: 'Gemini',   emoji: '🔵', sub: 'Google' },
                    { id: 'custom',  label: 'Custom',   emoji: '⚙️',  sub: 'OpenAI-compatible' },
                  ] as const).map((p) => (
                    <button
                      key={p.id}
                      onClick={() => update('aiProvider', p.id)}
                      style={{
                        padding: '0.75rem',
                        borderRadius: '0.625rem',
                        border: `2px solid ${settings.aiProvider === p.id ? '#667eea' : 'rgba(255,255,255,0.1)'}`,
                        background: settings.aiProvider === p.id ? 'rgba(102,126,234,0.15)' : 'rgba(255,255,255,0.03)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'all 0.15s',
                      }}
                    >
                      <div style={{ fontSize: '1.2rem', marginBottom: '0.2rem' }}>{p.emoji}</div>
                      <div style={{ fontSize: '0.875rem', fontWeight: 600, color: settings.aiProvider === p.id ? '#a5b4fc' : '#e2e8f0' }}>{p.label}</div>
                      <div style={{ fontSize: '0.7rem', color: '#64748b' }}>{p.sub}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Claude */}
              {settings.aiProvider === 'claude' && (
                <div className="space-y-3">
                  <Field settings={settings} update={update} label="Claude API Key" settingsKey="claudeApiKey" type="password" placeholder="sk-ant-api03-..." />
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Model</label>
                    <select
                      value={settings.claudeModel || 'claude-sonnet-4-6'}
                      onChange={(e) => update('claudeModel', e.target.value)}
                      className="input"
                    >
                      <option value="claude-sonnet-4-6">claude-sonnet-4-6 (recommended)</option>
                      <option value="claude-opus-4-6">claude-opus-4-6 (smartest)</option>
                      <option value="claude-haiku-4-5">claude-haiku-4-5 (fastest, cheapest)</option>
                    </select>
                  </div>
                  <p className="text-xs text-slate-500">
                    Get your key at <strong style={{ color: '#94a3b8' }}>console.anthropic.com</strong>
                  </p>
                </div>
              )}

              {/* OpenAI / ChatGPT */}
              {settings.aiProvider === 'openai' && (
                <div className="space-y-3">
                  <Field settings={settings} update={update} label="OpenAI API Key" settingsKey="openaiApiKey" type="password" placeholder="sk-..." />
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Model</label>
                    <select
                      value={settings.openaiModel || 'gpt-4o'}
                      onChange={(e) => update('openaiModel', e.target.value)}
                      className="input"
                    >
                      <option value="gpt-4o">gpt-4o (recommended)</option>
                      <option value="gpt-4o-mini">gpt-4o-mini (faster, cheaper)</option>
                      <option value="gpt-4-turbo">gpt-4-turbo</option>
                      <option value="gpt-3.5-turbo">gpt-3.5-turbo (budget)</option>
                    </select>
                  </div>
                  <p className="text-xs text-slate-500">
                    Get your key at <strong style={{ color: '#94a3b8' }}>platform.openai.com</strong>
                  </p>
                </div>
              )}

              {/* Gemini */}
              {settings.aiProvider === 'gemini' && (
                <div className="space-y-3">
                  <Field settings={settings} update={update} label="Gemini API Key" settingsKey="geminiApiKey" type="password" placeholder="AIza..." />
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Model</label>
                    <select
                      value={settings.geminiModel || 'gemini-1.5-flash'}
                      onChange={(e) => update('geminiModel', e.target.value)}
                      className="input"
                    >
                      <option value="gemini-1.5-flash">gemini-1.5-flash (fast)</option>
                      <option value="gemini-1.5-pro">gemini-1.5-pro (smarter)</option>
                      <option value="gemini-2.0-flash">gemini-2.0-flash (latest)</option>
                    </select>
                  </div>
                  <p className="text-xs text-slate-500">
                    Get your key at <strong style={{ color: '#94a3b8' }}>aistudio.google.com</strong>
                  </p>
                </div>
              )}

              {/* Custom / OpenAI-compatible */}
              {settings.aiProvider === 'custom' && (
                <div className="space-y-3">
                  <Field settings={settings} update={update} label="API Base URL" settingsKey="customAiUrl" placeholder="https://api.example.com/v1/chat/completions" />
                  <Field settings={settings} update={update} label="API Key" settingsKey="customAiKey" type="password" placeholder="your-api-key" />
                  <Field settings={settings} update={update} label="Model name" settingsKey="customAiModel" placeholder="llama3, mistral, etc." />
                  <p className="text-xs text-slate-500">
                    Compatible with any OpenAI-format API (Ollama, Groq, Together, OpenRouter, etc.)
                  </p>
                </div>
              )}

              {/* Status indicator */}
              <div style={{
                padding: '0.75rem', borderRadius: '0.625rem',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.08)',
                display: 'flex', alignItems: 'center', gap: '0.625rem',
              }}>
                {(() => {
                  const hasKey =
                    (settings.aiProvider === 'claude'  && !!settings.claudeApiKey?.trim()) ||
                    (settings.aiProvider === 'openai'  && !!settings.openaiApiKey?.trim()) ||
                    (settings.aiProvider === 'gemini'  && !!settings.geminiApiKey?.trim()) ||
                    (settings.aiProvider === 'custom'  && !!settings.customAiUrl?.trim() && !!settings.customAiKey?.trim());
                  return (
                    <>
                      <div style={{
                        width: '8px', height: '8px', borderRadius: '50%',
                        background: hasKey ? '#22c55e' : '#f59e0b',
                        flexShrink: 0,
                      }} />
                      <span style={{ fontSize: '0.8rem', color: hasKey ? '#86efac' : '#fbbf24' }}>
                        {hasKey ? 'AI Assistant is configured and ready' : 'Add an API key above to enable AI Assistant'}
                      </span>
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {activeSection === 'multistore' && (
            <StoreManagement lang={lang} L={L} />
          )}

          {activeSection === 'employees' && (
            <EmployeeSection employees={employees} setEmployees={setEmployees} lang={lang} L={L} settings={settings} currentEmployee={currentEmployee} />
          )}

          {activeSection === 'backup' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fff' }}>
                {L.backupRestoreTitle || 'Backup & Restore'}
              </h2>

              {/* r-new-7: Cloud Sync (Firebase) — opt-in with guided setup. */}
              <div style={{ border: '1px solid rgba(148,163,184,0.25)', background: 'rgba(255,255,255,0.03)', borderRadius: '0.75rem', padding: '1.25rem' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, marginTop: 0, marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  ☁️ {lang === 'es' ? 'Sincronización en la Nube' : 'Cloud Sync'}
                  <span style={{
                    fontSize: '0.68rem',
                    fontWeight: 500,
                    padding: '0.15rem 0.5rem',
                    borderRadius: '0.3rem',
                    background: 'rgba(139, 92, 246, 0.15)',
                    color: '#a78bfa',
                  }}>
                    {lang === 'es' ? 'Avanzado' : 'Advanced'}
                  </span>
                </h3>
                <p style={{ fontSize: '0.85rem', color: '#9ca3af', marginBottom: '1rem', lineHeight: 1.5 }}>
                  {lang === 'es'
                    ? 'Respalda tus datos en Firebase (Google Cloud) y sincronízalos entre múltiples dispositivos de tu negocio. Opcional — la app funciona completamente offline sin esto.'
                    : 'Back up your data to Firebase (Google Cloud) and sync across multiple devices for your business. Optional — the app works fully offline without this.'}
                </p>

                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  cursor: 'pointer',
                  padding: '0.75rem',
                  background: 'rgba(255,255,255,0.03)',
                  borderRadius: '0.5rem',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}>
                  <input
                    type="checkbox"
                    checked={!!(settings as any).cloudSyncEnabled}
                    onChange={(e) => setCloudToggleTarget(e.target.checked ? 'on' : 'off')}
                    style={{ width: '1.1rem', height: '1.1rem', cursor: 'pointer' }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.92rem', fontWeight: 500 }}>
                      {lang === 'es' ? 'Activar sincronización con Firebase' : 'Enable Firebase cloud sync'}
                    </div>
                    {(settings as any).cloudSyncEnabled ? (
                      <div style={{ fontSize: '0.78rem', color: '#10b981', marginTop: '0.2rem' }}>
                        ✓ {lang === 'es' ? 'Activo — cambios se respaldan en la nube' : 'Active — changes back up to the cloud'}
                      </div>
                    ) : (
                      <div style={{ fontSize: '0.78rem', color: '#9ca3af', marginTop: '0.2rem' }}>
                        {lang === 'es' ? 'Desactivado — datos solo guardados localmente' : 'Disabled — data stored locally only'}
                      </div>
                    )}
                  </div>
                </label>

                {(settings as any).cloudSyncEnabled && (
                  <div style={{ marginTop: '0.75rem' }}>
                    <button
                      onClick={() => setShowFirebaseSetup(true)}
                      className="btn btn-secondary btn-sm"
                    >
                      {lang === 'es' ? 'Cambiar configuración de Firebase' : 'Change Firebase config'}
                    </button>
                  </div>
                )}
              </div>

              {/* ── Storage Usage Indicator ── */}
              {(() => {
                // r-settings-1 B-11: appointments added (was missing from scan).
                const keys = ['sales','customers','inventory','repairs','unlocks','special_orders','employees','settings','layaways','purchase_orders','appointments'];
                // r-settings-1 B-07: Electron Chromium runtime allows ~10MB per origin.
                // TODO (Round 2): use navigator.storage.estimate() for accurate per-browser quota.
                const LIMIT = 10 * 1024 * 1024;
                let totalBytes = 0;
                const breakdown = keys.map(key => {
                  try {
                    const raw = localStorage.getItem('cellhub_' + key) || '';
                    const bytes = new Blob([raw]).size;
                    totalBytes += bytes;
                    return { key, bytes };
                  } catch { return { key, bytes: 0 }; }
                });
                const pct = Math.min((totalBytes / LIMIT) * 100, 100);
                const color = pct < 50 ? '#10b981' : pct < 75 ? '#f59e0b' : '#ef4444';
                const fmt = (b: number) => b >= 1024*1024 ? (b/1024/1024).toFixed(2)+' MB' : b >= 1024 ? (b/1024).toFixed(1)+' KB' : b+' B';
                const icons: Record<string,string> = { sales:'💰', customers:'👤', inventory:'📦', repairs:'🔧', unlocks:'🔓', special_orders:'📋', employees:'👥', settings:'⚙️', layaways:'🏷️', purchase_orders:'🛒' };
                return (
                  <div style={{ border: `1px solid ${color}40`, background: `${color}08`, borderRadius: '0.75rem', padding: '1rem' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.75rem' }}>
                      <h3 style={{ fontWeight:600, color, margin:0, fontSize:'0.9rem' }}>
                        💾 {lang === 'es' ? 'Almacenamiento Local' : 'Local Storage Usage'}
                      </h3>
                      <span style={{ fontSize:'0.82rem', fontWeight:700, color }}>
                        {fmt(totalBytes)} / 5 MB &nbsp;({pct.toFixed(1)}%)
                      </span>
                    </div>
                    <div style={{ background:'rgba(255,255,255,0.08)', borderRadius:'999px', height:'12px', marginBottom:'1rem', overflow:'hidden' }}>
                      <div style={{ width: pct+'%', height:'100%', borderRadius:'999px', background: color, transition:'width 0.4s ease' }} />
                    </div>
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(160px, 1fr))', gap:'0.5rem' }}>
                      {breakdown.filter(d => d.bytes > 0).sort((a,b) => b.bytes - a.bytes).map(({ key, bytes }) => (
                        <div key={key} style={{ background:'rgba(255,255,255,0.04)', borderRadius:'8px', padding:'0.5rem 0.65rem' }}>
                          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'4px' }}>
                            <span style={{ fontSize:'0.75rem', color:'#cbd5e1' }}>{icons[key]||'📄'} {key.replace(/_/g,' ')}</span>
                            <span style={{ fontSize:'0.72rem', color:'#94a3b8' }}>{fmt(bytes)}</span>
                          </div>
                          <div style={{ background:'rgba(255,255,255,0.07)', borderRadius:'999px', height:'4px', overflow:'hidden' }}>
                            <div style={{ width: Math.min((bytes/LIMIT)*100*10, 100)+'%', height:'100%', borderRadius:'999px', background: color }} />
                          </div>
                        </div>
                      ))}
                    </div>
                    {pct >= 75 && (
                      <div style={{ marginTop:'0.75rem', padding:'0.5rem 0.75rem', background:'rgba(239,68,68,0.1)', borderRadius:'8px', fontSize:'0.78rem', color:'#fca5a5' }}>
                        ⚠️ {lang === 'es' ? 'Almacenamiento alto. Exporta un backup y limpia ventas antiguas.' : 'Storage getting high. Export a backup and archive old sales data.'}
                      </div>
                    )}
                    {pct < 50 && (
                      <div style={{ marginTop:'0.75rem', fontSize:'0.75rem', color:'#64748b' }}>
                        ✅ {lang === 'es' ? 'Almacenamiento en buen estado. Firebase respalda tus datos en la nube.' : 'Storage is healthy. Firebase also backs up your data in the cloud.'}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ── Export / Import ── */}
              <div style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.08), rgba(5,150,105,0.08))', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '0.75rem', padding: '1rem' }}>
                <h3 style={{ fontWeight: 700, color: '#34d399', marginBottom: '0.75rem', fontSize: '0.95rem' }}>
                  📦 {lang === 'es' ? 'Exportar / Importar Datos' : 'Export / Import Data'}
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                  <button onClick={() => {
                    try {
                      // r-settings-1 B-08: read from AppState (live) not localStorage (stale).
                      const today = new Date().toISOString().split('T')[0];
                      const todaySales = (sales || []).filter(
                        (s: any) => s && s.createdAt && String(s.createdAt).startsWith(today),
                      );
                      const blob = new Blob([JSON.stringify(todaySales, null, 2)], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a'); a.href = url; a.download = `Daily_Transactions_${today}.json`; a.click();
                      URL.revokeObjectURL(url);
                      toast(lang === 'es' ? 'Transacciones de hoy exportadas!' : "Today's transactions exported!", 'success');
                    } catch (e) {
                      console.error('Export today failed:', e);
                      toast(lang === 'es' ? 'Error al exportar' : 'Export failed', 'error');
                    }
                  }} className="btn btn-secondary">
                    📤 {lang === 'es' ? 'Exportar Hoy' : 'Export Today'}
                  </button>
                  {/* Auto-backup folder */}
                <div style={{ marginBottom: '1rem', padding: '0.75rem', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.5rem' }}>
                  <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: '0.5rem', fontWeight: 600 }}>
                    📁 {lang === 'es' ? 'Carpeta de Auto-Backup (al cerrar)' : 'Auto-Backup Folder (on close)'}
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <input
                      type="text"
                      className="input"
                      style={{ flex: 1, fontSize: '0.8rem' }}
                      value={(settings as any).backupFolder || 'Documents (default)'}
                      readOnly
                    />
                    <button
                      onClick={async () => {
                        if (window.electronAPI?.setBackupFolder) {
                          const folder = await window.electronAPI.setBackupFolder();
                          if (folder) toast(`Backup folder: ${folder}`, 'success');
                        } else {
                          toast(lang === 'es' ? 'Solo disponible en Electron' : 'Only available in Electron app', 'warning');
                        }
                      }}
                      className="btn btn-secondary"
                      style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                    >
                      📂 {lang === 'es' ? 'Cambiar' : 'Browse'}
                    </button>
                  </div>
                </div>

                <button onClick={handleExport} className="btn btn-primary">
                    💾 {lang === 'es' ? 'Respaldo Completo' : 'Full Backup'}
                  </button>
                </div>
                <button onClick={handleImport} className="btn btn-secondary" style={{ width: '100%' }}>
                  📥 {lang === 'es' ? 'Importar Respaldo' : 'Import Backup'}
                </button>
                <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: 'rgba(255,255,255,0.04)', borderRadius: '0.5rem', fontSize: '0.75rem', color: '#64748b' }}>
                  {lang === 'es'
                    ? 'Los respaldos incluyen: ventas, clientes, inventario, reparaciones, desbloqueos, pedidos especiales, apartados, órdenes de compra, empleados y configuración.'
                    : 'Backups include: sales, customers, inventory, repairs, unlocks, special orders, layaways, purchase orders, employees, and settings.'}
                </div>
              </div>

              {/* ── Clear Local Cache ── */}
              {/* FIX: renamed from "Firebase Data Manager" — these buttons only clear localStorage, NOT Firestore */}
              <div style={{ border: '2px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.05)', borderRadius: '0.75rem', padding: '1rem' }}>
                <h3 style={{ fontWeight: 600, color: '#f87171', marginBottom: '0.5rem', fontSize: '0.95rem' }}>
                  🗄️ {lang === 'es' ? 'Limpiar Caché Local' : 'Clear Local Cache'}
                </h3>
                <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '1rem' }}>
                  {lang === 'es'
                    ? 'Limpia el caché local de una colección. Los datos en Firebase (nube) no se eliminan — se resincronizan al recargar.'
                    : 'Clears the local cache for a collection. Cloud data in Firebase is NOT deleted — it re-syncs on reload.'}
                </p>
                {/* r-settings-1 B-10/B-11: appointments added. employees + settings
                    intentionally NOT included — clearing them locally is too destructive
                    for self-service (Factory Reset is the correct path for those). */}
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                  {[
                    { key: 'repairs',        label: '🔧 Repairs',         color: '#f97316' },
                    { key: 'unlocks',        label: '🔓 Unlocks',         color: '#a78bfa' },
                    { key: 'special_orders', label: '📦 Special Orders',  color: '#60a5fa' },
                    { key: 'sales',          label: '💰 Sales',           color: '#34d399' },
                    { key: 'customers',      label: '👤 Customers',       color: '#f472b6' },
                    { key: 'inventory',      label: '📋 Inventory',       color: '#facc15' },
                    { key: 'layaways',       label: '🏷️ Layaways',       color: '#fb923c' },
                    { key: 'purchase_orders',label: '🛒 Purchase Orders', color: '#38bdf8' },
                    { key: 'appointments',   label: '📅 Appointments',    color: '#c084fc' },
                  ].map(({ key, label, color }) => (
                    <button key={key}
                      style={{ border: `1px solid ${color}40`, color, background: `${color}10`, padding: '0.3rem 0.6rem', borderRadius: '0.375rem', cursor: 'pointer', fontSize: '0.78rem' }}
                      onClick={() => requireConfirm({
                        title: lang === 'es' ? `¿Limpiar caché de ${label}?` : `Clear ${label} cache?`,
                        body: lang === 'es'
                          ? `Esto limpia el caché local de "${label}". Los datos en Firebase NO se borran.`
                          : `This clears the local cache for "${label}". Firebase cloud data is NOT deleted.`,
                        confirmWord: lang === 'es' ? 'LIMPIAR' : 'CLEAR',
                        onConfirm: () => {
                          try { localStorage.removeItem('cellhub_' + key); } catch {}
                          toast(lang === 'es' ? `Caché de ${label} limpiado. Recarga para sincronizar.` : `${label} cache cleared. Reload to re-sync.`, 'success');
                        },
                      })}>
                      🗑️ {label}
                    </button>
                  ))}
                </div>
                <div style={{ padding: '0.5rem 0.75rem', background: 'rgba(239,68,68,0.08)', borderRadius: '0.375rem', fontSize: '0.75rem', color: '#fca5a5' }}>
                  ⚠️ {lang === 'es' ? 'Exporta un backup antes de limpiar.' : 'Export a backup before clearing.'}
                </div>
              </div>

              {/* r-batch-a (2): autoBackup toggle hidden — second instance of
                  the fake toggle, same reason as in the Hardware section. */}
              {/* <Toggle settings={settings} update={update} label={L.autoBackup || 'Auto-backup enabled'} settingsKey="autoBackup" /> */}

              {/* ── DANGER ZONE — Hard Reset ── */}
              <div style={{ border: '2px solid rgba(239,68,68,0.5)', background: 'rgba(239,68,68,0.06)', borderRadius: '0.75rem', padding: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                  <span style={{ fontSize: '1.5rem' }}>☢️</span>
                  <div>
                    <h3 style={{ fontWeight: 700, color: '#ef4444', margin: 0, fontSize: '1rem' }}>
                      {lang === 'es' ? 'ZONA DE PELIGRO — Restablecer App' : 'DANGER ZONE — Factory Reset'}
                    </h3>
                    <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: '0.2rem 0 0' }}>
                      {lang === 'es'
                        ? 'Elimina TODOS los datos locales: ventas, clientes, inventario, reparaciones, empleados, configuración. No se puede deshacer.'
                        : 'Deletes ALL local data: sales, customers, inventory, repairs, employees, settings. Cannot be undone.'}
                    </p>
                  </div>
                </div>
                {/* FIX: replaced confirm()/alert()/prompt() with requireConfirm modal */}
                <button
                  onClick={() => requireConfirm({
                    title: lang === 'es' ? '☢️ Restablecer App' : '☢️ Factory Reset',
                    body: lang === 'es'
                      ? 'Esto eliminará TODOS los datos locales (ventas, clientes, inventario, reparaciones, empleados, configuración). Los datos en Firebase se resincronizan al recargar. Esta acción no se puede deshacer.'
                      : 'This will delete ALL local data (sales, customers, inventory, repairs, employees, settings). Firebase cloud data will re-sync on reload. This cannot be undone.',
                    confirmWord: lang === 'es' ? 'RESETEAR' : 'RESET',
                    onConfirm: () => {
                      const keys = Object.keys(localStorage).filter(k => k.startsWith('cellhub_'));
                      keys.forEach(k => localStorage.removeItem(k));
                      ['customer_returns','vendor_returns','sharedFolderPath','lang','cellhub_lang'].forEach(k => {
                        try { localStorage.removeItem(k); } catch {}
                      });
                      toast(lang === 'es' ? 'Datos eliminados. Recargando...' : 'Data deleted. Reloading...', 'success');
                      setTimeout(() => window.location.reload(), 1500);
                    },
                  })}
                  style={{
                    width: '100%', padding: '0.75rem', borderRadius: '0.5rem',
                    border: '2px solid rgba(239,68,68,0.6)',
                    background: 'rgba(239,68,68,0.12)',
                    color: '#ef4444', cursor: 'pointer',
                    fontWeight: 700, fontSize: '0.9rem',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.25)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.12)'; }}
                >
                  ☢️ {lang === 'es' ? 'Restablecer App (Borrar Todo)' : 'Factory Reset (Delete All Data)'}
                </button>
                <div style={{ marginTop: '0.5rem', fontSize: '0.72rem', color: '#7f1d1d', textAlign: 'center' }}>
                  {lang === 'es'
                    ? '💡 Exporta un respaldo completo antes de continuar.'
                    : '💡 Export a full backup before proceeding.'}
                </div>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* ── Confirm Modal — replaces all alert/confirm/prompt ── */}
      {confirmModal && (
        <Modal open onClose={() => setConfirmModal(null)} title={confirmModal.title} size="max-w-md">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <p style={{ fontSize: '0.875rem', color: '#94a3b8', lineHeight: 1.6 }}>
              {confirmModal.body}
            </p>
            {confirmModal.confirmWord && (
              <div>
                <label style={{ fontSize: '0.78rem', color: '#64748b', display: 'block', marginBottom: '0.4rem' }}>
                  {lang === 'es'
                    ? `Escribe "${confirmModal.confirmWord}" para confirmar:`
                    : `Type "${confirmModal.confirmWord}" to confirm:`}
                </label>
                <input
                  className="input"
                  value={confirmInput}
                  onChange={(e) => setConfirmInput(e.target.value)}
                  placeholder={confirmModal.confirmWord}
                  style={{ fontFamily: 'monospace', letterSpacing: '0.05em' }}
                  autoFocus
                />
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setConfirmModal(null)}>
                {lang === 'es' ? 'Cancelar' : 'Cancel'}
              </button>
              <button
                className="btn"
                style={{
                  flex: 1, background: 'rgba(239,68,68,0.15)', color: '#ef4444',
                  border: '1px solid rgba(239,68,68,0.4)',
                  opacity: confirmModal.confirmWord && confirmInput !== confirmModal.confirmWord ? 0.4 : 1,
                  cursor: confirmModal.confirmWord && confirmInput !== confirmModal.confirmWord ? 'not-allowed' : 'pointer',
                }}
                disabled={!!(confirmModal.confirmWord && confirmInput !== confirmModal.confirmWord)}
                onClick={() => {
                  confirmModal.onConfirm();
                  setConfirmModal(null);
                }}
              >
                {lang === 'es' ? 'Confirmar' : 'Confirm'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* r-new-7: Cloud sync enable — check config, open wizard if missing */}
      {cloudToggleTarget === 'on' && (
        <ConfirmDialog
          open
          title={lang === 'es' ? 'Activar sincronización en la nube' : 'Enable cloud sync'}
          message={lang === 'es'
            ? 'La app iniciará la sincronización con Firebase. Si no has configurado Firebase, te guiaremos en el proceso. Deberás reiniciar la app para completar.'
            : 'The app will start syncing with Firebase. If you haven\'t configured Firebase yet, we\'ll walk you through it. You will need to restart to complete.'}
          variant="warning"
          confirmLabel={lang === 'es' ? 'Continuar' : 'Continue'}
          cancelLabel={lang === 'es' ? 'Cancelar' : 'Cancel'}
          onConfirm={() => {
            const hasConfig = !!localStorage.getItem('cellhub_firebase_config');
            if (!hasConfig) {
              setShowFirebaseSetup(true);
              setCloudToggleTarget(null);
            } else {
              setSettings({ cloudSyncEnabled: true } as any);
              persistSettings({ cloudSyncEnabled: true } as Record<string, unknown>);
              setCloudToggleTarget(null);
              setShowRestartPrompt('enabled');
            }
          }}
          onCancel={() => setCloudToggleTarget(null)}
        />
      )}

      {/* r-new-7: Cloud sync disable confirmation */}
      {cloudToggleTarget === 'off' && (
        <ConfirmDialog
          open
          title={lang === 'es' ? 'Desactivar sincronización en la nube' : 'Disable cloud sync'}
          message={lang === 'es'
            ? 'Tus datos locales no se pierden. Cambios nuevos no se respaldarán en Firebase hasta reactivar. Deberás reiniciar la app.'
            : 'Your local data is preserved. New changes won\'t back up to Firebase until re-enabled. You will need to restart the app.'}
          variant="warning"
          confirmLabel={lang === 'es' ? 'Desactivar' : 'Disable'}
          cancelLabel={lang === 'es' ? 'Cancelar' : 'Cancel'}
          onConfirm={() => {
            setSettings({ cloudSyncEnabled: false } as any);
            persistSettings({ cloudSyncEnabled: false } as Record<string, unknown>);
            setCloudToggleTarget(null);
            setShowRestartPrompt('disabled');
          }}
          onCancel={() => setCloudToggleTarget(null)}
        />
      )}

      {/* r-new-7: Firebase Setup Modal (guided wizard) */}
      {showFirebaseSetup && (
        <FirebaseSetupModal
          lang={lang}
          onClose={() => setShowFirebaseSetup(false)}
          onComplete={() => {
            setSettings({ cloudSyncEnabled: true } as any);
            persistSettings({ cloudSyncEnabled: true } as Record<string, unknown>);
            setShowFirebaseSetup(false);
            setShowRestartPrompt('enabled');
          }}
        />
      )}

      {/* r-new-7: Restart prompt after enabling/disabling cloud sync */}
      {showRestartPrompt && (
        <ConfirmDialog
          open
          title={lang === 'es' ? 'Reiniciar la app' : 'Restart the app'}
          message={lang === 'es'
            ? `Sincronización ${showRestartPrompt === 'enabled' ? 'activada' : 'desactivada'}. Reinicia la app para aplicar los cambios.`
            : `Cloud sync ${showRestartPrompt}. Restart the app to apply the changes.`}
          variant="default"
          confirmLabel="OK"
          cancelLabel={lang === 'es' ? 'Cerrar' : 'Close'}
          onConfirm={() => setShowRestartPrompt(null)}
          onCancel={() => setShowRestartPrompt(null)}
        />
      )}
    </div>
  );
}
