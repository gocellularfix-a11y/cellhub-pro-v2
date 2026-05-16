// ============================================================
// CellHub Intelligence — Role-Aware Intelligence Routing
// R-INTELLIGENCE-ROLE-ROUTING-V1
//
// Adapts Intelligence emphasis, section visibility, and guidance
// based on operator role. Deterministic, static config per role.
//
// Suppression = default-collapsed, NOT permanently hidden.
// Managers/owners can access everything.
//
// Roles: owner | manager | employee
// Source: AppState.currentEmployee.role (EmployeeRole)
// Fallback: 'owner' (safe default for solo/unregistered operators)
//
// Rules: no auth replacement, no surveillance, no AI inference.
// ============================================================

// ── Types ─────────────────────────────────────────────────

export type OperatorRole = 'employee' | 'manager' | 'owner';

export type RoutedSection =
  | 'weekly_review'
  | 'daily_briefing'
  | 'business_memory'
  | 'strategic_insights'
  | 'recommended_actions'
  | 'operational_health'
  | 'execution_chain'
  | 'continuity'
  | 'missions'
  | 'queue';

export interface RoleRoutingResult {
  role: OperatorRole;
  emphasizedSections: RoutedSection[];
  suppressedSections: RoutedSection[];
  preferredFocusMode?: string;
  recommendedActionPriority: string[];
  weeklyReviewDefaultCollapsed: boolean;
  strategicInsightsDefaultCollapsed: boolean;
  businessMemoryDefaultCollapsed: boolean;
}

// ── Role resolver ──────────────────────────────────────────

interface EmployeeLike {
  role: string;
}

// Maps EmployeeRole → OperatorRole.
// 'owner'                          → 'owner'
// 'manager'                        → 'manager'
// 'technician' | 'sales' | 'cashier' → 'employee'
// null (no login / solo operator)  → 'owner'
export function resolveOperatorRole(currentEmployee: EmployeeLike | null): OperatorRole {
  if (!currentEmployee) return 'owner';
  const r = currentEmployee.role;
  if (r === 'owner') return 'owner';
  if (r === 'manager') return 'manager';
  return 'employee'; // technician, sales, cashier
}

// ── Static role configuration ──────────────────────────────

const ROLE_CONFIG: Record<OperatorRole, Omit<RoleRoutingResult, 'role'>> = {

  // EMPLOYEE — execution and customer-facing workflows.
  // Analysis sections collapsed by default to reduce cognitive load.
  employee: {
    emphasizedSections: ['continuity', 'queue', 'execution_chain', 'missions'],
    suppressedSections: ['weekly_review', 'strategic_insights', 'business_memory'],
    preferredFocusMode: 'execution_focus',
    recommendedActionPriority: ['repair', 'customer', 'operational'],
    weeklyReviewDefaultCollapsed:     true,
    strategicInsightsDefaultCollapsed: true,
    businessMemoryDefaultCollapsed:   true,
  },

  // MANAGER — coordination, operational pressure, approvals.
  // Strategic/long-term analysis collapsed; operational health front and center.
  manager: {
    emphasizedSections: ['operational_health', 'continuity', 'queue', 'recommended_actions'],
    suppressedSections: ['weekly_review', 'strategic_insights'],
    preferredFocusMode: undefined,
    recommendedActionPriority: ['repair', 'operational', 'collection', 'customer'],
    weeklyReviewDefaultCollapsed:     true,
    strategicInsightsDefaultCollapsed: true,
    businessMemoryDefaultCollapsed:   false,
  },

  // OWNER — strategy, revenue recovery, business patterns.
  // All sections visible; strategic layers prioritized.
  owner: {
    emphasizedSections: ['weekly_review', 'strategic_insights', 'recommended_actions', 'operational_health', 'business_memory'],
    suppressedSections: [],
    preferredFocusMode: undefined,
    recommendedActionPriority: ['collection', 'customer', 'repair', 'sales', 'operational'],
    weeklyReviewDefaultCollapsed:     false,
    strategicInsightsDefaultCollapsed: false,
    businessMemoryDefaultCollapsed:   false,
  },

};

// ── Main export ────────────────────────────────────────────

export function computeRoleRouting(
  currentEmployee: EmployeeLike | null,
): RoleRoutingResult {
  const role = resolveOperatorRole(currentEmployee);
  return { role, ...ROLE_CONFIG[role] };
}
