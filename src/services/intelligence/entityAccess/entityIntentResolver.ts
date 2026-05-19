// INTELLIGENCE-ENTITY-INTEGRATION-V1
// Deterministic: extract action verb + resolve entity from natural command queries.
// No AI/NLP/embeddings — keyword extraction + searchOperationalEntities.

import type { IntelligenceEngine } from '../IntelligenceEngine';
import type { ResolvedEntity, EntityAction, EntityKind } from './types';
import { searchOperationalEntities } from './entitySearch';

export interface EntityIntentResult {
  entity: ResolvedEntity | null;
  candidates: ResolvedEntity[];
  action?: EntityAction;
  confidence: number;
}

// ── Action verb detection (first word / first few words) ──────────────────────

const VERB_ACTION: Array<[RegExp, EntityAction]> = [
  [/^(history|historial)\b/i, 'open_history'],        // before 'open' to avoid swallowing
  [/^(open|show|find|view|see|abrir|ver|mostrar|buscar|abra|mu[eé]strame)\b/i, 'open'],
  [/^(call|llamar?|ligar)\b/i, 'call'],
  [/^(whatsapp|wa|message|text|mensaje)\b/i, 'whatsapp'],
  [/^(promov[ae]r|promoci[oa]nar|promote|push)\b/i, 'promote'],
  [/^(collect|charge|cobrar|cobro)\b/i, 'collect_payment'],
  [/^(follow|seguimiento|acompanhar)\b/i, 'follow_up'],
  [/^(mark|marcar)\b/i, 'mark_ready'],
];

// ── Module kind hints ─────────────────────────────────────────────────────────

const KIND_HINT_MAP: Array<[RegExp, EntityKind[]]> = [
  [/\b(repair|reparaci[oó]n|reparo|ticket)\b/i, ['repair']],
  [/\b(customer|cliente|client)\b/i, ['customer']],
  [/\b(layaway)\b/i, ['layaway']],
  [/\b(unlock)\b/i, ['unlock']],
  [/\b(special\s*order|orden\s*especial|pedido)\b/i, ['special_order']],
  [/\b(invoice|factura)\b/i, ['sale', 'invoice', 'phone_payment']],
  [/\b(phone\s*payment|pago\s*tel[eé]fono)\b/i, ['phone_payment']],
  [/\b(product|producto|inventory|inventario)\b/i, ['inventory_product']],
  [/\b(employee|empleado)\b/i, ['employee']],
];

const STOPWORDS = new Set([
  'a', 'an', 'the', 'for', 'from', 'of', 'with', 'on', 'in', 'to', 'and',
  'de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'para', 'por', 'con',
  'do', 'da', 'dos', 'das', 'um', 'uma',
]);

function cleanQ(s: string): string {
  return s.toLowerCase().replace(/[¿?¡!.,;:]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function resolveEntityIntent(
  rawQuery: string,
  engine: IntelligenceEngine,
): EntityIntentResult {
  const q = cleanQ(rawQuery);
  if (q.length < 2) return { entity: null, candidates: [], confidence: 0 };

  // 1. Detect action verb
  let action: EntityAction | undefined;
  let stripped = q;
  for (const [re, act] of VERB_ACTION) {
    if (re.test(q)) {
      action = act;
      stripped = q.replace(re, '').trim();
      break;
    }
  }

  // 2. Detect kind hints
  const kindFilter: EntityKind[] = [];
  let entityFragment = stripped;
  for (const [re, kinds] of KIND_HINT_MAP) {
    if (re.test(entityFragment)) {
      entityFragment = entityFragment.replace(re, ' ').replace(/\s+/g, ' ').trim();
      for (const k of kinds) {
        if (!kindFilter.includes(k)) kindFilter.push(k);
      }
    }
  }

  // 3. Strip stopwords
  const searchFragment = entityFragment
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOPWORDS.has(t))
    .join(' ')
    .trim();

  if (!searchFragment || searchFragment.length < 2) {
    return { entity: null, candidates: [], action, confidence: 0 };
  }

  // 4. Search all entities
  let results = searchOperationalEntities(searchFragment, engine);

  // 5. Filter by kind (fall back to unfiltered if filter yields nothing)
  if (kindFilter.length > 0) {
    const filtered = results.filter(e => kindFilter.includes(e.kind));
    if (filtered.length > 0) results = filtered;
  }

  if (results.length === 0) {
    return { entity: null, candidates: [], action, confidence: 0 };
  }

  return {
    entity: results[0],
    candidates: results.slice(0, 8),
    action,
    confidence: results.length === 1 ? 0.95 : 0.75,
  };
}
