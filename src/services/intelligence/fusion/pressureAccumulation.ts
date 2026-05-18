// CellHub Intelligence — Pressure Accumulation
// Combines related operational signals into higher-order cluster insights.
// R-FUSION-PRESSURE-ACCUMULATION-V1
//
// READ-ONLY, PURE, DETERMINISTIC.
// Only consumes: existing FusedInsight[]. No raw store access, no I/O.

import type { FusedInsight, FusedInsightSeverity, PressureClusterType } from './fusionTypes';

// ── Scoring ───────────────────────────────────────────────────────────────────

const SEV_WEIGHT:  Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
const TIER_WEIGHT: Record<string, number> = { critical: 4, urgent: 3, warning: 2, watch: 1 };

function scoreInsight(insight: FusedInsight): number {
  const sev    = SEV_WEIGHT[insight.severity]              ?? 1;
  const tier   = TIER_WEIGHT[insight.escalationTier ?? ''] ?? 0;
  const repeat = Math.min((insight.repeatCount ?? 0) * 0.5, 3);
  return sev + tier + repeat;
}

function computePressureScore(group: FusedInsight[]): number {
  const raw = group.reduce((s, i) => s + scoreInsight(i), 0);
  return Math.min(Math.round(raw * 5), 100);
}

function toClusterSeverity(score: number): FusedInsightSeverity {
  if (score >= 80) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

function makeCluster(
  id: string,
  cluster: PressureClusterType,
  category: FusedInsight['category'],
  group: FusedInsight[],
  en: { title: string; summary: string },
  es: { title: string; summary: string },
  pt: { title: string; summary: string },
  extra?: Partial<FusedInsight>,
): FusedInsight {
  const score = computePressureScore(group);
  return {
    id,
    severity:      toClusterSeverity(score),
    category,
    title:     en.title,
    titleEs:   es.title,
    titlePt:   pt.title,
    summary:   en.summary,
    summaryEs: es.summary,
    summaryPt: pt.summary,
    pressureCluster: cluster,
    pressureScore:   score,
    ...extra,
  };
}

// ── Cluster 1: customer decay ─────────────────────────────────────────────────
// 2+ insights for the same customer entity across vip_risk, recovery_opportunity,
// workflow_interruption categories or relevant suppression patterns.

const CUSTOMER_CATEGORIES = new Set<string>([
  'vip_risk', 'recovery_opportunity', 'workflow_interruption',
]);
const CUSTOMER_PATTERNS   = new Set<string>([
  'ignored_vip', 'repeated_dismissal', 'stale_workflow',
]);

function detectCustomerDecay(insights: FusedInsight[]): FusedInsight[] {
  const byCustomer = new Map<string, FusedInsight[]>();
  for (const insight of insights) {
    if (!insight.entityId || insight.entityType !== 'customer') continue;
    if (
      !CUSTOMER_CATEGORIES.has(insight.category) &&
      !(insight.suppressionPattern && CUSTOMER_PATTERNS.has(insight.suppressionPattern))
    ) continue;
    const g = byCustomer.get(insight.entityId) ?? [];
    g.push(insight);
    byCustomer.set(insight.entityId, g);
  }

  const result: FusedInsight[] = [];
  for (const [entityId, group] of byCustomer) {
    if (group.length < 2) continue;
    result.push(makeCluster(
      `pcluster:customer-decay:${entityId}`,
      'customer_decay',
      'vip_risk',
      group,
      { title: 'Customer relationship degradation detected',
        summary: `${group.length} unresolved signals for the same customer.` },
      { title: 'Deterioro de relación con cliente detectado',
        summary: `${group.length} señales sin resolver para el mismo cliente.` },
      { title: 'Deterioração de relacionamento com cliente detectado',
        summary: `${group.length} sinais não resolvidos para o mesmo cliente.` },
      { entityId, entityType: 'customer', actionType: 'open_customer', actionTargetId: entityId },
    ));
  }
  return result;
}

// ── Cluster 2: workflow instability ──────────────────────────────────────────
// 3+ workflow_interruption insights or stale_workflow suppression patterns.

function detectWorkflowInstability(insights: FusedInsight[]): FusedInsight[] {
  const group = insights.filter(
    (i) =>
      i.category === 'workflow_interruption' ||
      i.suppressionPattern === 'stale_workflow',
  );
  if (group.length < 3) return [];

  return [makeCluster(
    'pcluster:workflow-instability',
    'workflow_instability',
    'workflow_interruption',
    group,
    { title: 'Workflow instability increasing',
      summary: `${group.length} workflows interrupted or stalled without resolution.` },
    { title: 'Inestabilidad de workflows aumentando',
      summary: `${group.length} workflows interrumpidos o estancados sin resolución.` },
    { title: 'Instabilidade de workflows aumentando',
      summary: `${group.length} workflows interrompidos ou parados sem resolução.` },
  )];
}

// ── Cluster 3: operator overload ──────────────────────────────────────────────
// Overload signal present + 3+ urgent/critical escalation tier insights.

function detectOperatorOverload(insights: FusedInsight[]): FusedInsight[] {
  const hasOverload = insights.some(
    (i) =>
      i.category === 'operator_overload' ||
      i.suppressionPattern === 'operator_overload_pattern',
  );
  if (!hasOverload) return [];

  const urgentGroup = insights.filter(
    (i) => i.escalationTier === 'urgent' || i.escalationTier === 'critical',
  );
  if (urgentGroup.length < 3) return [];

  return [makeCluster(
    'pcluster:operator-overload',
    'operator_overload',
    'operator_overload',
    urgentGroup,
    { title: 'Operator saturation affecting execution',
      summary: `${urgentGroup.length} urgent items pending while operator is overloaded — follow-through at risk.` },
    { title: 'Saturación del operador afectando la ejecución',
      summary: `${urgentGroup.length} ítems urgentes pendientes mientras el operador está saturado.` },
    { title: 'Saturação do operador afetando a execução',
      summary: `${urgentGroup.length} itens urgentes pendentes com operador sobrecarregado.` },
  )];
}

// ── Cluster 4: revenue pressure ───────────────────────────────────────────────
// Candidates: conversion_opportunity where staleSinceMs>=4h OR severity high/critical
//             OR escalationTier urgent/critical.
// Fire: 2+ candidates OR 1 critical OR 1 staleSinceMs>=24h.

const REVENUE_STALE_4H  = 4  * 3600_000;
const REVENUE_STALE_24H = 24 * 3600_000;

function detectRevenuePressure(insights: FusedInsight[]): FusedInsight[] {
  const candidates = insights.filter((i) => {
    if (i.category !== 'conversion_opportunity') return false;
    return (
      (i.staleSinceMs !== undefined && i.staleSinceMs >= REVENUE_STALE_4H) ||
      i.severity === 'high' || i.severity === 'critical' ||
      i.escalationTier === 'urgent' || i.escalationTier === 'critical'
    );
  });

  if (candidates.length === 0) return [];

  const shouldFire =
    candidates.length >= 2 ||
    candidates.some((i) => i.severity === 'critical') ||
    candidates.some((i) => i.staleSinceMs !== undefined && i.staleSinceMs >= REVENUE_STALE_24H);

  if (!shouldFire) return [];

  return [makeCluster(
    'pcluster:revenue-pressure',
    'revenue_pressure',
    'conversion_opportunity',
    candidates,
    { title: 'Revenue leakage pressure accumulating',
      summary: `${candidates.length} stalled conversion opportunities without follow-up.` },
    { title: 'Presión de pérdida de ingresos acumulándose',
      summary: `${candidates.length} oportunidades de conversión estancadas sin seguimiento.` },
    { title: 'Pressão de perda de receita acumulando',
      summary: `${candidates.length} oportunidades de conversão paradas sem acompanhamento.` },
  )];
}

// ── Cluster 5: recovery pressure ─────────────────────────────────────────────
// 2+ repair-entity insights or repeated_unresolved suppression patterns.

function detectRecoveryPressure(insights: FusedInsight[]): FusedInsight[] {
  const group = insights.filter(
    (i) =>
      i.entityType === 'repair' ||
      i.suppressionPattern === 'repeated_unresolved',
  );
  if (group.length < 2) return [];

  return [makeCluster(
    'pcluster:recovery-pressure',
    'recovery_pressure',
    'operational_risk',
    group,
    { title: 'Service recovery pressure building',
      summary: `${group.length} unresolved repairs or repeated escalations requiring action.` },
    { title: 'Presión de recuperación de servicio aumentando',
      summary: `${group.length} reparaciones sin resolver o escalaciones repetidas que requieren acción.` },
    { title: 'Pressão de recuperação de serviço aumentando',
      summary: `${group.length} reparos não resolvidos ou escalações repetidas necessitando ação.` },
  )];
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Combine related operational signals into higher-order cluster insights.
 * Consumes only existing FusedInsight[] — no raw store access, no I/O.
 * Pure read — no writes, no side effects, no new storage keys.
 */
export function detectPressureAccumulation(
  insights: FusedInsight[],
  _now?: number,
): FusedInsight[] {
  return [
    ...detectCustomerDecay(insights),
    ...detectWorkflowInstability(insights),
    ...detectOperatorOverload(insights),
    ...detectRevenuePressure(insights),
    ...detectRecoveryPressure(insights),
  ];
}
