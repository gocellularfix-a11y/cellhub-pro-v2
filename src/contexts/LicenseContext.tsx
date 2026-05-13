// ============================================================
// CellHub Pro — License Context (R-LICENSE-GATES)
// Source of truth for tier-based feature gates in the renderer.
// IPC roundtrip happens here once on mount; downstream consumers
// read state via useLicense().
//
// Browser mode: bypass — features all true (dev convenience).
// Electron + IPC failure: fail-closed — features all false,
// maxProducts capped at 50 (matches tier 'none' in license.js).
// ============================================================

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import { isElectron, getElectronAPI } from '@/utils/platform';

// ── Types ─────────────────────────────────────────────────

export interface LicenseFeatures {
  reports: boolean;
  multiStore: boolean;
  aiAssistant: boolean;
  /** -1 = unlimited; finite number = hard cap on inventory.length */
  maxProducts: number;
}

export type LicenseTier = 'none' | 'trial' | 'basic' | 'pro';

export interface LicenseState {
  tier: LicenseTier;
  valid: boolean;
  daysRemaining: number | null;
  features: LicenseFeatures;
  loading: boolean;
}

interface LicenseContextValue extends LicenseState {
  /** Re-runs the IPC license check (call after activate-license success). */
  refresh: () => Promise<void>;
}

// ── Defaults ──────────────────────────────────────────────

const FAIL_CLOSED_FEATURES: LicenseFeatures = {
  reports: false,
  multiStore: false,
  aiAssistant: false,
  maxProducts: 50,
};

const BROWSER_BYPASS_FEATURES: LicenseFeatures = {
  reports: true,
  multiStore: true,
  aiAssistant: true,
  maxProducts: -1,
};

const DEFAULT_STATE: LicenseState = {
  tier: 'none',
  valid: false,
  daysRemaining: null,
  features: FAIL_CLOSED_FEATURES,
  loading: true,
};

const VALID_TIERS: LicenseTier[] = ['none', 'trial', 'basic', 'pro'];

// ── Helpers ───────────────────────────────────────────────

function normalizeTier(raw: unknown): LicenseTier {
  return typeof raw === 'string' && (VALID_TIERS as string[]).includes(raw)
    ? (raw as LicenseTier)
    : 'none';
}

function normalizeFeatures(raw: unknown): LicenseFeatures {
  if (!raw || typeof raw !== 'object') return FAIL_CLOSED_FEATURES;
  const r = raw as Record<string, unknown>;
  const max = r.maxProducts;
  // electron/license.js uses Infinity for the pro tier; structured clone
  // preserves it but we canonicalize to -1 here so consumers can do a
  // single equality check.
  const maxProducts = typeof max === 'number' && isFinite(max) ? max : -1;
  return {
    reports: r.reports === true,
    multiStore: r.multiStore === true,
    aiAssistant: r.aiAssistant === true,
    maxProducts,
  };
}

// ── Context ───────────────────────────────────────────────

const LicenseContext = createContext<LicenseContextValue | null>(null);

export function LicenseProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LicenseState>(DEFAULT_STATE);

  const refresh = useCallback(async () => {
    if (!isElectron()) {
      setState({
        tier: 'pro',
        valid: true,
        daysRemaining: null,
        features: BROWSER_BYPASS_FEATURES,
        loading: false,
      });
      return;
    }

    try {
      const api = getElectronAPI()!;
      const result = (await api.checkLicense()) as {
        valid?: boolean;
        tier?: string;
        daysRemaining?: number | null;
        features?: unknown;
      };
      setState({
        tier: normalizeTier(result.tier),
        valid: !!result.valid,
        daysRemaining:
          typeof result.daysRemaining === 'number' ? result.daysRemaining : null,
        features: normalizeFeatures(result.features),
        loading: false,
      });
    } catch (err) {
      console.error('[LicenseProvider] checkLicense failed:', err);
      setState({
        tier: 'none',
        valid: false,
        daysRemaining: null,
        features: FAIL_CLOSED_FEATURES,
        loading: false,
      });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <LicenseContext.Provider value={{ ...state, refresh }}>
      {children}
    </LicenseContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────

export function useLicense(): LicenseContextValue {
  const ctx = useContext(LicenseContext);
  if (!ctx) throw new Error('useLicense must be used within <LicenseProvider>');
  return ctx;
}
