// INTELLIGENCE-PROACTIVE-OPERATOR-SURFACES-V1
// Lightweight bridge between IntelligenceModule (engine owner) and
// FloatingOperatorBubble (no engine access). Session-only — not
// persisted, no side effects, no interval polling.

export type AttentionLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';

export interface AttentionPressure {
  level: AttentionLevel;
  count: number;
  topSeverity: number;
}

const INITIAL: AttentionPressure = { level: 'none', count: 0, topSeverity: 0 };
let current: AttentionPressure = INITIAL;
const subscribers = new Set<() => void>();

/** Map raw feed data to a severity level. */
export function severityToLevel(count: number, topSeverity: number): AttentionLevel {
  if (count === 0) return 'none';
  if (topSeverity < 40) return 'low';
  if (topSeverity < 65) return 'medium';
  if (topSeverity < 85) return 'high';
  return 'critical';
}

/** Called by IntelligenceModule once per mount/engine update. */
export function setAttentionPressure(p: AttentionPressure): void {
  if (p.level === current.level && p.count === current.count) return;
  current = p;
  for (const cb of subscribers) cb();
}

export function getAttentionPressure(): AttentionPressure {
  return current;
}

export function subscribeAttentionPressure(cb: () => void): () => void {
  subscribers.add(cb);
  return () => { subscribers.delete(cb); };
}
