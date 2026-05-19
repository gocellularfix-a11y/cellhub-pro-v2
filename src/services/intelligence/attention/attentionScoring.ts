// INTELLIGENCE-OPERATOR-ATTENTION-SYSTEM-V1
// Pure deterministic scoring helpers for operator attention pressure.
// No I/O, no randomization, no side effects.

// ── Thresholds ────────────────────────────────────────────────────────────────

const H1  =  1 * 3_600_000;
const H4  =  4 * 3_600_000;
const H24 = 24 * 3_600_000;
const H72 = 72 * 3_600_000;

// ── Escalation tier from age ──────────────────────────────────────────────────

/** Maps elapsed time to escalation level: 0 (fresh) → 3 (critical age). */
export function escalationFromAge(ageMs: number): 0 | 1 | 2 | 3 {
  if (ageMs >= H24) return 3;
  if (ageMs >= H4)  return 2;
  if (ageMs >= H1)  return 1;
  return 0;
}

// ── Component scorers ─────────────────────────────────────────────────────────

/**
 * 0 → 100 linear-piecewise age score.
 * 0–1h: 0–25  |  1–4h: 25–50  |  4–24h: 50–80  |  24h+: 80–100
 */
export function scoreAttentionAge(ageMs: number): number {
  if (ageMs <= 0) return 0;
  if (ageMs < H1)  return Math.round((ageMs / H1) * 25);
  if (ageMs < H4)  return Math.round(25 + ((ageMs - H1)  / (H4  - H1))  * 25);
  if (ageMs < H24) return Math.round(50 + ((ageMs - H4)  / (H24 - H4))  * 30);
  return Math.min(Math.round(80 + ((ageMs - H24) / (H72 - H24)) * 20), 100);
}

/** Clamps and returns base severity as-is (0–100). */
export function scoreAttentionSeverity(baseSeverity: number): number {
  return Math.min(Math.max(Math.round(baseSeverity), 0), 100);
}

/**
 * Additive escalation bonus (not a component percentage).
 * Level 0 → +0  |  1 → +10  |  2 → +25  |  3 → +40
 */
export function scoreAttentionEscalation(level: 0 | 1 | 2 | 3): number {
  const BONUS: Record<number, number> = { 0: 0, 1: 10, 2: 25, 3: 40 };
  return BONUS[level] ?? 0;
}

/**
 * Weighted combination capped at 100.
 * Weights: severity 50% | age 30% | escalation bonus additive
 */
export function combineAttentionScore(
  age: number,
  severity: number,
  escalation: number,
): number {
  const raw = severity * 0.50 + age * 0.30 + escalation;
  return Math.min(Math.round(raw), 100);
}
