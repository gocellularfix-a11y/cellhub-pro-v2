// ============================================================
// CellHub Business Language Engine — dictionary & taxonomy (I3-1)
//
// Describes business CONCEPTS and their relationships across EN/ES/PT — not a
// flat thesaurus. Every term is stored accent-FOLDED + lowercase (matching
// runs on the normalized/folded text). Longest-phrase-wins precedence is
// applied by the recognizer, so multi-word concepts ("net sales", "total
// collected") beat bare terms ("sales", "collected"). No money, no runtime
// store data here — configured carriers/providers/employees/etc. are injected
// at parse time (RuntimeEntitySet).
// ============================================================

import type {
  BusinessMetric, BusinessDimension, DateRangeKind, BusinessComparison, BusinessLanguage,
} from './types';

export interface TermGroup<T> {
  value: T;
  terms: string[];   // accent-folded, lowercase; may be multi-word phrases
}

// ── Metrics ─────────────────────────────────────────────────
// Order matters ONLY as documentation; the recognizer sorts by phrase length.
export const METRIC_TERMS: ReadonlyArray<TermGroup<BusinessMetric>> = [
  // Customer-scoped (multi-word — resolved before bare profit/margin/revenue)
  { value: 'total_collected', terms: ['total collected', 'total cobrado', 'total recebido', 'totally collected', 'spent the most', 'spent', 'spend', 'gastaron', 'gasto mas', 'gastaram', 'gastou mais'] },
  { value: 'commissionable_revenue', terms: [
    'commissionable revenue', 'commissionable', 'profit-bearing revenue', 'profit bearing revenue',
    'ingreso comisionable', 'base comisionable', 'revenue comisionable',
    'receita comissionavel', 'comissionavel',
  ] },
  { value: 'customer_profit', terms: ['customer profit', 'profit per customer', 'ganancia del cliente', 'ganancia por cliente', 'lucro do cliente', 'lucro por cliente'] },
  { value: 'customer_margin', terms: ['customer margin', 'margin per customer', 'margen del cliente', 'margem do cliente'] },

  // Sales revenue family (net/gross before bare)
  { value: 'net_sales', terms: ['net sales', 'net revenue', 'ventas netas', 'ingreso neto', 'ingresos netos', 'vendas liquidas', 'receita liquida', 'net after returns', 'neto despues de devoluciones'] },
  { value: 'gross_sales', terms: ['gross sales', 'gross revenue', 'ventas brutas', 'ingreso bruto', 'ingresos brutos', 'vendas brutas', 'receita bruta'] },

  // Returns / refunds
  { value: 'returns', terms: ['returns', 'refunds', 'return', 'refund', 'devoluciones', 'reembolsos', 'devolucion', 'reembolso', 'devolucoes', 'reembolsos', 'devolucao'] },

  // Cost / profit / margin
  { value: 'cost', terms: ['cost', 'costs', 'cogs', 'cost of goods', 'costo', 'costos', 'coste', 'custo', 'custos'] },
  { value: 'margin', terms: ['margin', 'margen', 'margem', 'markup'] },
  { value: 'profit', terms: ['profit', 'profits', 'ganancia', 'ganancias', 'utilidad', 'utilidades', 'lucro', 'lucros'] },

  // Tax (net/gross before bare)
  { value: 'net_tax', terms: ['net tax', 'impuesto neto', 'imposto liquido'] },
  { value: 'gross_tax', terms: ['gross tax', 'tax collected', 'impuesto bruto', 'impuesto recaudado', 'imposto bruto', 'imposto arrecadado'] },

  // Tender
  { value: 'cash', terms: ['cash', 'efectivo', 'dinheiro', 'em dinheiro'] },
  { value: 'card', terms: ['card', 'credit card', 'debit card', 'tarjeta', 'cartao', 'cartao de credito', 'no cartao'] },
  { value: 'store_credit', terms: ['store credit', 'credito de tienda', 'credito da loja', 'credito de la tienda'] },

  // Counts / averages / interactions
  { value: 'transaction_count', terms: ['transaction count', 'number of transactions', 'transactions', 'transaction', 'transacciones', 'transaccion', 'numero de transacciones', 'transacoes', 'transacao', 'numero de transacoes'] },
  { value: 'average_ticket', terms: ['average ticket', 'avg ticket', 'average transaction', 'ticket promedio', 'ticket medio', 'ticket promedio de venta', 'ticket medio de venda'] },
  { value: 'interactions', terms: ['interactions', 'interaction', 'interacciones', 'interaccion', 'interacoes', 'interacao'] },

  // Bare revenue/sales terms (loosest — default handled in the parser)
  { value: 'gross_sales', terms: ['sales', 'sale', 'sold', 'revenue', 'ventas', 'venta', 'vendio', 'vendido', 'vendi', 'vendimos', 'ingresos', 'ingreso', 'vendas', 'venda', 'vendeu', 'vendemos', 'receita', 'faturamento'] },
  // Bare tax term (default handled in the parser)
  { value: 'net_tax', terms: ['tax', 'taxes', 'impuesto', 'impuestos', 'imposto', 'impostos'] },
];

