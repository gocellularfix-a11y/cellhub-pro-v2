// INTELLIGENCE-OPERATOR-MISSION-ENGINE-V1
// Pure deterministic scoring helpers — no I/O, no randomization, no side effects.

/**
 * Maps a priority label to a 0–100 urgency component.
 * Accepts the string labels used by both ProactiveAction and internal builders.
 */
export function scoreMissionUrgency(priority: string): number {
  if (priority === 'critical') return 100;
  if (priority === 'high')     return 70;
  if (priority === 'medium')   return 45;
  return 20; // 'low' or unknown
}

/**
 * Logarithmic money-impact score 0–100.
 * $10 → ~21  |  $100 → ~52  |  $500 → ~80  |  $1 000+ → ~95
 */
export function scoreMissionMoneyImpact(cents: number): number {
  if (cents <= 0) return 0;
  return Math.min(Math.round(Math.log10(cents / 1000 + 1) * 50), 100);
}

/**
 * Linear age score 0–100.
 * @param ageMs      how old the signal is in milliseconds
 * @param maxMs      age that equals 100 (default: 30 days)
 */
export function scoreMissionAge(ageMs: number, maxMs = 30 * 86_400_000): number {
  if (ageMs <= 0) return 0;
  return Math.min(Math.round((ageMs / maxMs) * 100), 100);
}

/** Maps a 0–1 confidence value to a 0–100 component. */
export function scoreMissionConfidence(confidence: number): number {
  return Math.min(Math.round(confidence * 100), 100);
}

/**
 * Weighted combination of the four components, capped at 100.
 * Weights: urgency 40 % | money 35 % | age 15 % | confidence 10 %
 */
export function combineMissionScore(
  urgency: number,
  money: number,
  age: number,
  confidence: number,
): number {
  const raw = urgency * 0.40 + money * 0.35 + age * 0.15 + confidence * 0.10;
  return Math.min(Math.round(raw), 100);
}
