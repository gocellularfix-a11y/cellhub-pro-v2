// ============================================================
// R-PRODUCTION-B5.1: proactive localStorage quota warning.
//
// Read-only: reads the existing getStorageUsage() and classifies the percent
// into a severity level so the UI can warn the owner BEFORE localStorage fills
// up and saves start failing silently. It NEVER writes, NEVER blocks, and does
// NOT change any storage/persistence semantics.
// ============================================================

import { useEffect, useState } from 'react';
import { getStorageUsage } from '@/services/storage';

export type StorageUsageLevel = 'ok' | 'warn' | 'critical';

/**
 * Pure severity classification (deterministic):
 *   < 80      → 'ok'
 *   [80, 95)  → 'warn'
 *   >= 95     → 'critical'
 * Non-finite input is treated as 'ok' (fail-safe — never warn on bad data).
 */
export function classifyStorageUsage(percent: number): StorageUsageLevel {
  if (!Number.isFinite(percent)) return 'ok';
  if (percent >= 95) return 'critical';
  if (percent >= 80) return 'warn';
  return 'ok';
}

// Low-frequency re-check; storage usage changes slowly. Read-only.
const CHECK_INTERVAL_MS = 60_000;

/**
 * Returns the current storage-usage severity level. Checks on mount and on a
 * low-frequency interval. Read-only — no writes, no blocking, no side effects
 * beyond local component state.
 */
export function useStorageQuotaWarning(): StorageUsageLevel {
  const [level, setLevel] = useState<StorageUsageLevel>('ok');

  useEffect(() => {
    const check = () => {
      try {
        const { percent } = getStorageUsage();
        setLevel(classifyStorageUsage(percent));
      } catch {
        setLevel('ok');
      }
    };
    check();
    const id = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return level;
}
