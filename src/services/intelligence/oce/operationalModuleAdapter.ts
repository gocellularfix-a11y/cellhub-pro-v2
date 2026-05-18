// R-OCE-V1 — Module adapter contract.
// Each module adapter is a pure read-only collector. No async, no side effects.

import type { IntelligenceEngine } from '../IntelligenceEngine';
import type { OperationalModule, OperationalSignal } from './operationalContextTypes';
export type { OperationalSignal };

export interface OperationalModuleAdapter {
  module: OperationalModule;
  collectSignals(engine: IntelligenceEngine): OperationalSignal[];
}
