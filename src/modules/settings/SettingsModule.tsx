// ============================================================
// CellHub Pro — Settings Module
// ============================================================

import { useState, useCallback, useEffect } from 'react';
import { useApp } from '@/store/AppProvider';
import { useToast } from '@/components/ui/Toast';
import { Modal, ConfirmDialog } from '@/components/ui';
import { useTranslation } from '@/i18n';
import { exportBackup, importBackup } from '@/services/storage';
import { persistSettings, getFirestoreInstance } from '@/services/persist';
import { pushAllToCloud, pullAllFromCloud, countLocalRecords } from '@/hooks/useFirestore';
import { sanitizeToBMP } from '@/services/whatsapp';
import { DEFAULT_PAYMENT_PORTALS, type PaymentPortal } from '@/config/paymentPortals';
import { isWeakPin } from '@/utils/pinHash';
import { isElectron, getElectronAPI } from '@/utils/platform';
import {
  readDashboardTheme,
  dashboardThemeLabel,
  DASHBOARD_THEMES,
  type DashboardTheme,
} from '@/theme/dashboardTheme';
import { useTheme, THEMES } from '@/theme';
import EmployeeSection from '@/modules/employees/EmployeeSection';
import StoreManagement from './StoreManagement';
import FirebaseSetupModal from './FirebaseSetupModal';
import ImportTab from './ImportTab';
// R-COMMS-SMS-INFRA-CLEANUP: removed SMS_PROVIDERS / SmsProviderId / isLegacyProvider
// + SmsSetupWizard imports. Service files deleted; tab + wizard retired.
// R-DESKTOP-LICENSE-V1-SCAFFOLD / R-DESKTOP-IDENTITY-WIRING-V1
import {
  getDesktopIdentity,
  initializeDesktopIdentity,
  updateDesktopIdentity,
  normalizeStoreId,
} from '@/services/license/desktopIdentity';


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

// ── PortalRow — R-CARRIERS-INPUT-FIX ──────────────────────
// Hoisted to module scope for stable identity across renders (same
// reasoning as Field/Toggle above). Owns local text state for the
// matchCarriers / matchUrlSnippets inputs so the user can type commas
// and spaces without the value being shredded by split→trim→filter on
// every keystroke. Commits to settings on blur.
interface PortalRowProps {
  portal: PaymentPortal;
  onUpdate: (patch: Partial<PaymentPortal>) => void;
  onRemove: () => void;
}

