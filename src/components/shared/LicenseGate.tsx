// ============================================================
// CellHub Pro — License Gate (Electron only)
// In browser mode: passes through immediately, no checks
// ============================================================

import { useState, useEffect, type ReactNode } from 'react';
import { isElectron, getElectronAPI } from '@/utils/platform';

interface LicenseGateProps {
  children: ReactNode;
}

export default function LicenseGate({ children }: LicenseGateProps) {
  // Browser mode — skip license entirely, render children immediately
  if (!isElectron()) {
    return <>{children}</>;
  }

  // Electron mode — check license
  return <ElectronLicenseCheck>{children}</ElectronLicenseCheck>;
}

/** Only rendered inside Electron */
function ElectronLicenseCheck({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<'checking' | 'valid' | 'invalid'>('checking');
  const [activationKey, setActivationKey] = useState('');
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState('');
  const [daysRemaining, setDaysRemaining] = useState<number | null>(null);
  const [tier, setTier] = useState('');

  useEffect(() => {
    checkLicense();
  }, []);

  const checkLicense = async () => {
    try {
      const api = getElectronAPI()!;
      const result = await api.checkLicense() as any;
      setTier(result.tier || '');
      setDaysRemaining(result.daysRemaining ?? null);
      if (result.graceDaysRemaining != null) setDaysRemaining(result.graceDaysRemaining);
      setStatus(result.valid ? 'valid' : 'invalid');
    } catch (err) {
      // r27 B1: fail CLOSED. Previous behavior was fail-open which let any
      // tampered Electron build bypass licensing entirely. If the IPC bridge
      // is broken, surface the error and force activation screen.
      console.error('[LicenseGate] checkLicense failed:', err);
      setError('License check failed. Please reinstall or contact support.');
      setStatus('invalid');
    }
  };

  const handleActivate = async () => {
    if (!activationKey.trim()) return;
    setActivating(true);
    setError('');
    try {
      const api = getElectronAPI()!;
      const result = await api.activateLicense(activationKey.trim()) as any;
      if (result.success) {
        await checkLicense();
      } else {
        setError(result.error || 'Invalid license key');
      }
    } catch (err) {
      setError(String(err));
    }
    setActivating(false);
  };

  if (status === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-900">
        <div className="spinner" />
      </div>
    );
  }

  if (status === 'valid') {
    return (
      <>
        {tier === 'trial' && daysRemaining !== null && daysRemaining <= 7 && (
          <div className="fixed top-0 left-0 right-0 z-[200] bg-amber-600/90 text-white text-center py-1.5 text-xs font-medium">
            ⏳ Trial: {daysRemaining} day{daysRemaining !== 1 ? 's' : ''} remaining
          </div>
        )}
        {tier === 'grace' && daysRemaining !== null && (
          <div className="fixed top-0 left-0 right-0 z-[200] bg-red-600/90 text-white text-center py-1.5 text-xs font-medium">
            ⚠️ License machine mismatch — {daysRemaining} day{daysRemaining !== 1 ? 's' : ''} to reactivate
          </div>
        )}
        {children}
      </>
    );
  }

  // Invalid — activation screen
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-900 p-4">
      <div className="glass-card p-8 w-full max-w-md text-center">
        <div className="text-5xl mb-4">🔐</div>
        <h1 className="text-2xl font-bold bg-gradient-to-r from-brand-500 to-accent-500 bg-clip-text text-transparent mb-2">
          CellHub Pro
        </h1>
        <p className="text-slate-400 mb-6">Enter your license key to continue.</p>
        <input
          type="text"
          value={activationKey}
          onChange={(e) => { setActivationKey(e.target.value.toUpperCase()); setError(''); }}
          placeholder="CHPRO-P-00000000-XXXXXXXX-XXXXXXXX"
          className="input text-center tracking-wider font-mono mb-3"
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && handleActivate()}
        />
        {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
        <button onClick={handleActivate} disabled={!activationKey.trim() || activating} className="btn btn-primary w-full">
          {activating ? 'Activating…' : 'Activate License'}
        </button>
      </div>
    </div>
  );
}
