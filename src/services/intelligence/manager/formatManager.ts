// ============================================================
// Business Manager — presenter (I4).
//
// The ONLY place manager structures become text. EN/ES/PT rule templates —
// no generated language. Reuses the insights presenter for finding lines.
// ============================================================

import type { BusinessLanguage } from '../language/types';
import { formatFinding } from '../insights/formatFindings';
import type { InsightFinding } from '../insights/types';
import type {
  BusinessBrief, BusinessAction, BusinessActionKind, ExecutiveSummaryItem, HealthSection,
} from './types';

type L3 = BusinessLanguage;

const METRIC_WORDS: Record<string, Record<L3, string>> = {
  gross_sales: { en: 'Sales', es: 'Ventas', pt: 'Vendas' },
  profit: { en: 'Profit', es: 'Ganancia', pt: 'Lucro' },
  margin: { en: 'Margin', es: 'Margen', pt: 'Margem' },
};
const POPULATION_WORDS: Record<string, Record<L3, string>> = {
  repairs: { en: 'Repairs', es: 'Reparaciones', pt: 'Reparos' },
  unlocks: { en: 'Unlocks', es: 'Liberaciones', pt: 'Desbloqueios' },
  phone_payments: { en: 'Phone payments', es: 'Pagos de teléfono', pt: 'Pagamentos de telefone' },
  activations: { en: 'Activations', es: 'Activaciones', pt: 'Ativações' },
};

export function formatSummaryItem(item: ExecutiveSummaryItem, lang: L3): string {
  const d = item.data;
  switch (item.kind) {
    case 'metric_direction': {
      const word = METRIC_WORDS[String(d.metric)]?.[lang] ?? String(d.metric);
      const dir = d.direction === 'up'
        ? (lang === 'es' ? 'subieron' : lang === 'pt' ? 'subiram' : 'increased')
        : d.direction === 'down'
          ? (lang === 'es' ? 'bajaron' : lang === 'pt' ? 'caíram' : 'decreased')
          : (lang === 'es' ? 'estables' : lang === 'pt' ? 'estáveis' : 'stable');
      // Singular metric verbs for profit/margin in ES/PT.
      if (d.metric !== 'gross_sales' && lang !== 'en') {
        const dirSingular = d.direction === 'up' ? (lang === 'es' ? 'subió' : 'subiu')
          : d.direction === 'down' ? (lang === 'es' ? 'bajó' : 'caiu')
          : (lang === 'es' ? 'estable' : 'estável');
        return `${word} ${dirSingular}.`;
      }
      return `${word} ${dir}.`;
    }
    case 'carrier_strongest_growth':
      return lang === 'es' ? `${d.carrier}: el mayor crecimiento.` : lang === 'pt' ? `${d.carrier}: o maior crescimento.` : `${d.carrier}: strongest growth.`;
    case 'service_declined': {
      const pop = POPULATION_WORDS[String(d.population)]?.[lang] ?? String(d.population);
      return lang === 'es' ? `${pop} en declive.` : lang === 'pt' ? `${pop} em declínio.` : `${pop} declined.`;
    }
    case 'service_grew': {
      const pop = POPULATION_WORDS[String(d.population)]?.[lang] ?? String(d.population);
      return lang === 'es' ? `${pop} creció.` : lang === 'pt' ? `${pop} cresceu.` : `${pop} grew.`;
    }
    case 'customer_returned':
      return lang === 'es' ? `${d.name} volvió después de ${d.absenceDays} días.`
        : lang === 'pt' ? `${d.name} voltou depois de ${d.absenceDays} dias.`
        : `${d.name} returned after ${d.absenceDays} days.`;
    case 'customers_lost':
      return lang === 'es' ? `${d.count} cliente(s) sin regresar hace más de 90 días.`
        : lang === 'pt' ? `${d.count} cliente(s) sem voltar há mais de 90 dias.`
        : `${d.count} customer(s) have not returned in 90+ days.`;
    case 'no_significant_changes':
      return lang === 'es' ? 'Sin cambios significativos.' : lang === 'pt' ? 'Sem mudanças significativas.' : 'No significant changes.';
    default:
      return '';
  }
}

const ACTION_WORDS: Record<BusinessActionKind, Record<L3, string>> = {
  review_inventory_pricing: { en: 'Review inventory pricing', es: 'Revisar precios del inventario', pt: 'Revisar preços do estoque' },
  compare_carrier_previous_period: { en: 'Compare the carrier against the previous period', es: 'Comparar la compañía contra el período anterior', pt: 'Comparar a operadora com o período anterior' },
  contact_customer: { en: 'Contact the customer', es: 'Contactar al cliente', pt: 'Entrar em contato com o cliente' },
  review_service_promotion: { en: 'Review service advertising/promotion', es: 'Revisar la promoción del servicio', pt: 'Revisar a divulgação do serviço' },
  review_pricing_and_costs: { en: 'Review pricing and costs', es: 'Revisar precios y costos', pt: 'Revisar preços e custos' },
  review_day_operations: { en: 'Review store operations for the period', es: 'Revisar la operación de la tienda en el período', pt: 'Revisar a operação da loja no período' },
  review_refunds: { en: 'Review the refunds of the period', es: 'Revisar las devoluciones del período', pt: 'Revisar as devoluções do período' },
  review_employee_activity: { en: 'Review employee activity', es: 'Revisar la actividad del empleado', pt: 'Revisar a atividade do funcionário' },
  thank_returning_customer: { en: 'Welcome the returning customer', es: 'Dar seguimiento al cliente que volvió', pt: 'Acompanhar o cliente que voltou' },
  lean_into_carrier_growth: { en: 'Lean into the growing carrier', es: 'Aprovechar el crecimiento de la compañía', pt: 'Aproveitar o crescimento da operadora' },
};