function PortalRow({ portal, onUpdate, onRemove }: PortalRowProps) {
  const { t } = useTranslation();
  const [matchCarriersText, setMatchCarriersText] = useState(
    portal.matchCarriers.join(', '),
  );
  const [matchUrlSnippetsText, setMatchUrlSnippetsText] = useState(
    portal.matchUrlSnippets.join(', '),
  );

  return (
    <div className="p-3 rounded-lg bg-white/5 space-y-2" style={{ borderLeft: `3px solid ${portal.color}` }}>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={portal.emoji}
          onChange={(e) => onUpdate({ emoji: e.target.value })}
          className="input"
          style={{ width: '50px', textAlign: 'center', fontSize: '1.1rem' }}
          maxLength={2}
          title="Emoji"
        />
        <input
          type="text"
          value={portal.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
          className="input flex-1"
          placeholder="Portal name"
          style={{ fontWeight: 700 }}
        />
        <input
          type="color"
          value={portal.color}
          onChange={(e) => onUpdate({ color: e.target.value })}
          style={{ width: '38px', height: '34px', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '0.4rem', cursor: 'pointer', background: 'transparent' }}
          title="Color"
        />
        <button
          onClick={onRemove}
          className="btn btn-ghost btn-sm text-red-400"
          title={t('settings.commissions.portals.removeTitle')}
        >
          🗑️
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-slate-500 block mb-0.5">
            {t('settings.commissions.portals.matchCarriers')}
          </label>
          <input
            type="text"
            value={matchCarriersText}
            onChange={(e) => setMatchCarriersText(e.target.value)}
            onBlur={(e) => {
              const list = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
              onUpdate({ matchCarriers: list });
              setMatchCarriersText(list.join(', '));
            }}
            className="input"
            placeholder="t-mobile, verizon"
            style={{ fontSize: '0.78rem' }}
          />
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-0.5">
            {t('settings.commissions.portals.matchUrls')}
          </label>
          <input
            type="text"
            value={matchUrlSnippetsText}
            onChange={(e) => setMatchUrlSnippetsText(e.target.value)}
            onBlur={(e) => {
              const list = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
              onUpdate({ matchUrlSnippets: list });
              setMatchUrlSnippetsText(list.join(', '));
            }}
            className="input"
            placeholder="paymasterwebpos, epay"
            style={{ fontSize: '0.78rem' }}
          />
        </div>
      </div>
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
  const { t, locale } = useTranslation();
  const SECTIONS = [
    { id: 'store',       icon: '🏪',  label: t('settings.nav.store') },
    // R-DASHBOARD-THEME-V1
    { id: 'appearance',  icon: '🎨',  label: t('settings.nav.appearance') },
    { id: 'multistore',  icon: '🏬',  label: t('settings.nav.multistore') },
    { id: 'taxes',       icon: '💰',  label: t('settings.nav.taxes') },
    // r-settings-2b1: commissions tab unifies carriers + top-ups
    { id: 'commissions', icon: '💰',  label: t('settings.nav.commissions') },
    { id: 'hardware',    icon: '🖨️', label: t('settings.nav.hardware') },
    // R-COMMS-SMS-INFRA-CLEANUP: 'sms' sidebar entry removed.
    { id: 'whatsapp',    icon: '💬',  label: t('settings.nav.whatsapp') },
    { id: 'ai',          icon: '🤖',  label: t('settings.nav.ai') },
    // R-COMPANION-DESKTOP-SETTINGS-WIRING-V1: dedicated Companion section
    // so the bridge enable toggle is discoverable from the "enable in
    // Settings" hint in Companion Center.
    { id: 'companion',   icon: '📱',  label: t('settings.nav.companion') },
    { id: 'employees',   icon: '👥',  label: t('settings.nav.employees') },
    { id: 'backup',      icon: '💾',  label: t('settings.nav.backup') },
  ];

  // R-COMMS-SMS-INFRA-CLEANUP: smsWizardOpen state removed (Wizard retired).

  const scanForPrinters = useCallback(async () => {
    if (!isElectron()) {
      toast(
        t('settings.hardware.desktopOnly'),
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
          t('settings.hardware.noPrintersFound'),
          'info',
        );
      } else {
        toast(
          t('settings.hardware.printersDetected', scannedNames.length),
          'success',
        );
      }
    } catch (err) {
      console.error('[scanForPrinters] failed:', err);
      toast(
        t('settings.hardware.scanFailed'),
        'error',
      );
    } finally {
      setScanningPrinters(false);
    }
  }, [settings.detectedPrinters, setSettings, toast, t]);

  const selectPrinter = useCallback((name: string) => {
    const current = settings.detectedPrinters || [];
    if (current[0] === name) return; // already selected, no-op
    const reordered = [name, ...current.filter((n) => n !== name)];
    // r26 C4: delta only
    setSettings({ detectedPrinters: reordered });
    persistSettings({ detectedPrinters: reordered });
    toast(
      t('settings.hardware.printerSelected', name),
      'success',
    );
  }, [settings.detectedPrinters, setSettings, toast, t]);

  const { theme, setTheme } = useTheme();
  const [activeSection, setActiveSection] = useState('store');

  const sectionLabels: Record<string, string> = {
    store:       t('settings.nav.store'),
    appearance:  t('settings.nav.appearance'),
    multistore:  t('settings.nav.multistore'),
    taxes:       t('settings.nav.taxes'),
    commissions: t('settings.nav.commissions'),
    hardware:    t('settings.nav.hardware'),
    whatsapp:    t('settings.nav.whatsapp'),
    ai:          t('settings.nav.ai'),
    companion:   t('settings.nav.companion'),
    employees:   t('settings.nav.employees'),
    backup:      t('settings.nav.backup'),
  };

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
  // R-FIREBASE-MULTIPC-SYNC: bulk push/pull state. `busy` disables both
  // buttons during an operation so the cashier can't double-click.
  const [bulkSyncBusy, setBulkSyncBusy] = useState<'push' | 'pull' | null>(null);
  // R-IMPORT-LEGACY-ADAPTER: post-import modal state. Populated only when a
  // legacy v1 backup was normalized AND produced warnings the user should
  // review before the reload fires (reload is deferred until modal close).
  const [importResultModal, setImportResultModal] = useState<{
    stats: Record<string, { total: number; converted: number; passthrough: number }>;
    warnings: string[];
    wasLegacy: boolean;
  } | null>(null);

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

  // R-COMMS-WHATSAPP-EMOJI-FIX-V2.2: one-shot migration to strip non-BMP
  // characters from legacy custom WhatsApp templates persisted before
  // V2/V2.1 sanitize guards existed. Delta-only persist per CLAUDE.md
  // (settings collection merges; passing only changed keys is safe).
  // Runs once on SettingsModule mount; no-op when storage is already clean.
  useEffect(() => {
    const waKeys = [
      'waTemplateRepairReady',
      'waTemplateRepairReceived',
      'waTemplateSpecialOrderReady',
      'waTemplateLayawayReminder',
      'waTemplateAppointmentReminder',
      'waTemplateThankYou',
      'waTemplateBalanceDue',
    ] as const;
    const delta: Record<string, string> = {};
    for (const key of waKeys) {
      const value = String((settings as any)[key] || '');
      const safe = sanitizeToBMP(value);
      if (safe !== value) delta[key] = safe;
    }
    if (Object.keys(delta).length > 0) {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn('[whatsapp] Legacy templates sanitized (migration)', delta);
      }
      setSettings(delta as any);
      persistSettings(delta);
    }
    // Mount-only migration; intentionally empty deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // R-DESKTOP-IDENTITY-WIRING-V1: one-shot migration for installs that
  // completed setup before desktopIdentity existed. Reads storeName from
  // already-loaded settings and initializes identity if not yet present.
  // Safe update rule: storeId is only set when currently empty — UUIDs
  // are never regenerated.
  useEffect(() => {
    const rawName = String((settings as any).storeName ?? '').trim();
    if (!rawName) return;
    const storeId = normalizeStoreId(rawName);
    if (!storeId) return;
    const existing = getDesktopIdentity();
    if (!existing) {
      initializeDesktopIdentity({ storeId });
      console.info(`[DesktopIdentity] initialized storeId=${storeId}`);
    } else if (!existing.storeId) {
      updateDesktopIdentity({ storeId });
      console.info(`[DesktopIdentity] updated storeId=${storeId}`);
    }
    // Mount-only migration; intentionally empty deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // ── R-FIREBASE-MULTIPC-SYNC: bulk push / pull handlers ─────
  const handlePushAllToCloud = useCallback(() => {
    const db = getFirestoreInstance();
    if (!db) {
      toast(t('settings.backup.cloudSync.notReady'), 'error');
      return;
    }
    const localCount = countLocalRecords();
    const isLarge = localCount > 8000;
    requireConfirm({
      title: t('settings.backup.cloudSync.pushTitle'),
      body: isLarge
        ? `${t('settings.backup.cloudSync.pushBody')}\n\n${t('settings.backup.cloudSync.pushBodyLarge', localCount)}`
        : t('settings.backup.cloudSync.pushBody'),
      confirmWord: '',
      onConfirm: async () => {
        setBulkSyncBusy('push');
        try {
          const result = await pushAllToCloud(db);
          toast(t('settings.backup.cloudSync.pushDone', result.records), 'success');
        } catch (err) {
          toast(t('settings.backup.cloudSync.bulkFailed', String((err as Error)?.message || err)), 'error');
        } finally {
          setBulkSyncBusy(null);
        }
      },
    });
  }, [t, toast]);

  const handlePullFromCloud = useCallback(() => {
    const db = getFirestoreInstance();
    if (!db) {
      toast(t('settings.backup.cloudSync.notReady'), 'error');
      return;
    }
    requireConfirm({
      title: t('settings.backup.cloudSync.pullTitle'),
      body: t('settings.backup.cloudSync.pullBody'),
      confirmWord: '',
      onConfirm: async () => {
        setBulkSyncBusy('pull');
        try {
          const result = await pullAllFromCloud(db);
          toast(t('settings.backup.cloudSync.pullDone', result.records), 'success');
          // Reload so React state re-hydrates from the freshly replaced
          // localStorage. The live snapshot subscriber would otherwise race
          // and overwrite our local data with an in-flight cloud snapshot.
          setTimeout(() => window.location.reload(), 1200);
        } catch (err) {
          toast(t('settings.backup.cloudSync.bulkFailed', String((err as Error)?.message || err)), 'error');
          setBulkSyncBusy(null);
        }
      },
    });
  }, [t, toast]);

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

        if (!result.success) {
          toast(t('settings.backup.importError', result.error), 'error');
          return;
        }

        if (result.normalization && result.normalization.warnings.length > 0) {
          // Detailed modal — user must review warnings before continuing.
          // Reload fires when user closes the modal (see onClose below).
          setImportResultModal({
            stats: result.normalization.stats,
            warnings: result.normalization.warnings,
            wasLegacy: true,
          });
        } else if (result.normalization) {
          toast(t('settings.backup.legacyConverted'), 'success');
          setTimeout(() => window.location.reload(), 1500);
        } else {
          toast(t('settings.backup.importedSuccess'), 'success');
          setTimeout(() => window.location.reload(), 1500);
        }
      } catch (err) {
        toast(`Import error: ${err}`, 'error');
      }
    };
    input.click();
  }, [toast, t]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-white">⚙️ {t('settings.title')}</h1>

      <div className="flex gap-6">
        {/* Sidebar nav */}
        <div className="w-48 shrink-0 space-y-1">
          {SECTIONS.map((s) => (
            <button key={s.id} onClick={() => setActiveSection(s.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all ${activeSection === s.id ? 'bg-brand-500/20 text-brand-400' : 'text-slate-400 hover:bg-white/5'}`}>
              {s.icon} {sectionLabels[s.id]}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 glass-card p-6">
          {activeSection === 'store' && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-white mb-4">{t('settings.store.title')}</h2>
              <Field settings={settings} update={update} label={t('settings.store.name')} settingsKey="storeName" placeholder="Go Cellular" />
              <Field settings={settings} update={update} label={t('settings.store.address')} settingsKey="storeAddress" placeholder="516 N. Milpas St., Santa Barbara, CA 93103" />
              <div className="grid grid-cols-2 gap-3">
                <Field settings={settings} update={update} label={t('settings.store.phone')} settingsKey="storePhone" placeholder="(805) 845-5855" />
                <Field settings={settings} update={update} label="Email" settingsKey="storeEmail" placeholder="gocellularfix@gmail.com" />
              </div>
              <UrlField settings={settings} update={update} label="Website" settingsKey="storeWebsite" placeholder="gocellularsb.com" />
              <Field settings={settings} update={update} label={t('settings.store.businessHours')} settingsKey="businessHours" placeholder={t('settings.store.businessHoursPlaceholder')} />
              <Field settings={settings} update={update} label={t('settings.store.receiptFooter')} settingsKey="receiptFooter" placeholder={t('settings.store.receiptFooterPlaceholder')} />
              <Field settings={settings} update={update} label={t('settings.store.warrantyText')} settingsKey="warrantyText" placeholder={t('settings.store.warrantyTextPlaceholder')} />
              <Field settings={settings} update={update} label={t('settings.store.returnPolicy')} settingsKey="returnPolicy" placeholder={t('settings.store.returnPolicyPlaceholder')} />
              <div className="border-t border-white/10 pt-4 space-y-3">
                <h3 className="text-sm font-semibold text-white">⭐ {t('settings.store.showReviewQr')}</h3>
                <Toggle settings={settings} update={update} label={t('settings.store.showReviewQr')} settingsKey="showReviewQr" />
                {settings.showReviewQr && (
                  <UrlField
                    settings={settings}
                    update={update}
                    label={t('settings.store.googleReviewUrl')}
                    settingsKey="googleReviewUrl"
                    placeholder="https://g.page/r/CThz_PIcQfrrEBM/review"
                  />
                )}
              </div>
              <div className="border-t border-white/10 pt-4 space-y-3">
                <h3 className="text-sm font-semibold text-white">🔗 {t('settings.store.repairTrackingLink')}</h3>
                <UrlField
                  settings={settings}
                  update={update}
                  label={t('settings.store.repairStatusBaseUrl')}
                  settingsKey="repairStatusBaseUrl"
                  placeholder="https://cellhubpro.com/repair-status.html"
                />
                <p className="text-xs text-slate-400">
                  {t('settings.store.trackingDesc')}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field settings={settings} update={update} label={t('settings.invoicePrefix')} settingsKey="invoicePrefix" placeholder="INV" />
                <Field settings={settings} update={update} label={t('settings.customerNumPrefix')} settingsKey="customerNumberPrefix" placeholder="GC" />
              </div>
              {/* r27: adminPin edited here is plaintext at the input boundary, but
                  the boot migration in App.tsx hashes it on the next launch. Long-term
                  this should hash on save — tracked separately.
                  r-settings-1 A-06: AdminPinField sanitizes input (numeric, no spaces). */}
              <AdminPinField settings={settings} update={update} label="Admin PIN" />
            </div>
          )}

          {/* R-DASHBOARD-THEME-V1: Appearance section — 3 theme preview cards. */}
          {activeSection === 'appearance' && (() => {
            const currentTheme = readDashboardTheme(settings);
            const renderPreview = (key: DashboardTheme) => {
              if (key === 'tiles') {
                return (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, height: '100%' }}>
                    {['#FBBF24', '#2DD4BF', '#C084FC', '#22D3EE', '#4ADE80', '#FB7185'].map((c, i) => (
                      <div key={i} style={{ background: `linear-gradient(145deg, ${c}33, ${c}11)`, border: `1px solid ${c}66`, borderRadius: 4 }} />
                    ))}
                  </div>
                );
              }
              if (key === 'list') {
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5, height: '100%', padding: 2 }}>
                    {[0,1,2,3,4].map((i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 8, height: 8, borderRadius: 2, background: i === 0 ? '#a78bfa' : 'rgba(255,255,255,0.35)' }} />
                        <div style={{ flex: 1, height: 5, borderRadius: 2, background: i === 0 ? 'rgba(167,139,250,0.5)' : 'rgba(255,255,255,0.10)' }} />
                      </div>
                    ))}
                  </div>
                );
              }
              // bold-blocks
              return (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5, height: '100%' }}>
                  {[
                    { from: '#10B981', to: '#059669' },
                    { from: '#F97316', to: '#EA580C' },
                    { from: '#EF4444', to: '#DC2626' },
                    { from: '#EC4899', to: '#DB2777' },
                    { from: '#14B8A6', to: '#0D9488' },
                    { from: '#8B5CF6', to: '#7C3AED' },
                  ].map((c, i) => (
                    <div key={i} style={{ background: `linear-gradient(155deg, ${c.from}, ${c.to})`, borderRadius: 4, boxShadow: `0 2px 6px ${c.from}55` }} />
                  ))}
                </div>
              );
            };
            const descKey = (k: DashboardTheme) => `settings.appearance.${k === 'bold-blocks' ? 'boldBlocks' : k}.desc`;
            return (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold text-white mb-1">
                  🎨 {t('settings.appearance.title')}
                </h2>
                <p className="text-sm text-slate-400 mb-4">
                  {t('settings.appearance.subtitle')}
                </p>

                {/* Color theme selector — dark / original / bold-light */}
                <div style={{ marginBottom: '1.5rem' }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '0.6rem' }}>
                    {t('settings.appearance.colorTheme')}
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem' }}>
                    {THEMES.map((th) => {
                      const isActive = theme === th.id;
                      const label = locale === 'es' ? th.labelEs : locale === 'pt' ? th.labelPt : th.label;
                      return (
                        <button
                          key={th.id}
                          type="button"
                          onClick={() => setTheme(th.id)}
                          style={{
                            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                            gap: '0.5rem', padding: '0.65rem 0.5rem', borderRadius: '0.75rem',
                            cursor: 'pointer', border: 'none',
                            background: isActive ? 'rgba(167,139,250,0.15)' : 'rgba(255,255,255,0.04)',
                            outline: isActive ? '1px solid rgba(167,139,250,0.50)' : '1px solid rgba(255,255,255,0.06)',
                            transition: 'all 0.18s',
                          }}
                        >
                          <div style={{
                            width: 36, height: 36, borderRadius: '50%',
                            background: th.preview,
                            border: isActive ? '2px solid #a78bfa' : '2px solid rgba(255,255,255,0.15)',
                            boxShadow: isActive ? '0 0 0 2px rgba(167,139,250,0.35)' : 'none',
                          }} />
                          <span style={{ fontSize: '0.75rem', fontWeight: isActive ? 700 : 500, color: isActive ? '#c4b5fd' : '#94a3b8' }}>
                            {label}
                          </span>
                          {isActive && (
                            <span style={{
                              fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.08em',
                              padding: '1px 6px', borderRadius: 999,
                              background: 'rgba(167,139,250,0.20)', color: '#c4b5fd',
                              border: '1px solid rgba(167,139,250,0.40)',
                            }}>
                              ✓
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
                  {DASHBOARD_THEMES.map((key) => {
                    const isActive = currentTheme === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => update('dashboardTheme', key)}
                        style={{
                          padding: '1rem',
                          borderRadius: '0.85rem',
                          background: isActive
                            ? 'linear-gradient(135deg, rgba(124,58,237,0.22), rgba(99,102,241,0.10))'
                            : 'rgba(255,255,255,0.025)',
                          border: isActive
                            ? '2px solid rgba(167,139,250,0.65)'
                            : '1px solid rgba(255,255,255,0.08)',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.75rem',
                          textAlign: 'left',
                          transition: 'all .18s ease',
                          boxShadow: isActive ? '0 10px 28px rgba(124,58,237,0.30)' : 'none',
                        }}
                      >
                        {/* Mini preview swatch */}
                        <div style={{
                          height: 88,
                          borderRadius: 6,
                          padding: 6,
                          background: key === 'bold-blocks' ? '#F4F5F7' : '#0E1018',
                          border: '1px solid rgba(255,255,255,0.06)',
                        }}>
                          {renderPreview(key)}
                        </div>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontWeight: 700, color: '#fff', fontSize: '0.95rem' }}>
                              {dashboardThemeLabel(key, locale)}
                            </span>
                            {isActive && (
                              <span style={{
                                fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.08em',
                                padding: '2px 8px', borderRadius: 999,
                                background: 'rgba(167,139,250,0.20)', color: '#c4b5fd',
                                border: '1px solid rgba(167,139,250,0.40)',
                              }}>
                                ✓ {t('settings.appearance.active')}
                              </span>
                            )}
                          </div>
                          <p style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 6, lineHeight: 1.4 }}>
                            {t(descKey(key))}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <p style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.75rem' }}>
                  💡 {t('settings.appearance.hint')}
                </p>
              </div>
            );
          })()}

          {activeSection === 'taxes' && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-white mb-4">{t('settings.taxes.title')}</h2>
              <div className="grid grid-cols-2 gap-3">
                <Field settings={settings} update={update} label="Sales Tax Rate" settingsKey="taxRate" type="number" step="0.0001" placeholder="0.0925" />
                <Field settings={settings} update={update} label="Utility Users Tax" settingsKey="utilityUsersTax" type="number" step="0.001" placeholder="0.055" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field settings={settings} update={update} label="Mobile Surcharge ($)" settingsKey="mobileSurcharge" type="number" step="0.01" placeholder="0.41" />
                <Field settings={settings} update={update} label="Credit Card Fee ($)" settingsKey="creditCardFee" type="number" step="0.01" placeholder="5.00" />
              </div>
              <p className="text-xs text-slate-500 -mt-2">{t('settings.taxes.creditCardFeeDesc')}</p>
              <div className="grid grid-cols-2 gap-3">
                <Field settings={settings} update={update} label={t('settings.taxes.returnPolicyDays')} settingsKey="returnPolicyDays" type="number" step="1" min="0" placeholder="30" />
              </div>

              <div className="border-t border-white/10 pt-4">
                <h3 className="text-sm font-semibold text-white mb-3">{t('settings.cbeFees')}</h3>
                <Toggle settings={settings} update={update} label={t('settings.cbeFeeEnable')} settingsKey="cbeFeeEnabled" />
                <div className="grid grid-cols-3 gap-3 mt-3">
                  <Field settings={settings} update={update} label={t('settings.cbeRate')} settingsKey="cbeFeeRate" type="number" step="0.001" placeholder="0.015" />
                  <Field settings={settings} update={update} label={t('settings.cbeFeeMax')} settingsKey="cbeFeeMax" type="number" step="0.01" placeholder="15.00" />
                  <Field settings={settings} update={update} label={t('settings.screenFee')} settingsKey="screenFeeAmount" type="number" step="0.01" placeholder="0.50" />
                </div>
              </div>

              {/* ── 📊 Tax Calculation Examples ────────────────────── */}
              <div className="border-t border-white/10 pt-4">
                <h3 className="text-sm font-semibold text-white mb-3">📊 {t('settings.taxes.examples.title')}</h3>
                <div className="space-y-3">
                  {(() => {
                    const sr = settings.taxRate ?? 0.0925;
                    const ut = settings.utilityUsersTax || 0.055;
                    const ms = settings.mobileSurcharge || 0.41;
                    return (
                      <>
                        <div className="p-3 rounded-lg bg-white/5 text-sm">
                          <div className="font-semibold text-white mb-2">📱 {t('settings.taxes.examples.phoneCaseTitle')}</div>
                          <div className="text-slate-400 space-y-0.5 text-xs">
                            <div>{t('settings.taxes.examples.productPrice')}: $20.00</div>
                            <div>({(sr * 100).toFixed(4)}%): ${(20 * sr).toFixed(2)}</div>
                            <div className="text-emerald-400 font-bold pt-1">{lang === 'es' ? 'Total' : 'Total'}: ${(20 + 20 * sr).toFixed(2)}</div>
                          </div>
                        </div>
                        <div className="p-3 rounded-lg bg-white/5 text-sm">
                          <div className="font-semibold text-white mb-2">📞 {t('settings.taxes.examples.billTitle')}</div>
                          <div className="text-slate-400 space-y-0.5 text-xs">
                            <div>{t('settings.taxes.examples.amount')} ($): $50.00</div>
                            <div>({(ut * 100).toFixed(2)}%): ${(50 * ut).toFixed(2)}</div>
                            <div>{t('settings.taxes.examples.caFee')}: ${ms.toFixed(2)}</div>
                            <div className="text-emerald-400 font-bold pt-1">{lang === 'es' ? 'Total' : 'Total'}: ${(50 + 50 * ut + ms).toFixed(2)}</div>
                          </div>
                        </div>
                        <div className="p-3 rounded-lg bg-white/5 text-sm">
                          <div className="font-semibold text-white mb-2">🔧 {t('settings.taxes.examples.repairTitle')}</div>
                          <div className="text-slate-400 space-y-0.5 text-xs">
                            <div>{t('settings.taxes.examples.servicePrice')}: $100.00</div>
                            <div className="italic">{t('settings.taxes.examples.noTax')}</div>
                            <div className="text-emerald-400 font-bold pt-1">{lang === 'es' ? 'Total' : 'Total'}: $100.00</div>
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>
                <div className="mt-3 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 text-center">
                  ✓ {t('settings.taxes.autoSaved')}
                </div>
              </div>
            </div>
          )}

          {activeSection === 'commissions' && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-white mb-4">💰 {t('settings.commissions.title')}</h2>
              <p className="text-xs text-slate-500 mb-2">{t('settings.commissions.desc')}</p>
              {/* ── 💰 Carrier Commission Rates ───────────────────── */}
              <div className="border-t border-white/10 pt-4">
                <h3 className="text-sm font-semibold text-white mb-1">💰 {t('settings.commissions.carrierRates.title')}</h3>
                <p className="text-xs text-slate-500 mb-3">{t('settings.commissions.carrierRates.desc')}</p>
                {/* Default fallback rate (used when a carrier has no rate set) */}
                <div className="flex items-center gap-3 p-2 mb-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                  <span className="flex-1 text-sm text-amber-200">
                    {t('settings.commissions.defaultRate')}
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
                    {t('settings.commissions.noRateSet')}
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
                          {t('settings.commissions.examplePrefix')}{(rate * 100).toFixed(2)}
                        </span>
                      </div>
                    );
                  })}
                  {(settings.phoneCarriers || []).length === 0 && (
                    <p className="text-xs text-slate-500 italic">
                      {t('settings.commissions.addCarriersFirst')}
                    </p>
                  )}
                </div>
              </div>

              {/* ── 🎯 Activation Spiffs ──────────────────────── */}
              <div className="border-t border-white/10 pt-4">
                <h3 className="text-sm font-semibold text-white mb-1">🎯 {t('settings.commissions.spiffs.title')}</h3>
                <p className="text-xs text-slate-500 mb-3">{t('settings.commissions.spiffs.desc')}</p>
                <Toggle settings={settings} update={update} label={t('settings.commissions.spiffs.enableTracking')} settingsKey="trackActivationSpiffs" />

                {settings.trackActivationSpiffs && (
                  <>
                    <div className="mt-3 p-2 rounded-lg bg-amber-500/5 border border-amber-500/20">
                      <div className="flex items-center gap-3">
                        <span className="flex-1 text-sm text-amber-200">
                          {t('settings.commissions.spiffs.taxablePortion')}
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
                        {t('settings.commissions.spiffs.taxableDesc')}
                      </p>
                    </div>

                    <div className="mt-3 space-y-2">
                      <p className="text-xs text-slate-400">
                        {t('settings.commissions.spiffs.defaultPerCarrier')}
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
                          {t('settings.commissions.spiffs.addCarriersFirst')}
                        </p>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* ── 📱 Phone Carriers & Payment Portals ──────────── */}
              <div className="border-t border-white/10 pt-4">
                <h3 className="text-sm font-semibold text-white mb-1">📱 {t('settings.commissions.carriers.title')}</h3>
                <p className="text-xs text-slate-500 mb-3">{t('settings.commissions.carriers.desc')}</p>
                <div className="space-y-2">
                  {(settings.phoneCarriers || []).map((carrier, idx) => {
                    const url = settings.carrierPortalUrls?.[carrier] || '';
                    return (
                      <div key={idx} className="p-3 rounded-lg bg-white/5 space-y-2">
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
                                    t('settings.commissions.carriers.collision', newName),
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
                              toast(t('settings.commissions.carriers.removed'), 'info');
                            }}
                            className="btn btn-ghost btn-sm text-red-400"
                            title={t('settings.commissions.carriers.removeTitle')}
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
                                    t('settings.commissions.carriers.invalidUrl'),
                                    'error',
                                  );
                                  return;
                                }
                                window.open(url, '_blank', 'noopener,noreferrer');
                              }}
                              className="btn btn-ghost btn-sm"
                              title={t('settings.commissions.carriers.openPortal')}
                            >
                              🔗
                            </button>
                          )}
                        </div>
                        {url && !url.toLowerCase().startsWith('https://') && (
                          <p className="text-xs text-red-400 mt-1" style={{ paddingLeft: '58px' }}>
                            {t('settings.commissions.carriers.httpsRequired')}
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
                    + {t('settings.commissions.carriers.addCarrier')}
                  </button>
                </div>
              </div>

              {/* ── 🌐 Payment Portals (4 wireless retail processors) ── */}
              <div className="border-t border-white/10 pt-4">
                <h3 className="text-sm font-semibold text-white mb-1">🌐 {t('settings.commissions.portals.title')}</h3>
                <p className="text-xs text-slate-500 mb-3">{t('settings.commissions.portals.desc')}</p>
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
                      toast(t('settings.commissions.portals.removed'), 'info');
                    };
                    return (
                      <PortalRow
                        key={portal.id}
                        portal={portal}
                        onUpdate={updatePortal}
                        onRemove={removePortal}
                      />
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
                    + {t('settings.commissions.portals.addPortal')}
                  </button>
                  {((settings as any).paymentPortals as PaymentPortal[] | undefined)?.length === undefined && (
                    <p className="text-xs text-slate-600 mt-1">
                      💡 {t('settings.commissions.portals.defaultsHint')}
                    </p>
                  )}
                </div>
              </div>

              {/* ── 🌎 International Top-Up Providers ──────────────── */}
              <div className="border-t border-white/10 pt-4">
                <h3 className="text-sm font-semibold text-white mb-1">🌎 {t('settings.commissions.topup.title')}</h3>
                <p className="text-xs text-slate-500 mb-3">{t('settings.commissions.topup.desc')}</p>
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
                                    t('settings.commissions.topup.collision', newName),
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
                              toast(t('settings.commissions.topup.removed'), 'info');
                            }}
                            className="btn btn-ghost btn-sm text-red-400"
                          >
                            🗑️
                          </button>
                        </div>
                        {isUnconfigured && (
                          <p className="text-xs text-amber-400" style={{ paddingLeft: '20px' }}>
                            ⚠️ {t('settings.commissions.topup.defaultRateWarning')}
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
                    + {t('settings.commissions.topup.addProvider')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'hardware' && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-white mb-4">{t('settings.hardware.title')}</h2>
              <div>
                <label className="text-xs text-slate-400 block mb-1">{t('paperSizeLabel')}</label>
                <select value={settings.paperSize} onChange={(e) => update('paperSize', e.target.value)} className="select">
                  <option value="4x6">4×6 Thermal</option>
                  <option value="80mm">80mm Thermal</option>
                  <option value="letter">Letter (8.5×11)</option>
                </select>
              </div>

              {/* ── 🖨️ Receipt Printer — r-settings-2b2 A-04 ─────── */}
              <div className="border-t border-white/10 pt-4">
                <h3 className="text-sm font-semibold text-white mb-2">
                  🖨️ {t('settings.hardware.printerTitle')}
                </h3>
                <p className="text-xs text-slate-400 mb-3">{t('settings.hardware.printerDesc')}</p>

                <div className="flex items-center gap-2 mb-3">
                  <button
                    type="button"
                    onClick={scanForPrinters}
                    disabled={scanningPrinters || !isElectron()}
                    className="btn btn-secondary btn-sm"
                  >
                    {scanningPrinters ? t('settings.hardware.scanning') : t('settings.hardware.scan')}
                  </button>
                  {(settings.detectedPrinters || []).length > 0 && (
                    <span className="text-xs text-slate-400">
                      {t('settings.hardware.nDetected', (settings.detectedPrinters || []).length)}
                    </span>
                  )}
                </div>

                {!isElectron() && (
                  <div className="text-xs text-amber-400 p-2 rounded-lg bg-amber-500/5 border border-amber-500/20">
                    ⚠️ {t('settings.hardware.browserWarning')}
                  </div>
                )}

                {isElectron() && (settings.detectedPrinters || []).length === 0 && (
                  <p className="text-xs text-slate-500">
                    {t('settings.hardware.noPrintersYet')}
                  </p>
                )}

                {isElectron() && (settings.detectedPrinters || []).length > 0 && (
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">
                      {t('settings.hardware.defaultPrinter')}
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
                      ✓ {t('settings.hardware.usingPrinter', (settings.detectedPrinters || [])[0])}
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

          {/* R-COMMS-SMS-INFRA-CLEANUP: SMS Notifications tab body removed.
              Service files deleted, 14 settings fields retired. WhatsApp tab
              below is the sole customer-comm surface in Settings. */}

          {activeSection === 'whatsapp' && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold text-white mb-1">💬 WhatsApp</h2>
              <p className="text-slate-400 text-sm mb-4">{t('settings.whatsapp.desc')}</p>

              <Toggle settings={settings} update={update} label={t('settings.whatsapp.showButton')} settingsKey="waEnabled" />

              <div className="border-t border-white/10 pt-4 space-y-1">
                <p className="text-xs text-slate-500 mb-3">
                  {t('settings.whatsapp.variablesHint')}
                  <br />
                  {t('settings.whatsapp.leaveBlank')}
                </p>

                {([
                  { key: 'waTemplateRepairReady',        label: t('settings.whatsapp.template.repairReady') },
                  { key: 'waTemplateRepairReceived',      label: t('settings.whatsapp.template.repairReceived') },
                  { key: 'waTemplateBalanceDue',          label: t('settings.whatsapp.template.balanceDue') },
                  { key: 'waTemplateSpecialOrderReady',   label: t('settings.whatsapp.template.specialOrderReady') },
                  { key: 'waTemplateLayawayReminder',     label: t('settings.whatsapp.template.layawayReminder') },
                  { key: 'waTemplateThankYou',            label: t('settings.whatsapp.template.thankYou') },
                ] as Array<{ key: keyof typeof settings; label: string }>).map(({ key, label }) => (
                  <div key={String(key)} className="space-y-1">
                    <label className="label">{label}</label>
                    <textarea
                      className="input text-xs"
                      rows={2}
                      value={String(settings[key] || '')}
                      onChange={(e) => {
                        // R-COMMS-WHATSAPP-EMOJI-FIX-V2.1: strip non-BMP at the
                        // persistence boundary so storage matches what wa.me will
                        // receive. Prevents the "saved 😊, sent nothing" mismatch.
                        const raw = e.target.value;
                        const safe = sanitizeToBMP(raw);
                        if (import.meta.env.DEV && safe !== raw) {
                          // eslint-disable-next-line no-console
                          console.warn('[whatsapp] Non-BMP characters removed from custom template', { original: raw, sanitized: safe });
                        }
                        update(key as string, safe);
                      }}
                      placeholder={t('settings.whatsapp.placeholder')}
                      style={{ resize: 'vertical', fontFamily: 'inherit' }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeSection === 'ai' && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold text-white mb-4">🤖 {t('ai.assistantTitle')}</h2>
              {/* Provider selector */}
              <div>
                <label className="text-xs text-slate-400 block mb-2">{t('settings.aiProvider')}</label>
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
                    <label className="text-xs text-slate-400 block mb-1">{t('model')}</label>
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
                    <label className="text-xs text-slate-400 block mb-1">{t('model')}</label>
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
                    <label className="text-xs text-slate-400 block mb-1">{t('model')}</label>
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
                        {hasKey ? t('ai.configuredReady') : t('ai.addKeyPrompt')}
                      </span>
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {activeSection === 'multistore' && (
            <StoreManagement lang={lang} />
          )}

          {/* R-COMPANION-DESKTOP-SETTINGS-WIRING-V1 — Companion transport
              controls. Houses the bridge enable toggle, bridge URL, and
              a status indicator. Companion Center's "Bridge transport
              disabled — enable in Settings" hint links the user here. */}
          {activeSection === 'companion' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fff' }}>
                {t('settings.companion.title')}
              </h2>
              <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: '-0.4rem', maxWidth: 560, lineHeight: 1.5 }}>
                {t('settings.companion.desc')}
              </p>

              <div style={{
                padding: '1rem 1.1rem',
                background: 'rgba(99,102,241,0.06)',
                border: '1px solid rgba(99,102,241,0.25)',
                borderRadius: '0.75rem',
              }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#a5b4fc', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  📱 {t('settings.companion.bridge.title')}
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', cursor: 'pointer', marginTop: '0.5rem' }}>
                  <input
                    type="checkbox"
                    checked={!!(settings as unknown as { companionBridgeEnabled?: boolean }).companionBridgeEnabled}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setSettings({ companionBridgeEnabled: next } as Partial<typeof settings>);
                      persistSettings({ companionBridgeEnabled: next } as Record<string, unknown>);
                    }}
                    style={{ width: '16px', height: '16px', accentColor: '#818cf8', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: '0.9rem', color: '#e2e8f0', fontWeight: 600 }}>
                    {t('settings.companion.bridge.enabledLabel')}
                  </span>
                </label>
                <p style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.4rem', lineHeight: 1.5 }}>
                  {t('settings.companion.bridge.enabledHint')}
                </p>

                <div style={{ marginTop: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: '#cbd5e1', fontWeight: 600, marginBottom: '0.35rem' }}>
                    {t('settings.companion.bridge.urlLabel')}
                  </label>
                  <input
                    type="text"
                    value={(settings as unknown as { companionBridgeUrl?: string }).companionBridgeUrl ?? ''}
                    onChange={(e) => {
                      const next = e.target.value;
                      setSettings({ companionBridgeUrl: next } as Partial<typeof settings>);
                      persistSettings({ companionBridgeUrl: next } as Record<string, unknown>);
                    }}
                    placeholder="https://cellhub-companion-production.up.railway.app"
                    style={{
                      width: '100%',
                      padding: '0.5rem 0.75rem',
                      background: 'rgba(0,0,0,0.25)',
                      border: '1px solid rgba(148,163,184,0.3)',
                      borderRadius: '0.5rem',
                      color: '#e2e8f0',
                      fontSize: '0.85rem',
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      boxSizing: 'border-box',
                    }}
                  />
                  <p style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.35rem', lineHeight: 1.45 }}>
                    {t('settings.companion.bridge.urlHint')}
                  </p>
                </div>
              </div>

              {/* R-DESKTOP-LICENSE-V1-SCAFFOLD — read-only installation identity panel */}
              {(() => {
                const identity = getDesktopIdentity();
                if (!identity) return null;
                const deviceShort = identity.desktopDeviceId.slice(0, 8) + '…';
                return (
                  <div style={{
                    padding: '0.9rem 1.1rem',
                    background: 'rgba(15,23,42,0.5)',
                    border: '1px solid rgba(148,163,184,0.18)',
                    borderRadius: '0.75rem',
                  }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#94a3b8', marginBottom: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {lang === 'es' ? 'Identidad de instalación' : 'Installation Identity'}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                      {[
                        [lang === 'es' ? 'Tienda' : 'Store', identity.storeId],
                        [lang === 'es' ? 'Dispositivo' : 'Device ID', deviceShort],
                        [lang === 'es' ? 'Licencia' : 'License', lang === 'es' ? 'Sin restricción (dogfood)' : 'Not enforced yet'],
                      ].map(([label, value]) => (
                        <div key={label} style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', fontSize: '0.8rem' }}>
                          <span style={{ color: '#64748b', minWidth: 90 }}>{label}</span>
                          <span style={{ color: '#cbd5e1', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Remote approval toggle — mirrors the one in Employees/Approvals */}
              <div style={{
                padding: '1rem 1.1rem',
                background: 'rgba(99,102,241,0.06)',
                border: '1px solid rgba(99,102,241,0.25)',
                borderRadius: '0.75rem',
              }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#a5b4fc', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  🔐 {t('settings.approvals.remote.label')}
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', cursor: 'pointer', marginTop: '0.5rem' }}>
                  <input
                    type="checkbox"
                    checked={!!settings.companionRemoteApprovalEnabled}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setSettings({ companionRemoteApprovalEnabled: next });
                      persistSettings({ companionRemoteApprovalEnabled: next } as Record<string, unknown>);
                    }}
                    style={{ width: '16px', height: '16px', accentColor: '#818cf8', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: '0.9rem', color: '#e2e8f0', fontWeight: 600 }}>
                    {t('settings.approvals.remote.label')}
                  </span>
                </label>
                <p style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.4rem', lineHeight: 1.5 }}>
                  {t('settings.approvals.remote.desc')}
                </p>
                <p style={{
                  fontSize: '0.7rem',
                  color: '#fbbf24',
                  marginTop: '0.35rem',
                  lineHeight: 1.45,
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.4rem',
                }}>
                  <span aria-hidden="true">⚠️</span>
                  <span>{t('settings.approvals.remote.warning')}</span>
                </p>
              </div>

              {/* Companion-Center cross-link */}
              <div style={{
                padding: '0.75rem 1rem',
                background: 'rgba(148,163,184,0.06)',
                border: '1px solid rgba(148,163,184,0.20)',
                borderRadius: '0.5rem',
                fontSize: '0.8rem',
                color: '#94a3b8',
                lineHeight: 1.5,
              }}>
                {t('settings.companion.openCenterHint')}
              </div>
            </div>
          )}

          {activeSection === 'employees' && (
            <>
              {/* R-APPROVAL-PIN-V1 — global master switch for the approval-PIN feature.
                  When off, no action ever prompts for a manager PIN; when on, each
                  employee's permissions tab decides which actions gate. */}
              <div style={{
                marginBottom: '1rem',
                padding: '0.875rem 1rem',
                background: 'rgba(99,102,241,0.06)',
                border: '1px solid rgba(99,102,241,0.2)',
                borderRadius: '0.625rem',
              }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#a5b4fc', marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  🔐 {t('settings.approvals.title')}
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', cursor: 'pointer', marginTop: '0.5rem' }}>
                  <input
                    type="checkbox"
                    checked={!!(settings as any).approvalsEnabled}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setSettings({ approvalsEnabled: next } as any);
                      persistSettings({ approvalsEnabled: next } as Record<string, unknown>);
                    }}
                    style={{ width: '16px', height: '16px', accentColor: '#818cf8', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: '0.85rem', color: '#e2e8f0', fontWeight: 600 }}>
                    {t('settings.approvals.enabled')}
                  </span>
                </label>
                <p style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.4rem', lineHeight: 1.5 }}>
                  {t('settings.approvals.enabledHint')}
                </p>

                {/* R-COMPANION-REMOTE-APPROVAL-SETTINGS-V1 — live since Phase 2B.
                    Managers can approve/deny from Companion app when enabled. */}
                <div style={{
                  marginTop: '0.75rem',
                  paddingTop: '0.75rem',
                  borderTop: '1px solid rgba(99,102,241,0.15)',
                }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={!!settings.companionRemoteApprovalEnabled}
                      onChange={(e) => {
                        const next = e.target.checked;
                        setSettings({ companionRemoteApprovalEnabled: next });
                        persistSettings({ companionRemoteApprovalEnabled: next } as Record<string, unknown>);
                      }}
                      style={{ width: '16px', height: '16px', accentColor: '#818cf8', cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: '0.85rem', color: '#e2e8f0', fontWeight: 600 }}>
                      {t('settings.approvals.remote.label')}
                    </span>
                  </label>
                  <p style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.4rem', lineHeight: 1.5 }}>
                    {t('settings.approvals.remote.desc')}
                  </p>
                  <p style={{
                    fontSize: '0.7rem',
                    color: '#fbbf24',
                    marginTop: '0.35rem',
                    lineHeight: 1.45,
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.4rem',
                  }}>
                    <span aria-hidden="true">⚠️</span>
                    <span>{t('settings.approvals.remote.warning')}</span>
                  </p>
                </div>
              </div>
              <EmployeeSection employees={employees} setEmployees={setEmployees} settings={settings} currentEmployee={currentEmployee} />
            </>
          )}

          {activeSection === 'backup' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fff' }}>
                {t('settings.backup.title')}
              </h2>

              {/* r-new-7: Cloud Sync (Firebase) — opt-in with guided setup. */}
              <div style={{ border: '1px solid rgba(148,163,184,0.25)', background: 'rgba(255,255,255,0.03)', borderRadius: '0.75rem', padding: '1.25rem' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, marginTop: 0, marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  ☁️ {t('settings.backup.cloudSync.title')}
                  <span style={{
                    fontSize: '0.68rem',
                    fontWeight: 500,
                    padding: '0.15rem 0.5rem',
                    borderRadius: '0.3rem',
                    background: 'rgba(139, 92, 246, 0.15)',
                    color: '#a78bfa',
                  }}>
                    {t('settings.backup.cloudSync.advanced')}
                  </span>
                </h3>
                <p style={{ fontSize: '0.85rem', color: '#9ca3af', marginBottom: '1rem', lineHeight: 1.5 }}>
                  {t('settings.backup.cloudSync.desc')}
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
                      {t('settings.backup.cloudSync.enable')}
                    </div>
                    {(settings as any).cloudSyncEnabled ? (
                      <div style={{ fontSize: '0.78rem', color: '#10b981', marginTop: '0.2rem' }}>
                        {t('settings.backup.cloudSync.active')}
                      </div>
                    ) : (
                      <div style={{ fontSize: '0.78rem', color: '#9ca3af', marginTop: '0.2rem' }}>
                        {t('settings.backup.cloudSync.disabled')}
                      </div>
                    )}
                  </div>
                </label>

                {(settings as any).cloudSyncEnabled && (
                  <div style={{ marginTop: '0.75rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <button
                      onClick={() => setShowFirebaseSetup(true)}
                      className="btn btn-secondary btn-sm"
                    >
                      {t('settings.backup.cloudSync.changeConfig')}
                    </button>
                    {/* R-FIREBASE-MULTIPC-SYNC: bulk push button. */}
                    <button
                      onClick={handlePushAllToCloud}
                      disabled={bulkSyncBusy !== null}
                      className="btn btn-sm"
                      style={{
                        background: bulkSyncBusy === 'push' ? 'rgba(102,126,234,0.25)' : 'rgba(102,126,234,0.15)',
                        border: '1px solid rgba(102,126,234,0.4)',
                        color: '#a5b4fc',
                        cursor: bulkSyncBusy ? 'not-allowed' : 'pointer',
                        opacity: bulkSyncBusy && bulkSyncBusy !== 'push' ? 0.5 : 1,
                      }}
                    >
                      {bulkSyncBusy === 'push'
                        ? `⏳ ${t('settings.backup.cloudSync.pushing')}`
                        : t('settings.backup.cloudSync.pushBtn')}
                    </button>
                    {/* R-FIREBASE-MULTIPC-SYNC: bulk pull button. Reloads on success. */}
                    <button
                      onClick={handlePullFromCloud}
                      disabled={bulkSyncBusy !== null}
                      className="btn btn-sm"
                      style={{
                        background: bulkSyncBusy === 'pull' ? 'rgba(245,158,11,0.25)' : 'rgba(245,158,11,0.12)',
                        border: '1px solid rgba(245,158,11,0.35)',
                        color: '#fbbf24',
                        cursor: bulkSyncBusy ? 'not-allowed' : 'pointer',
                        opacity: bulkSyncBusy && bulkSyncBusy !== 'pull' ? 0.5 : 1,
                      }}
                    >
                      {bulkSyncBusy === 'pull'
                        ? `⏳ ${t('settings.backup.cloudSync.pulling')}`
                        : t('settings.backup.cloudSync.pullBtn')}
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
                        {t('settings.backup.storage.title')}
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
                        ⚠️ {t('settings.backup.storage.high')}
                      </div>
                    )}
                    {pct < 50 && (
                      <div style={{ marginTop:'0.75rem', fontSize:'0.75rem', color:'#64748b' }}>
                        ✅ {t('settings.backup.storage.healthy')}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ── Export / Import ── */}
              <div style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.08), rgba(5,150,105,0.08))', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '0.75rem', padding: '1rem' }}>
                <h3 style={{ fontWeight: 700, color: '#34d399', marginBottom: '0.75rem', fontSize: '0.95rem' }}>
                  {t('settings.backup.exportImport.title')}
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
                      toast(t('settings.backup.todayExported'), 'success');
                    } catch (e) {
                      console.error('Export today failed:', e);
                      toast(t('settings.backup.exportFailed'), 'error');
                    }
                  }} className="btn btn-secondary">
                    {t('settings.backup.exportToday')}
                  </button>
                  {/* Auto-backup folder */}
                <div style={{ marginBottom: '1rem', padding: '0.75rem', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.5rem' }}>
                  <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: '0.5rem', fontWeight: 600 }}>
                    {t('settings.backup.autoBackupFolder')}
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
                          toast(t('settings.backup.electronOnly'), 'warning');
                        }
                      }}
                      className="btn btn-secondary"
                      style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                    >
                      {t('settings.backup.browse')}
                    </button>
                  </div>
                </div>

                <button onClick={handleExport} className="btn btn-primary">
                    {t('settings.backup.fullBackup')}
                  </button>
                </div>
                <button onClick={handleImport} className="btn btn-secondary" style={{ width: '100%' }}>
                  {t('settings.backup.importBackup')}
                </button>
                <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: 'rgba(255,255,255,0.04)', borderRadius: '0.5rem', fontSize: '0.75rem', color: '#64748b' }}>
                  {t('settings.backup.includesDesc')}
                </div>
              </div>

              {/* ── R-IMPORTER-V1: CSV importer (Customers / Inventory) ── */}
              <ImportTab />

              {/* ── Clear Local Cache ── */}
              {/* FIX: renamed from "Firebase Data Manager" — these buttons only clear localStorage, NOT Firestore */}
              <div style={{ border: '2px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.05)', borderRadius: '0.75rem', padding: '1rem' }}>
                <h3 style={{ fontWeight: 600, color: '#f87171', marginBottom: '0.5rem', fontSize: '0.95rem' }}>
                  {t('settings.backup.clearCache.title')}
                </h3>
                <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '1rem' }}>
                  {t('settings.backup.clearCache.desc')}
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
                        title: t('settings.backup.clearCache.confirmTitle', label),
                        body: t('settings.backup.clearCache.confirmBody', label),
                        confirmWord: t('settings.backup.clearCache.confirmWord'),
                        onConfirm: () => {
                          try { localStorage.removeItem('cellhub_' + key); } catch {}
                          toast(t('settings.backup.clearCache.cleared', label), 'success');
                        },
                      })}>
                      🗑️ {label}
                    </button>
                  ))}
                </div>
                <div style={{ padding: '0.5rem 0.75rem', background: 'rgba(239,68,68,0.08)', borderRadius: '0.375rem', fontSize: '0.75rem', color: '#fca5a5' }}>
                  ⚠️ {t('settings.backup.clearCache.exportFirst')}
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
                      {t('settings.backup.dangerZone.title')}
                    </h3>
                    <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: '0.2rem 0 0' }}>
                      {t('settings.backup.dangerZone.desc')}
                    </p>
                  </div>
                </div>
                {/* FIX: replaced confirm()/alert()/prompt() with requireConfirm modal */}
                <button
                  onClick={() => requireConfirm({
                    title: t('settings.backup.dangerZone.confirmTitle'),
                    body: t('settings.backup.dangerZone.confirmBody'),
                    confirmWord: t('settings.backup.dangerZone.confirmWord'),
                    onConfirm: () => {
                      const keys = Object.keys(localStorage).filter(k => k.startsWith('cellhub_'));
                      keys.forEach(k => localStorage.removeItem(k));
                      ['customer_returns','vendor_returns','sharedFolderPath','lang','cellhub_lang'].forEach(k => {
                        try { localStorage.removeItem(k); } catch {}
                      });
                      toast(t('settings.backup.dangerZone.deleted'), 'success');
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
                  {t('settings.backup.dangerZone.button')}
                </button>
                <div style={{ marginTop: '0.5rem', fontSize: '0.72rem', color: '#7f1d1d', textAlign: 'center' }}>
                  {t('settings.backup.dangerZone.exportFirst')}
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
                  {t('settings.confirm.typeToConfirm', confirmModal.confirmWord)}
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
                {t('settings.confirm.cancel')}
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
                {t('settings.confirm.confirm')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* r-new-7: Cloud sync enable — check config, open wizard if missing */}
      {cloudToggleTarget === 'on' && (
        <ConfirmDialog
          open
          title={t('settings.cloudSync.enableTitle')}
          message={t('settings.cloudSync.enableMessage')}
          variant="warning"
          confirmLabel={t('settings.cloudSync.continue')}
          cancelLabel={t('settings.confirm.cancel')}
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
          title={t('settings.cloudSync.disableTitle')}
          message={t('settings.cloudSync.disableMessage')}
          variant="warning"
          confirmLabel={t('settings.cloudSync.disable')}
          cancelLabel={t('settings.confirm.cancel')}
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
          title={t('settings.cloudSync.restartTitle')}
          message={showRestartPrompt === 'enabled' ? t('settings.cloudSync.restartEnabled') : t('settings.cloudSync.restartDisabled')}
          variant="default"
          confirmLabel="OK"
          cancelLabel={t('settings.cloudSync.close')}
          onConfirm={() => setShowRestartPrompt(null)}
          onCancel={() => setShowRestartPrompt(null)}
        />
      )}

      {/* R-IMPORT-LEGACY-ADAPTER: post-import breakdown + warnings modal.
          Renders only when a legacy backup was normalized AND had warnings
          — the reload is deferred until this modal closes. */}
      {importResultModal && (
        <Modal
          open={true}
          onClose={() => {
            setImportResultModal(null);
            window.location.reload();
          }}
          title={t('settings.import.complete')}
          size="max-w-2xl"
        >
          <div className="space-y-4 text-sm">
            <div>
              <h3 className="font-semibold text-white mb-2">
                {t('settings.import.collectionsNormalized')}
              </h3>
              <ul className="space-y-1 text-slate-300">
                {Object.entries(importResultModal.stats).map(([key, s]) => (
                  <li key={key}>
                    <strong className="text-slate-100">{key}:</strong>{' '}
                    {s.total} ({s.converted} {t('settings.import.converted')},{' '}
                    {s.passthrough} {t('settings.import.passthrough')})
                  </li>
                ))}
              </ul>
            </div>

            {importResultModal.warnings.length > 0 && (
              <div>
                <h3 className="font-semibold text-amber-300 mb-2">
                  ⚠️ {t('settings.import.warnings')} ({importResultModal.warnings.length})
                </h3>
                <ul className="space-y-1 text-amber-200 text-xs max-h-48 overflow-y-auto">
                  {importResultModal.warnings.map((w, i) => (
                    <li key={i}>• {w}</li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-xs text-slate-400 pt-2 border-t border-white/10">
              {t('settings.import.closeReloads')}
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
