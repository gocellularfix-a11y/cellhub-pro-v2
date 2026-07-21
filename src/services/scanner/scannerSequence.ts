// ============================================================
// GSCAN-1 — pure scanner sequence classifier + normalization.
//
// Extracted VERBATIM-in-behavior from useBarcodeScanner so the timing
// contract is a pure, node-testable state machine with named thresholds.
// The hook stays a thin DOM adapter (focus guards + routing); no React,
// no DOM, no inventory logic here.
//
// A keyboard-wedge scanner types a whole code with tiny inter-key gaps and
// terminates with Enter (or silence). The tracker accumulates printable
// keys, resets on human-speed gaps, and reports on flush whether the FULL
// sequence (terminator included) was scanner-fast — the signal the hook
// uses to route plain UPC/SKU codes even while an input has focus.
// ============================================================

// ── Named thresholds (single source; covered by tests) ──────
/** Minimum characters for a buffered sequence to be a real scan. */
export const SCANNER_MIN_LENGTH = 4;
/** Max ms between keystrokes to still look like a scanner. */
export const SCANNER_MAX_INTERKEY_MS = 80;
/** Silence after which a scanner without an Enter suffix auto-flushes. */
export const SCANNER_AUTOFLUSH_MS = 200;

/** Strip control characters and trim accidental whitespace. NEVER numeric
 *  coercion — leading zeros and full length are always preserved and the
 *  code stays a string ('001234567890' stays exactly that). */
export function normalizeScannedCode(raw: string): string {
  // Explicit charCode filter (no regex): drop ASCII control chars 0-31 + DEL.
  let out = '';
  for (const ch of String(raw ?? '')) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c === 127) continue;
    out += ch;
  }
  return out.trim();
}

export interface ScanFlush {
  code: string;
  /** True when the WHOLE sequence was scanner-grade: every inter-key gap
   *  AND the terminator gap within SCANNER_MAX_INTERKEY_MS. (Buffered runs
   *  are fast by construction — a slow gap resets the buffer — so the
   *  terminator gap is the deciding signal.) */
  scannerFast: boolean;
}

export interface ScannerSequenceTracker {
  /** Feed one printable character keydown. */
  feedChar(char: string, now: number): void;
  /** Note a non-printable/modifier keydown (updates gap timing only —
   *  mirrors the historical listener, which stamped every keydown). */
  noteKey(now: number): void;
  /** Enter pressed: flush. Null when the buffer is below SCANNER_MIN_LENGTH. */
  flushEnter(now: number): ScanFlush | null;
  /** Auto-flush after silence (scanner without Enter suffix). */
  flushTimeout(): ScanFlush | null;
  /** Clear all state (route completion, unmount). */
  reset(): void;
  /** Current buffered length (diagnostics/tests). */
  size(): number;
}

export function createScannerSequenceTracker(
  opts?: { minLength?: number; maxInterkeyMs?: number },
): ScannerSequenceTracker {
  const minLength = opts?.minLength ?? SCANNER_MIN_LENGTH;
  const maxInterkey = opts?.maxInterkeyMs ?? SCANNER_MAX_INTERKEY_MS;

  let buffer = '';
  let lastEventAt = 0;
  let lastGap = Number.POSITIVE_INFINITY;

  const gapSince = (now: number): number => (lastEventAt === 0 ? Number.POSITIVE_INFINITY : now - lastEventAt);

  return {
    feedChar(char: string, now: number): void {
      const gap = gapSince(now);
      lastGap = gap;
      lastEventAt = now;
      // Human-speed gap → whatever was buffered was typing, not a scan.
      if (gap > maxInterkey && buffer.length > 0) buffer = '';
      buffer += char;
    },
    noteKey(now: number): void {
      lastGap = gapSince(now);
      lastEventAt = now;
    },
    flushEnter(now: number): ScanFlush | null {
      const enterGap = gapSince(now);
      lastGap = enterGap;
      lastEventAt = now;
      const code = normalizeScannedCode(buffer);
      buffer = '';
      if (code.length < minLength) return null;
      return { code, scannerFast: enterGap <= maxInterkey };
    },
    flushTimeout(): ScanFlush | null {
      const code = normalizeScannedCode(buffer);
      buffer = '';
      if (code.length < minLength) return null;
      // Historical contract: the auto-flush only counts when the final
      // inter-key gap was scanner-fast.
      return { code, scannerFast: lastGap <= maxInterkey };
    },
    reset(): void {
      buffer = '';
      lastEventAt = 0;
      lastGap = Number.POSITIVE_INFINITY;
    },
    size(): number {
      return buffer.length;
    },
  };
}
