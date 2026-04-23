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