// R-INTELLIGENCE-MANAGER-QUEUE-V1
// localStorage-backed manager queue persistence layer.
// Full-replace writes: read → mutate → write. No partial saves.

import type { ManagerQueueItem } from './types';

export const MANAGER_QUEUE_KEY = 'cellhub:managerQueue:v1';

const MAX_RESOLVED = 50; // cap on non-pending items

export function readQueue(): ManagerQueueItem[] {
  try {
    const raw = localStorage.getItem(MANAGER_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ManagerQueueItem[]) : [];
  } catch { return []; }
}

export function writeQueue(items: ManagerQueueItem[]): void {
  try {
    const pending  = items.filter(i => i.status === 'pending');
    const terminal = items
      .filter(i => i.status !== 'pending')
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_RESOLVED);
    localStorage.setItem(MANAGER_QUEUE_KEY, JSON.stringify([...pending, ...terminal]));
  } catch { /* quota / incognito — best-effort */ }
}
