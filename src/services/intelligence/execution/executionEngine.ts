// R-INTELLIGENCE-AUTOMATED-EXECUTION-V1
// Execution preparation layer — derives execution-ready actions from the
// proactive report. No AI, no auto-send, no external API calls.
// V1 prepares draft messages only. Operator triggers all sends manually.

import type { Sale, Repair, Customer, InventoryItem, Layaway } from '@/store/types';
import type { ReorderRecommendation } from '../types';
import type { PreparedExecution, ExecutionReport, ExecutionCategory } from './types';
import type { ProactiveAction } from '../proactive/types';
import { generateProactiveOperationsReport, type ProactiveEvalContext } from '../proactive/proactiveEngine';

// Re-export so callers importing ProactiveEvalContext from this module keep working
export type { ProactiveEvalContext };

// ── Structural context interface ───────────────────────────────────────────────
// Satisfied by IntelligenceEngine without a direct import (avoids circular dep).
export interface ExecutionEvalContext {
  getSales(): Sale[];
  getRepairs(): Repair[];
  getCustomers(): Customer[];
  getInventory(): InventoryItem[];
  getLayaways(): Layaway[];
  getReorderRecommendations(): ReorderRecommendation[];
}

type Lang = 'en' | 'es' | 'pt';

// ── Message templates ─────────────────────────────────────────────────────────
// Pure string builders — no side effects, no store writes.

function repairFollowupMessage(customerName: string, lang: Lang): string {
  if (lang === 'es') {
    return `Hola ${customerName}, le contactamos de Go Cellular para informarle que su reparación está lista o tiene una actualización disponible. Puede pasar en cualquier momento. ¿Tiene alguna pregunta?`;
  }
  return `Hi ${customerName}, this is Go Cellular reaching out about your device repair. We have an update ready for you. Feel free to stop by anytime or let us know if you have questions!`;
}

function collectionMessage(customerName: string, balanceDollars: string, lang: Lang): string {
  if (lang === 'es') {
    return `Hola ${customerName}, le recordamos de parte de Go Cellular que tiene un saldo pendiente de ${balanceDollars}. Para mayor comodidad puede pasar a la tienda o contactarnos. ¡Gracias!`;
  }
  return `Hi ${customerName}, this is a friendly reminder from Go Cellular about your outstanding balance of ${balanceDollars}. You can stop by the store or contact us at your convenience. Thank you!`;
}

function vipRecoveryMessage(customerName: string, lang: Lang): string {
  if (lang === 'es') {
    return `Hola ${customerName}, hace tiempo que no lo vemos en Go Cellular y queremos saludarle. Tenemos nuevos productos y promociones que pueden interesarle. ¡Será un gusto atenderle!`;
  }
  return `Hi ${customerName}, we haven't seen you in a while at Go Cellular and wanted to say hello! We have some great new products and deals we think you'd love. Hope to see you soon!`;
}

function approvalReviewMessage(count: number, lang: Lang): string {
  if (lang === 'es') {
    return count === 1
      ? 'Hay 1 elemento pendiente de aprobación en la cola del gerente. Favor de revisar.'
      : `Hay ${count} elementos pendientes de aprobación en la cola del gerente. Favor de revisar.`;
  }
  return count === 1
    ? 'There is 1 item pending manager approval. Please review the manager queue.'
    : `There are ${count} items pending manager approval. Please review the manager queue.`;
}

function inventoryOrderMessage(itemName: string, qty: number, lang: Lang): string {
  if (lang === 'es') {
    return `Recordatorio de inventario: ${itemName} está por debajo del mínimo. Se recomienda ordenar ${qty} unidades para evitar quiebre de stock.`;
  }
  return `Inventory reminder: ${itemName} is below minimum stock. Ordering ${qty} units is recommended to prevent a stockout.`;
}

// ── Category mapping ──────────────────────────────────────────────────────────

function proactiveCategoryToExecution(category: string): ExecutionCategory | null {
  switch (category) {
    case 'repair_followup': return 'repair_followup';
    case 'collection':      return 'collection';
    case 'vip_retention':   return 'vip_recovery';
    case 'approval':        return 'approval_review';
    case 'inventory':       return 'inventory_order';
    default: return null;
  }
}

// ── Build a PreparedExecution from a ProactiveAction ─────────────────────────