/** Bare terms whose metric is a DEFAULT interpretation (parser records an
 *  assumption when only these fired). */
export const BARE_METRIC_TERMS: ReadonlySet<string> = new Set([
  'sales', 'sale', 'sold', 'revenue', 'ventas', 'venta', 'vendio', 'vendido', 'vendi', 'vendimos',
  'ingresos', 'ingreso', 'vendas', 'venda', 'vendeu', 'vendemos', 'receita', 'faturamento',
  'tax', 'taxes', 'impuesto', 'impuestos', 'imposto', 'impostos',
]);

// ── Dimensions ──────────────────────────────────────────────
export const DIMENSION_TERMS: ReadonlyArray<TermGroup<BusinessDimension>> = [
  // payment_provider BEFORE carrier so "payment provider" wins; bare
  // "provider/proveedor" → payment_provider (literal), carrier is a distinct
  // concept. (Carrier vs provider ambiguity is flagged in the parser.)
  { value: 'payment_provider', terms: ['payment provider', 'payment providers', 'payment platform', 'payment platforms', 'proveedor de pago', 'proveedores de pago', 'plataforma de pago', 'provedor de pagamento', 'plataforma de pagamento', 'provider', 'providers', 'proveedor', 'proveedores', 'provedor', 'provedores'] },
  { value: 'carrier', terms: ['carrier', 'carriers', 'compania', 'companias', 'company', 'operadora', 'operadoras', 'wireless carrier'] },
  { value: 'payment_method', terms: ['payment method', 'payment methods', 'metodo de pago', 'forma de pago', 'formas de pago', 'metodo de pagamento', 'forma de pagamento', 'tender'] },
  { value: 'category', terms: ['category', 'categories', 'categoria', 'categorias'] },
  { value: 'employee', terms: ['employee', 'employees', 'empleado', 'empleados', 'funcionario', 'funcionarios', 'vendedor', 'vendedores', 'seller', 'sellers', 'cashier', 'cajero'] },
  { value: 'customer', terms: ['customer', 'customers', 'cliente', 'clientes'] },
  { value: 'product', terms: ['product', 'products', 'producto', 'productos', 'produto', 'produtos', 'item', 'items', 'sku'] },
  { value: 'service', terms: ['service', 'services', 'servicio', 'servicios', 'servico', 'servicos'] },
  { value: 'store', terms: ['store', 'stores', 'tienda', 'tiendas', 'loja', 'lojas', 'location', 'locations', 'sucursal', 'sucursales'] },
];

// ── Date ranges ─────────────────────────────────────────────
export const DATE_RANGE_TERMS: ReadonlyArray<TermGroup<DateRangeKind>> = [
  { value: 'last_week', terms: ['last week', 'la semana pasada', 'semana pasada', 'semana passada'] },
  { value: 'this_week', terms: ['this week', 'esta semana', 'nesta semana', 'na semana'] },
  { value: 'last_month', terms: ['last month', 'el mes pasado', 'mes pasado', 'mes passado'] },
  { value: 'this_month', terms: ['this month', 'este mes', 'neste mes', 'deste mes', 'no mes', 'do mes'] },
  { value: 'yesterday', terms: ['yesterday', 'ayer', 'ontem'] },
  { value: 'today', terms: ['today', 'hoy', 'hoje'] },
  { value: 'all_time', terms: ['all time', 'all-time', 'todo el tiempo', 'desde siempre', 'historico', 'sempre', 'desde sempre', 'de sempre'] },
];

// ── Comparison / ranking ────────────────────────────────────
export const COMPARISON_TERMS: ReadonlyArray<TermGroup<BusinessComparison>> = [
  { value: 'versus_previous_period', terms: ['previous period', 'periodo anterior', 'vs last', 'versus', 'compared to', 'compare', 'compara', 'comparar', 'comparacion', 'comparacao', ' vs ', 'contra el', 'em relacao'] },
  { value: 'highest', terms: ['highest', 'the most', 'most', 'best', 'top', 'mas', 'mais', 'mayor', 'mejor', 'mas alto', 'que mas', 'maior', 'melhor', 'mais alto', 'que mais'] },
  { value: 'lowest', terms: ['lowest', 'the least', 'least', 'worst', 'menos', 'menor', 'peor', 'mas bajo', 'que menos', 'pior', 'mais baixo'] },
  { value: 'increase', terms: ['increase', 'increased', 'increasing', 'growing', 'grew', 'went up', 'subio', 'aumento', 'crecio', 'creciendo', 'aumentou', 'subiu', 'cresceu'] },
  { value: 'decrease', terms: ['decrease', 'decreased', 'declining', 'dropped', 'drop', 'went down', 'fell', 'bajo', 'cayo', 'disminuyo', 'bajaron', 'caiu', 'baixou', 'diminuiu'] },
];

