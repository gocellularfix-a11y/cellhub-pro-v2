// ============================================================
// CellHub Intelligence — routeIntelligenceRequest() V1 (SHADOW MODE)
// R-INTEL-ROUTER-V1
//
// PURE + DETERMINISTIC. No I/O, no Date.now(), no randomness, no store
// reads. Classifies how Intelligence should operate for a request.
//
// Safety defaults (per spec):
//   - computeBudget defaults to low; never escalates without cause.
//   - dataNeed defaults to snapshot/none; NEVER defaults to fullScan.
//   - fullScan + slow/unknown hardware → downgraded to targeted.
//   - write/delete/print/message/marketing/tax/financial → requireApproval.
//   - secondary terminal → unsafe execution is blocked (requireApproval).
//   - debugReason only emitted when devMode is true.
// ============================================================

import type {
  RouteIntelligenceInput,
  IntelligenceRoute,
  RouteIntent,
  RouteUrgency,
  RouteDataNeed,
  RouteComputeBudget,
  RouteExecutionMode,
  RouteMemoryPolicy,
} from './types';

// ── Keyword banks (lowercase, deterministic) ─────────────────

const DEV_RE       = /\b(debug|diagnostic|diagnostics|trace|route metadata|dev mode|devmode)\b/;
const TAX_RE       = /\b(tax|taxes|impuesto|impuestos|cdtfa|irs)\b/;
const REPORTS_RE   = /\b(report|reports|reporte|reportes|p&l|profit and loss|income statement|estado de resultados)\b/;
const MARKETING_RE = /\b(marketing|mercadeo|campaign|campaña|promo|promotion|promoci[oó]n|blast|outreach|discount|descuento|bundle|upsell|cross-sell)\b/;
const INVENTORY_RE = /\b(inventory|inventario|restock|reorder|reabastec|stock|dead stock|slow mover|reponer)\b/;
const CUSTOMER_RE  = /\b(customer|customers|cliente|clientes|churn|retention|retenci[oó]n|loyal|vip)\b/;
const SALES_RE     = /\b(sales|ventas|revenue|ingresos|sold|vendi|today.?s? sales|ventas de hoy)\b/;

const URGENT_RE    = /\b(urgent|urgente|asap|immediately|inmediato|right now|ahora mismo|critical|cr[ií]tico|emergency|emergencia)\b/;
const FULLSCAN_RE  = /\b(full scan|fullscan|full-scan|everything|all data|toda la data|deep scan|scan all|escaneo completo)\b/;

// Unsafe action categories — order defines requiresApprovalReason priority.
const UNSAFE_CATEGORIES: Array<{ reason: string; re: RegExp }> = [
  { reason: 'print',               re: /\b(print|imprimir|reprint)\b/ },
  { reason: 'messaging',           re: /\b(whatsapp|sms|email|e-mail|message|mensaje|notify|notificar|send|enviar|text)\b/ },
  { reason: 'marketing_generation',re: /\b(marketing|mercadeo|campaign|campaña|promo|promotion|promoci[oó]n|blast|outreach|discount|descuento|bundle)\b/ },
  { reason: 'tax_action',          re: /\b(tax|impuesto|cdtfa|irs)\b/ },
  { reason: 'financial_action',    re: /\b(refund|reembolso|payment|pago|payout|charge|cobro|invoice|factura|price|precio|financial|financiero)\b/ },
  { reason: 'export',              re: /\b(export|exportar|download|descargar)\b/ },
  { reason: 'write_delete',        re: /\b(delete|borrar|eliminar|remove|quitar|write|update|actualizar|edit|editar|create|crear|save|guardar|cancel|cancelar|void|anular|modify|modificar)\b/ },
];

function norm(s: string | undefined): string {
  return (s || '').toLowerCase();
}

// ── Intent classification (intentId hint first, then query) ──

function classifyIntent(intentId: string, q: string): RouteIntent {
  // intentId-based hints (stable, exact prefixes).
  if (intentId) {
    if (/^tax/.test(intentId)) return 'tax';
    if (/^(report|reports)/.test(intentId)) return 'reports';
    if (/(product_push|product_opportunit|marketing|campaign|outreach|promote)/.test(intentId)) return 'marketing';
    if (/(restock|inventory|dead_stock|dying|top_items|reorder)/.test(intentId)) return 'inventory';
    if (/(customer|best_customer|least_profitable|churn|retention|likely_to_buy|vip)/.test(intentId)) return 'customer';
    if (/(sales|today_sales|revenue)/.test(intentId)) return 'sales';
  }
  // query keyword fallback (deterministic precedence).
  if (DEV_RE.test(q)) return 'dev';
  if (TAX_RE.test(q)) return 'tax';
  if (REPORTS_RE.test(q)) return 'reports';
  if (MARKETING_RE.test(q)) return 'marketing';
  if (INVENTORY_RE.test(q)) return 'inventory';
  if (CUSTOMER_RE.test(q)) return 'customer';
  if (SALES_RE.test(q)) return 'sales';
  return 'general';
}

function detectUnsafe(s: string): string | null {
  for (const c of UNSAFE_CATEGORIES) {
    if (c.re.test(s)) return c.reason;
  }
  return null;
}

