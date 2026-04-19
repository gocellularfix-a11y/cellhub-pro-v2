/**
 * Calculate similarity between two strings using Dice coefficient.
 * Returns a value between 0 (no match) and 1 (exact match).
 * Used for fuzzy matching repair deposits to customer names.
 * IMPORTANT: Threshold should be >= 0.8 to avoid phantom deposits.
 */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const sa = a.toLowerCase().trim();
  const sb = b.toLowerCase().trim();
  if (sa === sb) return 1;
  if (sa.length < 2 || sb.length < 2) return 0;

  const bigramsA = new Set<string>();
  for (let i = 0; i < sa.length - 1; i++) {
    bigramsA.add(sa.substring(i, i + 2));
  }

  let intersection = 0;
  for (let i = 0; i < sb.length - 1; i++) {
    const bigram = sb.substring(i, i + 2);
    if (bigramsA.has(bigram)) {
      intersection++;
      bigramsA.delete(bigram); // count each only once
    }
  }

  return (2 * intersection) / (sa.length - 1 + sb.length - 1);
}

/**
 * Find the best fuzzy match in an array of items.
 * Returns null if no match meets the threshold.
 */
export function findBestMatch<T>(
  query: string,
  items: T[],
  getText: (item: T) => string,
  threshold = 0.8,
): { item: T; score: number } | null {
  let best: { item: T; score: number } | null = null;

  for (const item of items) {
    const score = similarity(query, getText(item));
    if (score >= threshold && (!best || score > best.score)) {
      best = { item, score };
    }
  }

  return best;
}

/**
 * Simple search filter — case-insensitive substring match across multiple fields.
 */
export function matchesSearch(query: string, ...fields: (string | undefined | null)[]): boolean {
  if (!query.trim()) return true;
  const lower = query.toLowerCase().trim();
  return fields.some((f) => f && f.toLowerCase().includes(lower));
}
