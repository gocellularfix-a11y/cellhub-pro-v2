// ============================================================
// Companion — Intelligence Bridge
// R-INTELLIGENCE-COMPANION-SYNC-V1
//
// Builds a lightweight deterministic intelligence payload from
// raw app state for the desktop Companion intelligence tab.
//
// NOT a remote analytics engine. NOT a cloud bridge.
// Runs on-device, reads from existing services and localStorage.
//
// Rules: no ML, no AI, no bridge API modifications, no HTTP.
// Simplified inputs only — no full intelligence stack duplication.
// ============================================================

import {
  detectStoreState,
  type StoreStateResult,
} from '@/services/intelligence/storeState/storeStateEngine';
import {
  generateOperationalHealth,
  type OperationalHealthResult,
  type HealthDimensionKey,
} from '@/services/intelligence/health/operationalHealth';
import {
  resolveOperatorRole,
  type OperatorRole,
} from '@/services/intelligence/routing/roleIntelligenceRouting';
import { readOperatorQueue } from '@/services/intelligence/operatorQueue/operatorQueue';

// ── Types ─────────────────────────────────────────────────

export interface CompanionIntelligenceInput {
  sales: unknown[];
  repairs: unknown[];
  layaways: unknown[];
  currentEmployee: { role: string } | null;
}

export interface CompanionStoreStateInfo {
  state: string;
  reason: string;
  confidence: number;
}

export interface CompanionHealthInfo {
  overallScore: number;
  overallStatus: string;
  summary: string;
  weakestArea?: HealthDimensionKey;
}

export type CompanionItemSeverity = 'critical' | 'high' | 'medium';

export interface CompanionCriticalItem {
  type: string;
  title: string;
  severity: CompanionItemSeverity;
}

export interface CompanionIntelligencePayload {
  generatedAt: number;
  storeState: CompanionStoreStateInfo;
  operationalHealth: CompanionHealthInfo;
  criticalItems: CompanionCriticalItem[];
  recommendedFocus: string;
  queuePressure: number;
  continuityPressure: number;
  role: OperatorRole;
}

// ── Internal helpers ───────────────────────────────────────

function severityFromScore(score: number): CompanionItemSeverity {
  if (score < 40) return 'critical';
  if (score < 55) return 'high';
  return 'medium';
}

function buildCriticalItems(
  health: OperationalHealthResult,
  queuePressure: number,
): CompanionCriticalItem[] {
  const items: CompanionCriticalItem[] = [];

  // Worst dimensions first — only surface those under pressure
  const sorted = [...health.dimensions].sort((a, b) => a.score - b.score);

  for (const dim of sorted) {
    if (items.length >= 3) break;
    if (dim.score >= 70) continue; // healthy — skip

    const severity = severityFromScore(dim.score);

    switch (dim.dimension) {
      case 'repair_health':
        items.push({ type: 'repair_backlog', title: dim.reason || 'Repair backlog needs attention', severity });
        break;
      case 'collection_health':
        items.push({ type: 'collection_pressure', title: dim.reason || 'Outstanding balances need recovery', severity });
        break;
      case 'execution_health':
        items.push({ type: 'execution_pressure', title: dim.reason || 'Workflow execution under pressure', severity });
        break;
      case 'customer_health':
        items.push({ type: 'customer_outreach', title: 'Customer outreach below expected', severity });
        break;
      case 'operational_stability':
        items.push({ type: 'operational_pressure', title: dim.reason || 'Operational stability affected', severity });
        break;
    }
  }

  // Queue pressure as supplemental signal (if not already surfaced by execution health)
  if (items.length < 3 && queuePressure >= 5) {
    items.push({ type: 'queue_backlog', title: `${queuePressure} tasks pending in operator queue`, severity: 'medium' });
  }

  return items;
}

function buildRecommendedFocus(
  role: OperatorRole,
  storeState: string,
  weakestArea?: HealthDimensionKey,
): string {
  // Store state is the highest-priority signal regardless of role
  if (storeState === 'rush_mode')       return 'Fast execution — clear queue and continuity items';
  if (storeState === 'repair_overload') return 'Repair backlog coordination and escalation';
  if (storeState === 'slow_day')        return 'Outreach and upsell opportunities';
  if (storeState === 'collection_mode') return 'Collection recovery and balance follow-up';

  // Role-driven focus when state is normal
  if (role === 'employee') return 'Queue and customer workflow execution';

  if (role === 'manager') {
    if (weakestArea === 'repair_health')      return 'Repair backlog oversight and escalation';
    if (weakestArea === 'collection_health')  return 'Collection oversight and recovery coordination';
    if (weakestArea === 'execution_health')   return 'Workflow interruption resolution';
    return 'Approvals, queue pressure, and execution coordination';
  }

  // owner
  if (weakestArea === 'collection_health')  return 'Revenue recovery — outstanding collection opportunities';
  if (weakestArea === 'customer_health')    return 'VIP outreach and customer engagement';
  if (weakestArea === 'repair_health')      return 'Repair backlog — revenue recovery potential';
  return 'Strategic oversight and recoverable revenue opportunities';
}

// ── Main export ────────────────────────────────────────────

// Builds a lightweight intelligence snapshot from raw app state.
// Called from IntelligenceStatusPanel via useMemo — recomputes only
// when repairs/layaways/sales/currentEmployee change reference.
//
// Simplified inputs: no business memory, strategic insights, missions,
// or continuity engine — those require the full IntelligenceModule stack.
// Repair + layaway + queue signals are enough for a glanceable summary.
export function buildCompanionIntelligencePayload(
  input: CompanionIntelligenceInput,
): CompanionIntelligencePayload {
  const now = Date.now();

  const storeState: StoreStateResult = detectStoreState({
    sales:   input.sales   as Parameters<typeof detectStoreState>[0]['sales'],
    repairs: input.repairs as Parameters<typeof detectStoreState>[0]['repairs'],
    layaways: input.layaways as Parameters<typeof detectStoreState>[0]['layaways'],
    outreachCandidateCount: 0,
  });

  // Read operator queue directly from localStorage (synchronous, cheap)
  const queuePressure = readOperatorQueue().filter((i) => i.status === 'pending').length;

  const health: OperationalHealthResult = generateOperationalHealth({
    storeState,
    businessMemoryInsights: [],  // not computed at companion layer
    strategicInsights: [],
    recommendations: [],
    repairs:   input.repairs  as Parameters<typeof generateOperationalHealth>[0]['repairs'],
    layaways:  input.layaways as Parameters<typeof generateOperationalHealth>[0]['layaways'],
    managerQueueItems: [],
    continuityItems: [],
    missions: [],
    pendingQueueCount: queuePressure,
    outreachCandidateCount: 0,
    now,
  });

  const role = resolveOperatorRole(input.currentEmployee);
  const criticalItems = buildCriticalItems(health, queuePressure);
  const recommendedFocus = buildRecommendedFocus(role, storeState.state, health.weakestArea);

  return {
    generatedAt: now,
    storeState: {
      state:      storeState.state,
      reason:     storeState.reason,
      confidence: storeState.confidence,
    },
    operationalHealth: {
      overallScore:  health.overallScore,
      overallStatus: health.overallStatus,
      summary:       health.summary,
      weakestArea:   health.weakestArea,
    },
    criticalItems,
    recommendedFocus,
    queuePressure,
    continuityPressure: 0, // approximated — full continuity engine not run at companion layer
    role,
  };
}