function buildExecution(
  action: ProactiveAction,
  customerMap: Map<string, Customer>,
  lang: Lang,
  now: number,
): PreparedExecution | null {
  const execCat = proactiveCategoryToExecution(action.category);
  if (!execCat) return null;

  const customer = action.entityId && action.entityType === 'customer'
    ? customerMap.get(action.entityId)
    : action.entityId && (action.entityType === 'repair' || action.entityType === 'layaway')
    ? (() => {
        // For entity-linked actions, find the customer by iterating the map
        // (customer is already resolved in title from proactiveEngine)
        return undefined;
      })()
    : undefined;

  const customerName = customer?.name
    ?? action.title.split(' —')[0].trim()
    ?? (lang === 'es' ? 'Cliente' : 'Customer');

  const customerPhone = customer?.phone ?? '';

  let draftMessage: string;

  switch (execCat) {
    case 'repair_followup':
      draftMessage = repairFollowupMessage(customerName, lang);
      break;
    case 'collection': {
      const impactStr = action.estimatedImpactCents
        ? `$${(action.estimatedImpactCents / 100).toFixed(2)}`
        : (lang === 'es' ? 'el saldo pendiente' : 'your balance');
      draftMessage = collectionMessage(customerName, impactStr, lang);
      break;
    }
    case 'vip_recovery':
      draftMessage = vipRecoveryMessage(customerName, lang);
      break;
    case 'approval_review': {
      const countMatch = action.title.match(/\d+/);
      const count = countMatch ? parseInt(countMatch[0], 10) : 1;
      draftMessage = approvalReviewMessage(count, lang);
      break;
    }
    case 'inventory_order': {
      const qtyMatch = action.recommendedAction.match(/(\d+)\s+unit/i)
        ?? action.recommendedAction.match(/(\d+)\s+unidad/i);
      const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
      const name = action.title.replace(/^.*?—\s*/, '').replace(/\s*\(\d+.*$/, '').trim();
      draftMessage = inventoryOrderMessage(name, qty, lang);
      break;
    }
  }

  return {
    id: `exec-${action.id}`,
    category: execCat,
    priority: action.priority,
    entityType: action.entityType,
    entityId: action.entityId,
    customerName,
    customerPhone: customerPhone as string,
    draftMessage,
    reason: action.reason,
    estimatedImpactCents: action.estimatedImpactCents,
    confidence: action.confidence,
    createdAt: now,
  };
}

// ── Summary builder ───────────────────────────────────────────────────────────

function buildSummary(executions: PreparedExecution[], totalCents: number, lang: Lang): string {
  if (executions.length === 0) {
    return lang === 'es'
      ? 'No hay acciones listas para preparar en este momento.'
      : 'No actions ready to prepare at this time.';
  }
  const es = lang !== 'en';
  const n = executions.length;
  const s = (x: number) => x !== 1;
  if (totalCents > 0) {
    const dollars = `$${(totalCents / 100).toFixed(0)}`;
    return es
      ? `${n} mensaje${s(n) ? 's' : ''} listo${s(n) ? 's' : ''} para enviar — ${dollars} potencialmente recuperable.`
      : `${n} message${s(n) ? 's' : ''} ready to send — ${dollars} potentially recoverable.`;
  }
  return es
    ? `${n} acción${s(n) ? 'es' : ''} lista${s(n) ? 's' : ''} para ejecutar.`
    : `${n} action${s(n) ? 's' : ''} ready to execute.`;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function generatePreparedExecutions(
  ctx: ExecutionEvalContext,
  lang: Lang,
): ExecutionReport {
  const now = Date.now();

  // Reuse the proactive report — no duplicate scanning.
  // Cast: ExecutionEvalContext satisfies ProactiveEvalContext structurally.
  const proactive = generateProactiveOperationsReport(
    ctx as unknown as ProactiveEvalContext,
    lang,
  );

  const customerMap = new Map(ctx.getCustomers().map(c => [c.id, c]));

  const executions: PreparedExecution[] = [];
  for (const action of proactive.actions) {
    const exec = buildExecution(action, customerMap, lang, now);
    if (exec) executions.push(exec);
  }

  const totalEstimatedImpactCents = executions.reduce(
    (s, e) => s + (e.estimatedImpactCents ?? 0),
    0,
  );

  return {
    generatedAt: now,
    summary: buildSummary(executions, totalEstimatedImpactCents, lang),
    executions,
    topExecution: executions[0],
    totalEstimatedImpactCents,
  };
}