/**
 * Deterministically classify how an Intelligence request should operate.
 * Pure: no side effects, no time, no randomness.
 */
export function routeIntelligenceRequest(input: RouteIntelligenceInput): IntelligenceRoute {
  const source = input.source;
  const q = norm(input.query);
  const intentId = norm(input.intentId);
  // Normalize snake_case actionType so word boundaries match (e.g.
  // "send_whatsapp" → "send whatsapp" so /\bwhatsapp\b/ fires).
  const actionStr = `${norm(input.actionType)} ${q}`.replace(/_+/g, ' ');
  const hardwareTier = input.hardwareTier || 'unknown';
  const devMode = input.devMode === true;
  const hasApproval = input.hasApproval === true;
  const isSecondary = input.isSecondary === true;
  const isAction = source === 'action' || !!input.actionType;

  const intent = classifyIntent(intentId, q);

  // ── urgency ──────────────────────────────────────────────
  let urgency: RouteUrgency;
  if (URGENT_RE.test(q)) urgency = 'urgent';
  else if (source === 'system' || source === 'insight' || source === 'brief') urgency = 'passive';
  else urgency = 'normal';

  // ── dataNeed (never default to fullScan) ─────────────────
  let dataNeed: RouteDataNeed;
  if (FULLSCAN_RE.test(q)) {
    dataNeed = 'fullScan';
  } else if (intent === 'general') {
    dataNeed = 'none';
  } else if (intent === 'sales') {
    dataNeed = 'snapshot';
  } else {
    dataNeed = 'targeted'; // inventory, reports, tax, customer, marketing, dev
  }

  // fullScan downgrade on slow/unknown hardware.
  let downgradedFromFullScan: boolean | undefined;
  if (dataNeed === 'fullScan' && (hardwareTier === 'slow' || hardwareTier === 'unknown')) {
    dataNeed = 'targeted';
    downgradedFromFullScan = true;
  }

  // ── executionMode + approval ─────────────────────────────
  let executionMode: RouteExecutionMode;
  let requiresApprovalReason: string | undefined;
  const unsafe = detectUnsafe(actionStr);

  if (unsafe) {
    executionMode = hasApproval ? 'triggerModule' : 'requireApproval';
    if (!hasApproval) requiresApprovalReason = unsafe;
  } else if (intent === 'marketing') {
    // Marketing generation always requires approval.
    executionMode = hasApproval ? 'triggerModule' : 'requireApproval';
    if (!hasApproval) requiresApprovalReason = 'marketing_generation';
  } else if (intent === 'tax' && isAction) {
    executionMode = hasApproval ? 'triggerModule' : 'requireApproval';
    if (!hasApproval) requiresApprovalReason = 'tax_action';
  } else if (isAction) {
    // Safe (read-only) action.
    executionMode = hasApproval ? 'triggerModule' : 'suggestAction';
  } else if (intent === 'inventory') {
    executionMode = 'suggestAction';
  } else {
    // sales, customer, reports (read), tax (read), dev, general
    executionMode = 'answerOnly';
  }

  // Secondary terminal: never execute unsafe work — downgrade to approval.
  if (isSecondary && executionMode === 'triggerModule') {
    executionMode = 'requireApproval';
    requiresApprovalReason = requiresApprovalReason || 'secondary_unsafe';
  }

  const safeToRunOnSecondary =
    executionMode === 'answerOnly' || executionMode === 'suggestAction';

  // ── computeBudget (default low) ──────────────────────────
  let computeBudget: RouteComputeBudget;
  if (dataNeed === 'fullScan') {
    computeBudget = 'high';
  } else if (dataNeed === 'targeted' && (intent === 'reports' || intent === 'tax' || intent === 'marketing')) {
    computeBudget = 'medium';
  } else {
    computeBudget = 'low';
  }

  // ── memoryPolicy ─────────────────────────────────────────
  let memoryPolicy: RouteMemoryPolicy;
  if (executionMode === 'triggerModule') memoryPolicy = 'readWrite';
  else if (source === 'system') memoryPolicy = 'none';
  else if (intent === 'general') memoryPolicy = 'none';
  else memoryPolicy = 'read';

  // ── reason codes ─────────────────────────────────────────
  const reasonParts: string[] = [source, intent, executionMode];
  if (downgradedFromFullScan) reasonParts.push('downgraded');
  if (requiresApprovalReason) reasonParts.push(requiresApprovalReason);
  const reasonCode = reasonParts.join('.');

  const route: IntelligenceRoute = {
    intent,
    urgency,
    dataNeed,
    computeBudget,
    executionMode,
    memoryPolicy,
    safeToRunOnSecondary,
    reasonCode,
  };
  if (downgradedFromFullScan) route.downgradedFromFullScan = true;
  if (requiresApprovalReason) route.requiresApprovalReason = requiresApprovalReason;
  if (devMode) {
    route.debugReason =
      `[${source}] intent=${intent} urgency=${urgency} data=${dataNeed} ` +
      `budget=${computeBudget} exec=${executionMode} mem=${memoryPolicy} ` +
      `secondarySafe=${safeToRunOnSecondary}` +
      (downgradedFromFullScan ? ' (fullScan→targeted)' : '') +
      (requiresApprovalReason ? ` approval=${requiresApprovalReason}` : '');
  }
  return route;
}