/** Ranking comparisons that imply intent = rank_dimension when a dimension is present. */
export const RANKING_COMPARISONS: ReadonlySet<BusinessComparison> = new Set<BusinessComparison>(['highest', 'lowest']);

/** Explicit "more than / less than" filters — recognized as terms but NOT a
 *  comparison enum value (they filter, not rank). Kept for matchedTerms/ambiguity. */
export const FILTER_TERMS: readonly string[] = ['more than', 'less than', 'greater than', 'mas de', 'menos de', 'mais de', 'menos de', 'over', 'under'];

// ── Summarize / find-customer intent markers ────────────────
export const SUMMARIZE_TERMS: readonly string[] = ['breakdown', 'break down', 'by', 'per', 'summary', 'summarize', 'desglose', 'desglosar', 'por', 'resumen', 'distribucion', 'distribuicao', 'por cada'];
export const FIND_CUSTOMER_TERMS: readonly string[] = ['find customer', 'find the customer', 'look up customer', 'search customer', 'customer named', 'buscar cliente', 'buscar al cliente', 'encontrar cliente', 'cliente llamado', 'procurar cliente', 'cliente chamado'];

// ── Phone-store concepts (tag → dimension/metric hint) ──────
// Support the phone-store vocabulary; each maps to the dimension/metric the
// concept most naturally belongs to. Used to set dimension hints + matchedTerms.
export interface PhoneStoreConcept {
  terms: string[];
  dimension?: BusinessDimension;
  metric?: BusinessMetric;
  concept: string;
}
export const PHONE_STORE_CONCEPTS: ReadonlyArray<PhoneStoreConcept> = [
  { concept: 'accessory', terms: ['accessory', 'accessories', 'accesorio', 'accesorios', 'acessorio', 'acessorios'], dimension: 'category' },
  { concept: 'repair', terms: ['repair', 'repairs', 'reparacion', 'reparaciones', 'reparo', 'reparos', 'conserto'], dimension: 'service' },
  { concept: 'unlock', terms: ['unlock', 'unlocks', 'desbloqueo', 'desbloqueos', 'liberacion'], dimension: 'service' },
  { concept: 'activation', terms: ['activation', 'activations', 'activacion', 'activaciones', 'ativacao', 'ativacoes'], dimension: 'category' },
  { concept: 'phone_payment', terms: ['phone payment', 'phone payments', 'bill payment', 'pago de telefono', 'pago de linea', 'pagamento de telefone', 'pagamento de conta'], dimension: 'category' },
  { concept: 'topup', terms: ['top up', 'top-up', 'topup', 'recarga', 'recargas'], dimension: 'category' },
  { concept: 'layaway', terms: ['layaway', 'layaways', 'apartado', 'apartados', 'crediario'], dimension: 'category' },
  { concept: 'special_order', terms: ['special order', 'special orders', 'pedido especial', 'pedidos especiales', 'encomenda'], dimension: 'category' },
  { concept: 'exchange', terms: ['exchange', 'exchanges', 'cambio', 'cambios', 'troca', 'trocas'] },
  { concept: 'inventory', terms: ['inventory', 'stock', 'inventario', 'estoque'], dimension: 'product' },
  { concept: 'device', terms: ['device', 'devices', 'phone', 'phones', 'dispositivo', 'dispositivos', 'telefono', 'telefonos', 'celular', 'celulares', 'aparelho'], dimension: 'product' },
  { concept: 'line', terms: ['line', 'lines', 'linea', 'lineas', 'linha', 'linhas'], dimension: 'category' },
];

// ── Language detection markers ──────────────────────────────
// Deterministic, high-signal function words per language (accent-folded).
export const LANGUAGE_MARKERS: Record<BusinessLanguage, readonly string[]> = {
  es: ['cuanto', 'cual', 'cuales', 'quien', 'que', 'como', 'hoy', 'ayer', 'ventas', 'ganancia', 'cuanto vendi', 'el mes', 'la semana', 'del', 'mas', 'mejor', 'compania', 'efectivo', 'cobramos', 'vendimos'],
  pt: ['quanto', 'qual', 'quais', 'quem', 'como', 'hoje', 'ontem', 'vendas', 'lucro', 'este mes', 'a semana', 'melhor', 'operadora', 'dinheiro', 'recebemos', 'vendemos', 'faturamento'],
  en: ['how', 'much', 'what', 'which', 'who', 'today', 'yesterday', 'sales', 'profit', 'this month', 'last week', 'best', 'carrier', 'cash', 'show', 'were'],
};

// ── Month names for explicit custom ranges (folded) ─────────
export const MONTH_NAMES: Record<string, number> = {
  // EN
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  // ES (april/august shared with PT below)
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  // PT (folded: março→marco). abril=4 and agosto=8 already defined (same value).
  janeiro: 1, fevereiro: 2, marco: 3, maio: 5, junho: 6, julho: 7, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};
