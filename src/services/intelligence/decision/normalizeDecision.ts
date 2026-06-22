// ============================================================
// R-INTELLIGENCE-DECISION-LAYER-F1: normalization dispatcher.
//
// Turns a homogeneous batch of one generator's signals into normalized
// IntelligenceDecision[]. Pure + deterministic. NOT consumed by any live path
// yet — this is the entry point a future Decision Engine phase will call.
// ============================================================

import type { LossSignal } from '@/services/intelligence/chat/whatIsLosingMoney';
import type { DropSignal } from '@/services/intelligence/chat/whyDidSalesDrop';
import type { AttentionItem } from '@/services/intelligence/chat/whoNeedsAttentionToday';
import type { RestockRecommendation } from '@/services/intelligence/chat/restockOpportunity';
import type { DiagnosisCause } from '@/services/intelligence/chat/whyIsTodaySlow';
import type { ProactiveAction } from '@/services/intelligence/proactive/types';
import type { IntelligenceDecision } from './IntelligenceDecision';
import {
  fromLossSignal,
  fromDropSignal,
  fromAttentionItem,
  fromRestockRecommendation,
  fromDiagnosisCause,
  fromProactiveAction,
} from './adapters';

/** Tagged batch of a single generator's output. */
export type TaggedSignals =
  | { kind: 'loss'; signals: LossSignal[] }
  | { kind: 'drop'; signals: DropSignal[] }
  | { kind: 'attention'; signals: AttentionItem[] }
  | { kind: 'restock'; signals: RestockRecommendation[] }
  | { kind: 'diagnosis'; signals: DiagnosisCause[] }
  | { kind: 'proactive'; signals: ProactiveAction[] };

/** Normalize one generator's batch into canonical decisions. */
export function normalizeDecisions(input: TaggedSignals): IntelligenceDecision[] {
  switch (input.kind) {
    case 'loss':
      return input.signals.map(fromLossSignal);
    case 'drop':
      return input.signals.map(fromDropSignal);
    case 'attention':
      return input.signals.map(fromAttentionItem);
    case 'restock':
      return input.signals.map(fromRestockRecommendation);
    case 'diagnosis':
      return input.signals.map(fromDiagnosisCause);
    case 'proactive':
      return input.signals.map(fromProactiveAction);
  }
}
