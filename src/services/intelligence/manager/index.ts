// ============================================================
// Business Manager layer (I4) — public surface.
// ============================================================

export type {
  ExecutiveSummaryItem, ExecutiveSummaryKind,
  BusinessAction, BusinessActionKind, BusinessActionPriority, BusinessActionStatus,
  BusinessScore, HealthSection, HealthSectionKey, HealthStatus,
  PriorityItem, BusinessBrief, ManagerDashboard, BusinessDigest, DigestRangeKind,
  NotificationContract, NotificationKind,
} from './types';

export { actionsForFindings, ACTION_PRIORITY_RANK } from './actionEngine';
export { computeBusinessScore, SCORE_BASE, SCORE_WEIGHTS, SCORE_POSITIVE_CAP } from './businessScore';
export { computeHealthSections } from './healthEngine';
export { buildPriorityQueue } from './priorityEngine';
export { buildBusinessBrief, buildExecutiveSummary, MAX_SUMMARY_ITEMS } from './businessBriefBuilder';
export { buildManagerDashboard, DASHBOARD_LIST_LIMIT } from './managerDashboard';
export { tryHandleManagerQuestion } from './smartFollowups';
export { buildNotificationContracts } from './notificationContracts';
export { formatBusinessBrief, formatAction, formatSummaryItem, formatHealthSection } from './formatManager';
