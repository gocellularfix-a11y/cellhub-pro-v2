import type { LabelJob } from '../types';

const STORAGE_KEY = 'price-labels:history';
const MAX_JOBS = 200;

export function loadJobs(): LabelJob[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveJobs(jobs: LabelJob[]): void {
  try {
    // Keep newest first; cap at MAX_JOBS to prevent unbounded growth
    const trimmed = jobs.slice(0, MAX_JOBS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // localStorage can throw if storage quota is exceeded — fail silently
  }
}

export function addJob(job: LabelJob): LabelJob[] {
  const current = loadJobs();
  const updated = [job, ...current.filter(j => j.id !== job.id)];
  saveJobs(updated);
  return updated;
}

export function removeJob(id: string): LabelJob[] {
  const updated = loadJobs().filter(j => j.id !== id);
  saveJobs(updated);
  return updated;
}

export function clearAllJobs(): void {
  localStorage.removeItem(STORAGE_KEY);
}
