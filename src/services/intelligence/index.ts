// CellHub Intelligence — Public API
export * from './types';

export { IntelligenceEngine, type EngineConfig, type EngineResult } from './IntelligenceEngine';

export { SalesAnalyzer } from './analyzers/SalesAnalyzer';
export { InventoryAnalyzer } from './analyzers/InventoryAnalyzer';
export { RepairAnalyzer } from './analyzers/RepairAnalyzer';
export { CustomerAnalyzer } from './analyzers/CustomerAnalyzer';
export { FinancialAnalyzer } from './analyzers/FinancialAnalyzer';

export { AlertEngine } from './alerts/AlertEngine';
export * from './alerts/AlertTypes';
export { DEFAULT_THRESHOLDS } from './alerts/thresholds';

export { CustomerScorer, type CustomerScore } from './scoring/CustomerScorer';
export { InventoryScorer, type InventoryScore } from './scoring/InventoryScorer';
export { RepairScorer, type RepairScore } from './scoring/RepairScorer';

export * from './utils/statistics';
export * from './utils/dateHelpers';

// Schema adapter — exported for direct use when needed (e.g. tests, debugging).
// The IntelligenceEngine already applies the adapter internally on construction.
export { adaptSale, adaptCustomer, adaptInventory, adaptRepair } from './adapters/schemaAdapter';

// R-INTEL-CROSS-F3: cross-module correlation helpers.
export {
  findRepairInventoryGaps,
  classifyRepairIssue,
  type RepairInventoryGap,
} from './correlations';

// R-INTEL-NLG-F4: natural-language summary helpers.
export {
  summarizeDashboard,
  summarizeCustomerHistory,
  type NlgSummary,
} from './nlg';

// R-COMPANION-INTELLIGENCE-ACK-INBOUND-V1 — single-slot active engine
// registry. IntelligenceModule registers its engineRef.current while
// mounted so external pathways (Companion intelligence ack receiver)
// can dispatch acknowledge without holding a React ref. Cero scoring
// changes, cero analyzer changes, cero networking. Safe no-op when no
// engine is registered — alert acks during navigation gaps are logged
// and dropped without affecting other intelligence state.
import type { IntelligenceEngine as _IE } from './IntelligenceEngine';
let _activeEngine: _IE | null = null;
export function setActiveIntelligenceEngine(engine: _IE | null): void {
  _activeEngine = engine;
}
export function acknowledgeIntelligenceAlertOnActiveEngine(
  alertId: string,
  userId: string,
): boolean {
  if (!_activeEngine) {
    console.info(
      `[intelligence] no active engine — ack dropped (alertId=${alertId})`,
    );
    return false;
  }
  try {
    _activeEngine.acknowledgeAlert(alertId, userId);
    console.info(
      `[intelligence] acknowledged alertId=${alertId} by=${userId || '<unknown>'}`,
    );
    return true;
  } catch (err) {
    console.warn('[intelligence] acknowledge failed', err);
    return false;
  }
}