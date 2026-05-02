// ============================================================
// CellHub Pro — License Gate (Electron only)
// In browser mode: passes through immediately, no checks.
// LicenseProvider is mounted in both modes so downstream
// useLicense() consumers always have a context to read.
// ============================================================

import { useState, type ReactNode } from 'react';
import { isElectron, getElectronAPI } from '@/utils/platform';
import { LicenseProvider, useLicense } from '@/contexts/LicenseContext';

interface LicenseGateProps {
  children: ReactNode;
}

export default function LicenseGate({ children }: LicenseGateProps) {
  return (
    <LicenseProvider>
      {isElectron() ? <ElectronLicenseCheck>{children}</ElectronLicenseCheck> : children}
    </LicenseProvider>
  );
}

/** Only rendered inside Electron */
function ElectronLicenseCheck({ children }: { children: ReactNode }) {
  const { tier, valid, daysRemaining, loading, refresh } = useLicense();
  const [activationKey, setActivationKey] = useState('');
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState('');

  const handleActivate = async () => {
    if (!activationKey.trim()) return;
    setActivating(true);
    setError('');
    try {
      const api = getElectronAPI()!;
      const result = (await api.activateLicense(activationKey.trim())) as {
        success: boolean;
        error?: string;
      };
      if (result.success) {
        await refresh();
      } else {
        setError(result.error || 'Invalid license key');
      }
    } catch (err) {
      setError(String(err));
    }
    setActivating(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-900">
        <div className="spinner" />
      </div>
    );
  }

  if (valid) {
    return (
      <>
        {tier === 'trial' && daysRemaining !== null && daysRemaining <= 7 && (
          <div className="fixed top-0 left-0 right-0 z-[200] bg-amber-600/90 text-white text-center py-1.5 text-xs font-medium">
            ⏳ Trial: {daysRemaining} day{daysRemaining !== 1 ? 's' : ''} remaining
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