export function formatAction(action: BusinessAction, lang: L3): string {
  const base = ACTION_WORDS[action.kind][lang];
  const who = action.data.name || action.data.customer || action.data.carrier || action.data.employee || action.data.product || action.data.population;
  return who ? `${base}: ${who}` : base;
}

export function formatHealthSection(section: HealthSection, lang: L3): string {
  const KEY: Record<HealthSection['key'], Record<L3, string>> = {
    revenue: { en: 'Revenue', es: 'Ventas', pt: 'Vendas' },
    profit: { en: 'Profit', es: 'Ganancia', pt: 'Lucro' },
    margin: { en: 'Margin', es: 'Margen', pt: 'Margem' },
    customers: { en: 'Customers', es: 'Clientes', pt: 'Clientes' },
    employees: { en: 'Employees', es: 'Empleados', pt: 'Funcionários' },
    inventory: { en: 'Inventory', es: 'Inventario', pt: 'Estoque' },
    services: { en: 'Services', es: 'Servicios', pt: 'Serviços' },
    carriers: { en: 'Carriers', es: 'Compañías', pt: 'Operadoras' },
  };
  const STATUS: Record<HealthSection['status'], Record<L3, string>> = {
    healthy: { en: 'Healthy', es: 'Saludable', pt: 'Saudável' },
    watch: { en: 'Watch', es: 'Vigilar', pt: 'Atenção' },
    critical: { en: 'Critical', es: 'Crítico', pt: 'Crítico' },
    // I4.1: unavailable is presented HONESTLY — never as healthy/all-clear.
    unavailable: {
      en: 'Not enough information to evaluate this area',
      es: 'No hay suficiente información para evaluar esta área',
      pt: 'Não há informações suficientes para avaliar esta área',
    },
  };
  return `${KEY[section.key][lang]}: ${STATUS[section.status][lang]}`;
}

/** Full chat-facing brief ("What should I focus on today?"). */
export function formatBusinessBrief(brief: BusinessBrief, lang: L3, findingsById: Map<string, InsightFinding>): string {
  const lines: string[] = [];
  const H = (en: string, es: string, pt: string) => (lang === 'es' ? es : lang === 'pt' ? pt : en);

  lines.push(H('📋 Business brief', '📋 Resumen del negocio', '📋 Resumo do negócio'));
  lines.push(...brief.executiveSummary.map((i) => `• ${formatSummaryItem(i, lang)}`));

  // I4.1.4: the score NEVER renders without its evidence confidence — the
  // score is performance; confidence is how complete the supporting evidence
  // is. Confidence renders as a deterministic whole percentage (0..1 → %),
  // never a raw decimal.
  const score = brief.score.score;
  const confidencePct = Math.round(brief.score.confidence * 100);
  lines.push(`${H('Performance score', 'Puntuación de desempeño', 'Pontuação de desempenho')}: ${score}/100`);
  lines.push(`${H('Evidence confidence', 'Confianza de la evidencia', 'Confiança das evidências')}: ${confidencePct}%`);

  const attention = brief.health.filter((h) => h.status === 'watch' || h.status === 'critical');
  if (attention.length > 0) {
    lines.push(H('Attention areas:', 'Áreas de atención:', 'Áreas de atenção:'));
    lines.push(...attention.map((h) => `• ${formatHealthSection(h, lang)}`));
  }
  // I4.1: unavailable areas surface as an honest data notice — never healthy.
  const unavailable = brief.health.filter((h) => h.status === 'unavailable');
  if (unavailable.length > 0) {
    lines.push(H('Not enough information for:', 'Sin información suficiente para:', 'Sem informações suficientes para:'));
    lines.push(...unavailable.map((h) => `• ${formatHealthSection(h, lang).split(':')[0]}`));
  }

  const alerts = [...brief.criticalAlerts, ...brief.warnings].slice(0, 3);
  if (alerts.length > 0) {
    lines.push(H('Alerts:', 'Alertas:', 'Alertas:'));
    lines.push(...alerts.map((f) => `• ${formatFinding(f, lang)}`));
  }

  const actions = brief.recommendedActions.slice(0, 3);
  if (actions.length > 0) {
    lines.push(H('Recommended actions:', 'Acciones recomendadas:', 'Ações recomendadas:'));
    lines.push(...actions.map((a) => `• ${formatAction(a, lang)}`));
  }

  if (brief.suggestedQuestions.length > 0) {
    lines.push(H('You can ask:', 'Puedes preguntar:', 'Você pode perguntar:'));
    lines.push(...brief.suggestedQuestions.map((q) => `• ${q.text}`));
  }

  void findingsById;
  return lines.join('\n');
}
