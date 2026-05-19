// INTELLIGENCE-OPERATIONAL-WORKFLOW-SESSIONS-V1
// Deterministic workflow intent resolver — keyword scoring only. No AI/NLP.

import type { OperationalWorkflowType } from './types';

export interface WorkflowIntentResult {
  type: OperationalWorkflowType | null;
  confidence: number;
  entityQuery: string;
}

const WORKFLOW_KEYWORDS: Record<OperationalWorkflowType, string[]> = {
  payment_collection: [
    'collect payment', 'cobrar pago', 'cobrar saldo', 'outstanding balance',
    'collect balance', 'collect from', 'cobrar a', 'collect money',
    'collect debt', 'cobrar deuda', 'follow up payment', 'payment due',
    'has balance', 'tiene saldo',
  ],
  repair_followup: [
    'follow up repair', 'seguimiento reparación', 'repair ticket',
    'follow up ticket', 'check repair', 'repair status', 'estado reparación',
    'seguimiento ticket', 'follow up on repair', 'repair follow',
  ],
  customer_outreach: [
    'contact customer', 'contactar cliente', 'reach out', 'message customer',
    'send message to', 'enviar mensaje', 'whatsapp customer', 'customer outreach',
    'outreach to', 'follow up customer', 'seguimiento cliente',
  ],
  inventory_promotion: [
    'promote product', 'promover producto', 'promote inventory', 'push product',
    'sell product', 'inventory promotion', 'promote stale', 'promote phone',
    'promote item', 'promover artículo', 'promote iphone', 'promote samsung',
  ],
};

// Patterns to strip when extracting the entity search fragment.
const STRIP_TOKENS = [
  'collect', 'cobrar', 'payment', 'pago', 'saldo', 'balance', 'debt', 'deuda',
  'follow up', 'seguimiento', 'repair', 'reparación', 'reparacion', 'ticket',
  'contact', 'contactar', 'reach out', 'message', 'mensaje', 'whatsapp',
  'promote', 'promover', 'product', 'producto', 'inventory', 'inventario',
  'stale', 'outreach', 'customer', 'cliente', 'from', 'on', 'for', 'to',
  'a', 'de', 'del', 'el', 'la', 'un', 'una',
];

function normQ(s: string): string {
  return s.toLowerCase().trim()
    .normalize('NFD')
    // eslint-disable-next-line no-misleading-character-class
    .replace(/[̀-ͯ]/g, '')
    .replace(/[¿?¡!.,;:]/g, ' ')
    .replace(/\s+/g, ' ');
}

function scoreKeywords(query: string, keywords: string[]): number {
  let hits = 0;
  for (const kw of keywords) if (query.includes(kw)) hits++;
  return hits;
}

function extractEntityQuery(raw: string, type: OperationalWorkflowType): string {
  let q = normQ(raw);
  // Strip workflow-type keywords first (longest first to avoid partial matches)
  const sorted = [...WORKFLOW_KEYWORDS[type]].sort((a, b) => b.length - a.length);
  for (const kw of sorted) {
    q = q.replace(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), ' ');
  }
  // Strip common stop tokens
  for (const tok of STRIP_TOKENS) {
    q = q.replace(new RegExp(`\\b${tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), ' ');
  }
  return q.replace(/\s+/g, ' ').trim();
}

export function resolveWorkflowIntent(rawQuery: string): WorkflowIntentResult {
  const q = normQ(rawQuery);

  let bestType: OperationalWorkflowType | null = null;
  let bestScore = 0;

  const types = Object.keys(WORKFLOW_KEYWORDS) as OperationalWorkflowType[];
  for (const type of types) {
    const score = scoreKeywords(q, WORKFLOW_KEYWORDS[type]);
    if (score > bestScore) {
      bestScore = score;
      bestType = type;
    }
  }

  if (!bestType || bestScore === 0) {
    return { type: null, confidence: 0, entityQuery: '' };
  }

  // 1 hit → 0.4, 2 hits → 0.8, 3+ → 1.0
  const confidence = Math.min(bestScore * 0.4, 1.0);
  const entityQuery = extractEntityQuery(rawQuery, bestType);

  return { type: bestType, confidence, entityQuery };
}
