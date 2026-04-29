// ============================================================
// CellHub Pro — Setup Wizard
// Shown on first launch. Firebase is OPTIONAL — the store
// works 100% offline without it.
//
// Steps: Welcome → Store Info → Admin PIN → First Employee →
//        Cloud Sync (optional) → Done
// ============================================================

import { useState } from 'react';
import { persistSettings, saveRecord, setFirestoreInstance } from '@/services/persist';
import { saveFirebaseConfig, initFirebase } from '@/config/firebase';
import { generateId } from '@/utils/dates';
import { COLLECTIONS } from '@/config/constants';
import { hashPin, isWeakPin } from '@/utils/pinHash';
import { DEFAULT_PAYMENT_PORTALS } from '@/config/paymentPortals';
import type { Employee, FirebaseConfig } from '@/store/types';

interface SetupWizardProps {
  onComplete: () => void;
}

const STEPS = ['Welcome', 'Store Info', 'Admin PIN', 'First Employee', 'Cloud Sync', 'Done'];
const TOTAL = STEPS.length;

export default function SetupWizard({ onComplete }: SetupWizardProps) {
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Step 1 — Store Info
  const [store, setStore] = useState({
    storeName: '',
    storeAddress: '',
    storeCity: '',
    storeState: '',
    storeZip: '',
    storePhone: '',
    storeEmail: '',
    storeWebsite: '',
    taxRate: '9.25',
    currency: 'USD',
    locale: 'en-US',
    timezone: 'America/Los_Angeles',
  });

  // Step 2 — Admin PIN
  const [adminPin, setAdminPin] = useState('');
  const [adminPinConfirm, setAdminPinConfirm] = useState('');

  // Step 3 — First Employee
  const [emp, setEmp] = useState({ name: '', pin: '' });

  // Step 4 — Cloud Sync (Firebase, optional)
  const [fb, setFb] = useState<FirebaseConfig>({
    apiKey: '', authDomain: '', projectId: '',
    storageBucket: '', messagingSenderId: '', appId: '',
  });
  const [testingFb, setTestingFb] = useState(false);
  const [fbConnected, setFbConnected] = useState(false);
  const [skipCloud, setSkipCloud] = useState(false);

  const next = () => { setError(''); setStep((s) => s + 1); };
  const back = () => { setError(''); setStep((s) => s - 1); };

  // ── Validators ────────────────────────────────────────────

  const validateStoreInfo = () => {
    if (!store.storeName.trim()) { setError('Store name is required'); return false; }
    if (!store.storeCity.trim()) { setError('City is required'); return false; }
    if (!store.storeState.trim() || store.storeState.trim().length !== 2) { setError('State must be a 2-letter abbreviation (e.g. CA)'); return false; }
    if (!store.storeZip.trim() || store.storeZip.trim().length !== 5) { setError('ZIP code must be 5 digits'); return false; }
    const tax = parseFloat(store.taxRate);
    if (isNaN(tax) || tax < 0 || tax > 30) { setError('Tax rate must be between 0 and 30%'); return false; }
    return true;
  };

  // r-settings-2a: WEAK_PINS migrated to src/utils/pinHash.ts as a shared utility.
  // SetupWizard uses strict-block (rejects save). Settings AdminPinField uses
  // soft-warn (visual notice but allows save) — different UX for different contexts.
  const validatePin = () => {
    if (adminPin.length < 4) { setError('PIN must be at least 4 digits'); return false; }
    if (!/^\d+$/.test(adminPin)) { setError('PIN must be numbers only'); return false; }
    if (adminPin !== adminPinConfirm) { setError('PINs do not match'); return false; }
    if (isWeakPin(adminPin)) { setError('PIN is too common. Choose something less guessable.'); return false; }
    return true;
  };

  const validateEmployee = () => {
    if (!emp.name.trim()) { setError('Owner name is required'); return false; }
    if (emp.pin.length < 4) { setError('Employee PIN must be at least 4 digits'); return false; }
    if (!/^\d+$/.test(emp.pin)) { setError('PIN must be numbers only'); return false; }
    return true;
  };

  const handleTestFirebase = async () => {
    if (!fb.apiKey.trim() || !fb.projectId.trim()) {
      setError('API Key and Project ID are required to test connection');
      return;
    }
    setTestingFb(true);
    setError('');
    try {
      saveFirebaseConfig(fb);
      const db = initFirebase();
      if (db) {
        setFirestoreInstance(db);
        setFbConnected(true);
        setError('');
      } else {
        setError('Could not connect. Check your Firebase config and try again.');
      }
    } catch (err) {
      setError(`Connection failed: ${String(err)}`);
    } finally {
      setTestingFb(false);
    }
  };

  // ── Save everything and finish ────────────────────────────

  const handleFinish = async () => {
    setSaving(true);
    setError('');
    try {
      // r27 B4: hash both PINs before any persist call. The wizard never
      // writes plaintext credentials to Firestore or localStorage.
      const hashedAdminPin = await hashPin(adminPin);
      const hashedEmpPin = await hashPin(emp.pin);

      const settingsData = {
        storeName: store.storeName.trim(),
        storeAddress: store.storeAddress.trim(),
        storeCity: store.storeCity.trim(),
        storeState: store.storeState.trim(),
        storeZip: store.storeZip.trim(),
        storePhone: store.storePhone.trim(),
        storeEmail: store.storeEmail.trim(),
        storeWebsite: store.storeWebsite.trim(),
        taxRate: parseFloat(store.taxRate) / 100,
        currency: store.currency,
        locale: store.locale,
        timezone: store.timezone,
        adminPin: hashedAdminPin,
        customerNumberPrefix: store.storeName.trim().slice(0, 2).toUpperCase() || 'CH',
        invoicePrefix: 'INV',
        loyaltyEnabled: true,
        loyaltyRate: 1,
        lowStockThreshold: 2,
        cbeFeeEnabled: false,
        cbeFeeRate: 0.015,
        cbeFeeMax: 15,
        screenFeeAmount: 0.5,
        defaultCommissionRate: 0.07,
        creditCardFee: 300,
        // r-settings-2a F-02: seed paymentPortals defaults so multi-station
        // deploys have consistent portal config from day 1 (instead of falling
        // back to DEFAULT_PAYMENT_PORTALS only on the first station that opens
        // PhonePaymentModal). phoneCarriers intentionally NOT seeded — owners
        // add their own to match their actual carrier mix.
        paymentPortals: DEFAULT_PAYMENT_PORTALS,
        paperSize: '4x6',
        receiptFooter: 'Thank you for your business!',
        warrantyText: '30-day warranty on parts and labor',
        returnPolicy: '30-day return policy on new items',
        cloudSyncEnabled: fbConnected,
      };

      await persistSettings(settingsData);

      const firstEmp: Employee = {
        id: generateId(),
        name: emp.name.trim(),
        role: 'owner',
        pin: hashedEmpPin,
        commissionRate: 0,
        active: true,
        clockLog: [],
        onboardingSigned: false,
        startDate: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      await saveRecord(COLLECTIONS.employees, firstEmp.id, firstEmp as unknown as Record<string, unknown>);

      localStorage.setItem('cellhub_setup_complete', '1');
      onComplete();
    } catch (err) {
      setError(`Setup failed: ${String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleNext = async () => {
    setError('');
    if (step === 1 && !validateStoreInfo()) return;
    if (step === 2 && !validatePin()) return;
    if (step === 3) {
      if (!validateEmployee()) return;
      next();
      return;
    }
    // Step 4 — Cloud Sync: always allow continuing (Firebase is optional)
    if (step === 4) {
      await handleFinish();
      return;
    }
    if (step === TOTAL - 1) {
      onComplete();
      return;
    }
    next();
  };

  const progress = Math.round((step / (TOTAL - 1)) * 100);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a', padding: '1rem' }}>
      <div style={{ width: '100%', maxWidth: '520px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '1rem', padding: '2rem' }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, background: 'linear-gradient(135deg,#667eea,#22d3ee)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: '0.25rem' }}>
            CellHub Pro
          </h1>
          <p style={{ color: '#64748b', fontSize: '0.82rem' }}>Step {step + 1} of {TOTAL} — {STEPS[step]}</p>
        </div>

        {/* Progress */}
        <div style={{ height: '4px', background: 'rgba(255,255,255,0.08)', borderRadius: '2px', marginBottom: '1.75rem', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${progress}%`, background: 'linear-gradient(90deg,#667eea,#22d3ee)', borderRadius: '2px', transition: 'width 0.4s ease' }} />
        </div>

        {/* Steps */}
        {step === 0 && <StepWelcome />}
        {step === 1 && <StepStoreInfo store={store} setStore={setStore} />}
        {step === 2 && <StepAdminPin pin={adminPin} setPin={setAdminPin} confirm={adminPinConfirm} setConfirm={setAdminPinConfirm} />}
        {step === 3 && <StepFirstEmployee emp={emp} setEmp={setEmp} />}
        {step === 4 && (
          <StepCloudSync
            fb={fb} setFb={setFb}
            testing={testingFb} connected={fbConnected}
            onTest={handleTestFirebase}
            skip={skipCloud} setSkip={setSkipCloud}
          />
        )}
        {step === 5 && <StepDone storeName={store.storeName} empName={emp.name} cloudEnabled={fbConnected} />}

        {/* Error */}
        {error && (
          <div style={{ marginTop: '1rem', padding: '0.6rem 0.875rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '0.5rem', fontSize: '0.82rem', color: '#f87171' }}>
            ⚠ {error}
          </div>
        )}

        {/* Navigation */}
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
          {step > 0 && step < TOTAL - 1 && (
            <button onClick={back} style={{ flex: 1, padding: '0.7rem', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '0.5rem', color: '#94a3b8', cursor: 'pointer', fontSize: '0.9rem' }}>
              ← Back
            </button>
          )}
          <button
            onClick={handleNext}
            disabled={saving || testingFb}
            style={{ flex: 2, padding: '0.7rem', background: 'linear-gradient(135deg,#667eea,#22d3ee)', border: 'none', borderRadius: '0.5rem', color: '#fff', cursor: (saving || testingFb) ? 'wait' : 'pointer', fontSize: '0.9rem', fontWeight: 700, opacity: (saving || testingFb) ? 0.7 : 1 }}
          >
            {saving ? 'Saving…' : step === TOTAL - 1 ? '🚀 Launch CellHub Pro' : step === 4 ? (fbConnected ? '☁️ Continue with Cloud' : '➜ Continue without Cloud') : step === 3 ? '→ Cloud Sync Setup' : 'Continue →'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Step components ───────────────────────────────────────

function StepWelcome() {
  return (
    <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
      <div style={{ fontSize: '3.5rem', marginBottom: '1rem' }}>🛠️</div>
      <h2 style={{ color: '#fff', fontSize: '1.2rem', fontWeight: 700, marginBottom: '0.5rem' }}>Welcome to CellHub Pro</h2>
      <p style={{ color: '#64748b', fontSize: '0.85rem', lineHeight: 1.75, marginBottom: '1.25rem' }}>
        Let's set up your store. Takes about 2 minutes.
      </p>
      <div style={{ textAlign: 'left', background: 'rgba(255,255,255,0.04)', borderRadius: '0.625rem', padding: '0.875rem 1rem' }}>
        {[
          ['🏪', 'Your store name and contact info'],
          ['🔐', 'An admin PIN to protect reports and settings'],
          ['👤', 'Your name as the first owner'],
          ['☁️', 'Optional: Firebase for cloud sync across devices'],
        ].map(([icon, text]) => (
          <div key={text as string} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.4rem 0', color: '#94a3b8', fontSize: '0.84rem' }}>
            <span style={{ fontSize: '1rem', flexShrink: 0 }}>{icon as string}</span>
            <span>{text as string}</span>
          </div>
        ))}
      </div>
      <p style={{ color: '#475569', fontSize: '0.75rem', marginTop: '1rem' }}>
        Everything can be changed later in Settings.
      </p>
    </div>
  );
}

function StepStoreInfo({ store, setStore }: { store: any; setStore: any }) {
  const upd = (k: string, v: string) => setStore((p: any) => ({ ...p, [k]: v }));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
      <h2 style={{ color: '#fff', fontSize: '1.05rem', fontWeight: 700, margin: '0 0 0.25rem' }}>🏪 Store Information</h2>
      <Field label="Store Name *" value={store.storeName} onChange={(v) => upd('storeName', v)} placeholder="e.g. Quick Fix Mobile" />
      <Field label="Address" value={store.storeAddress} onChange={(v) => upd('storeAddress', v)} placeholder="123 Main St" />
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '0.75rem' }}>
        <Field label="City *" value={store.storeCity} onChange={(v) => upd('storeCity', v)} placeholder="Santa Barbara" />
        <Field label="State *" value={store.storeState} onChange={(v) => upd('storeState', v.toUpperCase().slice(0, 2))} placeholder="CA" />
        <Field label="ZIP *" value={store.storeZip} onChange={(v) => upd('storeZip', v.replace(/\D/g, '').slice(0, 5))} placeholder="93101" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
        <Field label="Phone" value={store.storePhone} onChange={(v) => upd('storePhone', v)} placeholder="(555) 555-5555" />
        <Field label="Email" value={store.storeEmail} onChange={(v) => upd('storeEmail', v)} placeholder="store@email.com" type="email" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
        <Field label="Website (optional)" value={store.storeWebsite} onChange={(v) => upd('storeWebsite', v)} placeholder="yourstore.com" />
        <Field label="Sales Tax Rate (%)" value={store.taxRate} onChange={(v) => upd('taxRate', v)} placeholder="9.25" type="number" />
      </div>
    </div>
  );
}

function StepAdminPin({ pin, setPin, confirm, setConfirm }: { pin: string; setPin: (v: string) => void; confirm: string; setConfirm: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <h2 style={{ color: '#fff', fontSize: '1.05rem', fontWeight: 700, margin: '0 0 0.1rem' }}>🔐 Admin PIN</h2>
      <p style={{ color: '#64748b', fontSize: '0.82rem', lineHeight: 1.6, margin: 0 }}>
        Protects reports, settings, tax data, and employee management. Only share with owners and managers.
      </p>
      <Field label="Admin PIN (4+ digits)" value={pin} onChange={(v) => setPin(v.replace(/\D/g, '').slice(0, 8))} placeholder="Choose a PIN" type="password" mono />
      <Field label="Confirm PIN" value={confirm} onChange={(v) => setConfirm(v.replace(/\D/g, '').slice(0, 8))} placeholder="Re-enter PIN" type="password" mono />
    </div>
  );
}

function StepFirstEmployee({ emp, setEmp }: { emp: any; setEmp: any }) {
  const upd = (k: string, v: string) => setEmp((p: any) => ({ ...p, [k]: v }));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <h2 style={{ color: '#fff', fontSize: '1.05rem', fontWeight: 700, margin: '0 0 0.1rem' }}>👤 Owner Account</h2>
      <p style={{ color: '#64748b', fontSize: '0.82rem', lineHeight: 1.6, margin: 0 }}>
        Create your owner account. Use this PIN to clock in and process sales.
      </p>
      <Field label="Your Full Name *" value={emp.name} onChange={(v) => upd('name', v)} placeholder="e.g. Maria Garcia" />
      <Field label="Your Employee PIN (4+ digits)" value={emp.pin} onChange={(v) => upd('pin', v.replace(/\D/g, '').slice(0, 6))} placeholder="Choose a PIN" type="password" mono />
      <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(102,126,234,0.08)', border: '1px solid rgba(102,126,234,0.2)', borderRadius: '0.5rem', fontSize: '0.75rem', color: '#94a3b8' }}>
        💡 Your employee PIN is different from the Admin PIN. Use it to clock in and start a shift.
      </div>
    </div>
  );
}

function StepCloudSync({ fb, setFb, testing, connected, onTest, skip, setSkip }: {
  fb: FirebaseConfig; setFb: any; testing: boolean; connected: boolean;
  onTest: () => void; skip: boolean; setSkip: (v: boolean) => void;
}) {
  const upd = (k: keyof FirebaseConfig, v: string) => setFb((p: FirebaseConfig) => ({ ...p, [k]: v }));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
      <h2 style={{ color: '#fff', fontSize: '1.05rem', fontWeight: 700, margin: '0 0 0.1rem' }}>
        ☁️ Cloud Sync <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 400, marginLeft: '0.5rem' }}>Optional</span>
      </h2>

      {/* Skip option — prominent */}
      <div
        onClick={() => setSkip(!skip)}
        style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem', background: skip ? 'rgba(34,197,94,0.08)' : 'rgba(255,255,255,0.04)', border: `1px solid ${skip ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.1)'}`, borderRadius: '0.625rem', cursor: 'pointer' }}
      >
        <div style={{ width: '18px', height: '18px', borderRadius: '50%', border: `2px solid ${skip ? '#22c55e' : '#475569'}`, background: skip ? '#22c55e' : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {skip && <span style={{ color: '#fff', fontSize: '10px', fontWeight: 700 }}>✓</span>}
        </div>
        <div>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#e2e8f0' }}>
            Use locally only — no cloud needed
          </div>
          <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.1rem' }}>
            Data stays on this device. Works great for single-terminal stores.
          </div>
        </div>
      </div>

      {!skip && (
        <>
          <p style={{ color: '#64748b', fontSize: '0.78rem', lineHeight: 1.6, margin: 0 }}>
            Connect Firebase to sync data across multiple devices and get automatic cloud backups.
            Create a free project at{' '}
            <a href="https://firebase.google.com" target="_blank" rel="noreferrer" style={{ color: '#667eea' }}>firebase.google.com</a>
            {' '}→ Project Settings → Web App.
          </p>
          <Field label="API Key" value={fb.apiKey} onChange={(v) => upd('apiKey', v)} placeholder="AIzaSy..." mono />
          <Field label="Project ID" value={fb.projectId} onChange={(v) => upd('projectId', v)} placeholder="my-store-xxxxx" mono />
          <Field label="Auth Domain" value={fb.authDomain} onChange={(v) => upd('authDomain', v)} placeholder="my-store.firebaseapp.com" mono />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <Field label="Storage Bucket" value={fb.storageBucket} onChange={(v) => upd('storageBucket', v)} placeholder="my-store.appspot.com" mono />
            <Field label="Messaging Sender ID" value={fb.messagingSenderId} onChange={(v) => upd('messagingSenderId', v)} placeholder="123456789" mono />
          </div>
          <Field label="App ID" value={fb.appId} onChange={(v) => upd('appId', v)} placeholder="1:123:web:abc" mono />
          <button
            onClick={onTest}
            disabled={testing || connected}
            style={{ padding: '0.6rem', background: connected ? 'rgba(34,197,94,0.15)' : 'rgba(102,126,234,0.15)', border: `1px solid ${connected ? 'rgba(34,197,94,0.4)' : 'rgba(102,126,234,0.4)'}`, borderRadius: '0.5rem', color: connected ? '#34d399' : '#a5b4fc', cursor: (testing || connected) ? 'default' : 'pointer', fontSize: '0.85rem', fontWeight: 600 }}
          >
            {testing ? '⏳ Testing connection…' : connected ? '✅ Connected to Firebase!' : '🔗 Test Connection'}
          </button>
        </>
      )}
    </div>
  );
}

function StepDone({ storeName, empName, cloudEnabled }: { storeName: string; empName: string; cloudEnabled: boolean }) {
  return (
    <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
      <div style={{ fontSize: '3.5rem', marginBottom: '1rem' }}>🎉</div>
      <h2 style={{ color: '#fff', fontSize: '1.2rem', fontWeight: 700, marginBottom: '0.5rem' }}>
        {storeName ? `${storeName} is ready!` : 'Setup complete!'}
      </h2>
      <p style={{ color: '#64748b', fontSize: '0.85rem', lineHeight: 1.7, marginBottom: '1.25rem' }}>
        {empName ? `Welcome, ${empName.split(' ')[0]}!` : 'Welcome!'} Your store is all set.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', textAlign: 'left', background: 'rgba(255,255,255,0.04)', borderRadius: '0.625rem', padding: '0.875rem 1rem' }}>
        {[
          ['✅', 'Store info saved'],
          ['✅', 'Admin PIN set'],
          ['✅', 'Owner account created'],
          [cloudEnabled ? '☁️' : '💾', cloudEnabled ? 'Cloud sync enabled' : 'Running locally (no cloud)'],
        ].map(([icon, text]) => (
          <div key={text as string} style={{ display: 'flex', gap: '0.5rem', color: '#94a3b8', fontSize: '0.84rem' }}>
            <span>{icon as string}</span><span>{text as string}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text', mono = false }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; mono?: boolean;
}) {
  return (
    <div>
      <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.3rem', fontWeight: 600 }}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ width: '100%', padding: '0.6rem 0.75rem', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '0.5rem', color: '#e2e8f0', fontSize: '0.875rem', outline: 'none', boxSizing: 'border-box', fontFamily: mono ? 'monospace' : 'inherit' }}
      />
    </div>
  );
}
