// R-OCE-V1 — OCE aggregator.
// Runs all registered adapters, normalizes + dedupes + sorts signals, builds snapshot.
// Never throws to callers — adapter errors are isolated individually.

import type { IntelligenceEngine } from '../IntelligenceEngine';
import type { OperationalContextSnapshot } from './operationalContextTypes';
import type { OperationalModuleAdapter } from './operationalModuleAdapter';
import {
  normalizeSignal,
  dedupeOperationalSignals,
  sortOperationalSignals,
  buildOperationalContextSnapshot,
} from './operationalSignalRegistry';
import { repairsAdapter }       from './adapters/repairsAdapter';
import { customersAdapter }     from './adapters/customersAdapter';
import { outreachAdapter }      from './adapters/outreachAdapter';
import { inventoryAdapter }     from './adapters/inventoryAdapter';
import { posAdapter }           from './adapters/posAdapter';
import { specialOrdersAdapter } from './adapters/specialOrdersAdapter';
import { layawaysAdapter }      from './adapters/layawaysAdapter';
import { phonePaymentsAdapter } from './adapters/phonePaymentsAdapter';
import { unlocksAdapter }        from './adapters/unlocksAdapter';
import { appointmentsAdapter }  from './adapters/appointmentsAdapter';

const REGISTERED_ADAPTERS: OperationalModuleAdapter[] = [
  repairsAdapter,
  customersAdapter,
  outreachAdapter,
  inventoryAdapter,
  posAdapter,
  specialOrdersAdapter,
  layawaysAdapter,
  phonePaymentsAdapter,
  unlocksAdapter,
  appointmentsAdapter,
];

export function buildOperationalContext(
  engine: IntelligenceEngine,
): OperationalContextSnapshot {
  const raw: ReturnType<OperationalModuleAdapter['collectSignals']> = [];

  for (const adapter of REGISTERED_ADAPTERS) {
    try {
      const signals = adapter.collectSignals(engine);
      raw.push(...signals);
    } catch { /* adapter errors never surface to callers */ }
  }

  const normalized = raw.map(normalizeSignal);
  const deduped    = dedupeOperationalSignals(normalized);
  const sorted     = sortOperationalSignals(deduped);
  return buildOperationalContextSnapshot(sorted);
}
