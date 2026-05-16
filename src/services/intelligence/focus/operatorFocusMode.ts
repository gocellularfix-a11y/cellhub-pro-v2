// ============================================================
// CellHub Intelligence — Operator Focus Mode
// R-INTELLIGENCE-FOCUS-MODE-V1
//
// Deterministic attention management. Adapts what Intelligence
// emphasizes based on current store state + queue pressure.
//
// 6 modes: balanced | execution_focus | outreach_focus |
//          repair_focus | collection_focus | rush_focus
//
// 10-minute stabilization prevents mode oscillation. Urgent
// modes (rush_focus, repair_focus) override immediately.
//
// Rules: deterministic only, no AI, no background workers,
//        no automation, no hidden critical info.
// ============================================================

import type { StoreStateResult } from '../storeState/storeStateEngine';

// ── Types ─────────────────────────────────────────────────

export type FocusMode =
  | 'balanced'
  | 'execution_focus'
  | 'outreach_focus'
  | 'repair_focus'
  | 'collection_focus'
  | 'rush_focus';

// Virtual section keys used for highlight + suppression.
// 'briefing_info' is not a real DOM section — it means "filter
// info-severity items from the Daily Briefing list."
export type FocusSection = 'missions' | 'queue' | 'continuity' | 'briefing_info' | 'outreach';

export interface FocusModeResult {
  mode: FocusMode;
  reason: string;
  accentColor: string;
  highlightedSections: FocusSection[];
  suppressedSections: FocusSection[];
  missionsDefaultCollapsed: boolean;
  queueDefaultCollapsed: boolean;
  isUrgentOverride: boolean;
}

export interface FocusModeInput {
  storeState: StoreStateResult;
  pendingQueueCount: number;
  now?: number;
}

// ── Stabilization ──────────────────────────────────────────

const STORAGE_KEY = 'cellhub:intelligence:focusMode:v1';
const STABILIZATION_MS = 10 * 60 * 1000; // 10 minutes

const URGENT_MODES = new Set<FocusMode>(['rush_focus', 'repair_focus']);

interface StoredMode { mode: FocusMode; lockedAt: number; }

function readStored(): StoredMode | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredMode) : null;
  } catch { return null; }
}

function writeStored(mode: FocusMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode, lockedAt: Date.now() }));
  } catch {}
}

function stabilize(newMode: FocusMode, now: number): FocusMode {
  const stored = readStored();
  if (!stored) { writeStored(newMode); return newMode; }
  if (stored.mode === newMode) return newMode;
  // Urgent modes always override immediately — no stabilization delay.
  if (URGENT_MODES.has(newMode)) { writeStored(newMode); return newMode; }
  // Non-urgent: enforce stabilization window to prevent oscillation.
  if (now - stored.lockedAt < STABILIZATION_MS) return stored.mode;
  writeStored(newMode);
  return newMode;
}

// ── Detection priority ─────────────────────────────────────
// rush > repair > execution > collection > outreach > balanced

function detectRaw(input: FocusModeInput): FocusMode {
  const { storeState, pendingQueueCount } = input;
  if (storeState.state === 'rush_mode')        return 'rush_focus';
  if (storeState.state === 'repair_overload')  return 'repair_focus';
  if (pendingQueueCount >= 3)                  return 'execution_focus';
  if (storeState.state === 'collection_mode')  return 'collection_focus';
  if (storeState.state === 'opportunity_window') return 'outreach_focus';
  return 'balanced';
}

// ── Mode result map ────────────────────────────────────────

type ModeConfig = Omit<FocusModeResult, 'mode' | 'isUrgentOverride'>;

const MODE_CONFIG: Record<FocusMode, ModeConfig> = {
  balanced: {
    reason: 'Balanced',
    accentColor: '#10B981',
    highlightedSections: [],
    suppressedSections: [],
    missionsDefaultCollapsed: false,
    queueDefaultCollapsed: false,
  },
  execution_focus: {
    reason: 'Execution',
    accentColor: '#F59E0B',
    highlightedSections: ['queue'],
    suppressedSections: ['briefing_info', 'outreach'],
    missionsDefaultCollapsed: true,
    queueDefaultCollapsed: false,
  },
  outreach_focus: {
    reason: 'Outreach',
    accentColor: '#3B82F6',
    highlightedSections: ['missions', 'outreach'],
    suppressedSections: ['briefing_info'],
    missionsDefaultCollapsed: false,
    queueDefaultCollapsed: true,
  },
  repair_focus: {
    reason: 'Repairs',
    accentColor: '#F97316',
    highlightedSections: ['continuity'],
    suppressedSections: [],
    missionsDefaultCollapsed: false,
    queueDefaultCollapsed: false,
  },
  collection_focus: {
    reason: 'Collections',
    accentColor: '#10B981',
    highlightedSections: ['missions'],
    suppressedSections: ['briefing_info'],
    missionsDefaultCollapsed: false,
    queueDefaultCollapsed: false,
  },
  rush_focus: {
    reason: 'Rush',
    accentColor: '#EF4444',
    highlightedSections: [],
    suppressedSections: ['briefing_info', 'outreach'],
    missionsDefaultCollapsed: true,
    queueDefaultCollapsed: true,
  },
};

// ── Main export ────────────────────────────────────────────

export function computeFocusMode(input: FocusModeInput): FocusModeResult {
  const now = input.now ?? Date.now();
  const rawMode = detectRaw(input);
  const stableMode = stabilize(rawMode, now);
  const cfg = MODE_CONFIG[stableMode];
  return {
    ...cfg,
    mode: stableMode,
    isUrgentOverride: URGENT_MODES.has(stableMode),
  };
}
