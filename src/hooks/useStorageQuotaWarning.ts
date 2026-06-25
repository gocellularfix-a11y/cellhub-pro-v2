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

// R-STORAGE-WARNING-FIX: real Chromium/Electron localStorage per-origin cap
// (~10MB = 5M UTF-16 code units × 2 bytes). getStorageUsage() divides measured
// bytes by a legacy 5MB heuristic, which under-counts the cap ~2x and produced
// false-positive "almost full" banners on healthy stores. We recompute percent
// against the real cap and only warn when usage is genuinely high.
const REAL_LIMIT_KB = 10 * 1024; // 10,240 KB

/**
 * Pure severity classification (deterministic):
 *   < 90      → 'ok'
 *   [90, 95)  → 'warn'
 *   >= 95     → 'critical'
 * Non-finite input is treated as 'ok' (fail-safe — never warn on bad data).
 */
export function classifyStorageUsage(percent: number): StorageUsageLevel {
  if (!Number.isFinite(percent)) return 'ok';
  if (percent >= 95) return 'critical';
  if (percent >= 90) return 'warn';
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
        const { usedKB } = getStorageUsage();
        // Reliability guard: if usage is unmeasurable or empty, do NOT warn.
        if (!Number.isFinite(usedKB) || usedKB <= 0) {
          setLevel('ok');
          return;
        }
        // Recompute percent against the real cap (ignore getStorageUsage's
        // legacy 5MB denominator that caused false positives).
        const percent = (usedKB / REAL_LIMIT_KB) * 100;
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
