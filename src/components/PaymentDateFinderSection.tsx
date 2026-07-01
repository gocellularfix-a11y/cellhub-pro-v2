// ============================================================
// PAYMENT DATE FINDER — F3: Intelligence panel (collapsible, read-only)
// ============================================================
//
// Self-contained collapsible section rendered inside IntelligenceModule.
// Lets the owner search customers by payment date range before a vacation /
// holiday / closure and reach out. Read-only intelligence: it never mutates
// payment records and never auto-sends. Every action is explicit.
//
// Data in → findPaymentDates() (F1 engine). Message out → buildPaymentMessage()
// (F2 builder) → openWhatsApp() (existing send path). Contacted / Note / Skip /
// Follow-Up persistence is intentionally deferred to F4 (campaign storage) so
// this phase adds no new storage and stays isolated.
// ============================================================

import { useState, useCallback } from 'react';
import type { Customer, Sale, Layaway } from '@/store/types';
import {
  findPaymentDates,
  type PaymentFinderResult,
  type PaymentFinderRow,
  type PaymentFinderStatus,
} from '@/services/intelligence/payment/paymentDateFinder';
import {
  buildPaymentMessage,
  MESSAGE_TONES,
  TONE_LABELS,
  type MessageTone,
} from '@/services/intelligence/payment/paymentMessages';
import { openWhatsApp } from '@/services/whatsapp';
import { formatCurrency } from '@/utils/currency';
import { formatDate } from '@/utils/dates';
import { formatPhone, phoneDigits } from '@/utils/normalize';
import Modal from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

type Lang = 'en' | 'es' | 'pt';

interface Props {
  customers: Customer[];
  sales: Sale[];
  layaways: Layaway[];
  storeName: string;
  lang: Lang;
}

// ── Bilingual copy ─────────────────────────────────────────────────────────
const T = {
  title: { en: 'Payment Date Finder', es: 'Buscador de Fechas de Pago', pt: 'Localizador de Datas de Pagamento' },
  subtitle: {
    en: 'Find customers to contact before vacations, holidays, closures, or days off.',
    es: 'Encuentra clientes para contactar antes de vacaciones, feriados, cierres o días libres.',
    pt: 'Encontre clientes para contatar antes de férias, feriados, fechamentos ou folgas.',
  },
  from: { en: 'From', es: 'Desde', pt: 'De' },
  to: { en: 'To', es: 'Hasta', pt: 'Até' },
  search: { en: 'Search', es: 'Buscar', pt: 'Buscar' },
  compare: { en: 'Compare prior months', es: 'Comparar meses anteriores', pt: 'Comparar meses anteriores' },
  none: { en: 'None', es: 'Ninguno', pt: 'Nenhum' },
  estimated: { en: 'Include estimated', es: 'Incluir estimados', pt: 'Incluir estimados' },
  alreadyPaid: { en: 'Include already-paid', es: 'Incluir ya pagados', pt: 'Incluir já pagos' },
  inactive: { en: 'Include inactive', es: 'Incluir inactivos', pt: 'Incluir inativos' },
  tone: { en: 'Tone', es: 'Tono', pt: 'Tom' },
  results: { en: 'results', es: 'resultados', pt: 'resultados' },
  noResults: {
    en: 'No customers match this range yet. Try a wider range or enable comparisons.',
    es: 'Ningún cliente coincide con este rango. Prueba un rango más amplio o activa comparaciones.',
    pt: 'Nenhum cliente corresponde a este intervalo. Tente um intervalo maior ou ative comparações.',
  },
  runPrompt: {
    en: 'Pick a range (or a preset) and press Search.',
    es: 'Elige un rango (o un preset) y presiona Buscar.',
    pt: 'Escolha um intervalo (ou um preset) e pressione Buscar.',
  },
  colName: { en: 'Customer', es: 'Cliente', pt: 'Cliente' },
  colCarrier: { en: 'Carrier', es: 'Operador', pt: 'Operadora' },
  colLines: { en: 'Lines', es: 'Líneas', pt: 'Linhas' },
  colLast: { en: 'Last paid', es: 'Último pago', pt: 'Último pago' },
  colAvg: { en: 'Avg', es: 'Prom.', pt: 'Méd.' },
  colDue: { en: 'Due (est.)', es: 'Vence (est.)', pt: 'Vence (est.)' },
  colStatus: { en: 'Status', es: 'Estado', pt: 'Status' },
  colActions: { en: 'Actions', es: 'Acciones', pt: 'Ações' },
  call: { en: 'Call', es: 'Llamar', pt: 'Ligar' },
  copy: { en: 'Copy', es: 'Copiar', pt: 'Copiar' },
  message: { en: 'Message', es: 'Mensaje', pt: 'Mensagem' },
  copied: { en: 'Number copied', es: 'Número copiado', pt: 'Número copiado' },
  copyFail: { en: 'Could not copy', es: 'No se pudo copiar', pt: 'Não foi possível copiar' },
  noPhone: { en: 'No phone on file', es: 'Sin teléfono registrado', pt: 'Sem telefone cadastrado' },
  msgTitle: { en: 'WhatsApp message', es: 'Mensaje de WhatsApp', pt: 'Mensagem do WhatsApp' },
  msgHint: {
    en: 'Edit freely. Nothing sends until you press Open WhatsApp.',
    es: 'Edita libremente. Nada se envía hasta que presiones Abrir WhatsApp.',
    pt: 'Edite livremente. Nada é enviado até você pressionar Abrir WhatsApp.',
  },
  copyText: { en: 'Copy text', es: 'Copiar texto', pt: 'Copiar texto' },
  openWa: { en: 'Open WhatsApp', es: 'Abrir WhatsApp', pt: 'Abrir WhatsApp' },
  textCopied: { en: 'Message copied', es: 'Mensaje copiado', pt: 'Mensagem copiada' },
  estBadge: { en: 'est.', es: 'est.', pt: 'est.' },
};

// Presets — computed from today (local).
type PresetKey = 'next3' | 'next7' | 'next14' | 'next30' | 'thisWeek' | 'nextWeek' | 'thisMonth';
const PRESET_LABELS: Record<PresetKey, Record<Lang, string>> = {
  next3: { en: 'Next 3 days', es: 'Próx. 3 días', pt: 'Próx. 3 dias' },
  next7: { en: 'Next 7 days', es: 'Próx. 7 días', pt: 'Próx. 7 dias' },
  next14: { en: 'Next 14 days', es: 'Próx. 14 días', pt: 'Próx. 14 dias' },
  next30: { en: 'Next 30 days', es: 'Próx. 30 días', pt: 'Próx. 30 dias' },
  thisWeek: { en: 'This week', es: 'Esta semana', pt: 'Esta semana' },
  nextWeek: { en: 'Next week', es: 'Próx. semana', pt: 'Próx. semana' },
  thisMonth: { en: 'This month', es: 'Este mes', pt: 'Este mês' },
};

const STATUS_META: Record<PaymentFinderStatus, { color: string; label: Record<Lang, string> }> = {
  due_in_range: { color: '#EF4444', label: { en: 'Due', es: 'Vence', pt: 'Vence' } },
  estimated_due: { color: '#F59E0B', label: { en: 'Estimated due', es: 'Vence (est.)', pt: 'Vence (est.)' } },
  historical_match: { color: '#3B82F6', label: { en: 'Historical', es: 'Histórico', pt: 'Histórico' } },
  already_paid: { color: '#10B981', label: { en: 'Already paid', es: 'Ya pagó', pt: 'Já pagou' } },
};

// ── Date helpers (local, day granularity) ──────────────────────────────────
function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
function parseYmd(s: string): Date | null {
  const parts = (s || '').split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !n || isNaN(n))) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  r.setDate(r.getDate() + n);
  return r;
}
function presetRange(key: PresetKey): { start: Date; end: Date } {
  const today = new Date();
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  switch (key) {
    case 'next3': return { start: t0, end: addDays(t0, 3) };
    case 'next7': return { start: t0, end: addDays(t0, 7) };
    case 'next14': return { start: t0, end: addDays(t0, 14) };
    case 'next30': return { start: t0, end: addDays(t0, 30) };
    case 'thisWeek': {
      const start = addDays(t0, -t0.getDay()); // Sunday-start
      return { start, end: addDays(start, 6) };
    }
    case 'nextWeek': {
      const start = addDays(t0, 7 - t0.getDay());
      return { start, end: addDays(start, 6) };
    }
    case 'thisMonth': {
      const start = new Date(t0.getFullYear(), t0.getMonth(), 1);
      const end = new Date(t0.getFullYear(), t0.getMonth() + 1, 0);
      return { start, end };
    }
  }
}

const locale = (lang: Lang) => (lang === 'es' ? 'es-US' : lang === 'pt' ? 'pt-BR' : 'en-US');

export default function PaymentDateFinderSection({ customers, sales, layaways, storeName, lang }: Props) {
  const { toast } = useToast();
  const [collapsed, setCollapsed] = useState(true);

  const today = new Date();
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const [startStr, setStartStr] = useState(ymd(t0));
  const [endStr, setEndStr] = useState(ymd(addDays(t0, 7)));
  const [compareMonths, setCompareMonths] = useState<0 | 1 | 2>(0);
  const [includeEstimated, setIncludeEstimated] = useState(true);
  const [includeAlreadyPaid, setIncludeAlreadyPaid] = useState(false);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [tone, setTone] = useState<MessageTone>('friendly');
  const [result, setResult] = useState<PaymentFinderResult | null>(null);

  // Message modal state.
  const [msgRow, setMsgRow] = useState<PaymentFinderRow | null>(null);
  const [msgText, setMsgText] = useState('');

  const runSearch = useCallback(
    (sStr: string, eStr: string) => {
      const start = parseYmd(sStr);
      const end = parseYmd(eStr);
      if (!start || !end) return;
      const res = findPaymentDates(
        { customers, sales, layaways },
        {
          startDate: start,
          endDate: end,
          referenceDate: new Date(),
          compareMonths,
          includeEstimatedDueDates: includeEstimated,
          includeAlreadyPaid,
          includeInactive,
        },
      );
      setResult(res);
    },
    [customers, sales, layaways, compareMonths, includeEstimated, includeAlreadyPaid, includeInactive],
  );

  const applyPreset = useCallback(
    (key: PresetKey) => {
      const { start, end } = presetRange(key);
      const sStr = ymd(start);
      const eStr = ymd(end);
      setStartStr(sStr);
      setEndStr(eStr);
      runSearch(sStr, eStr);
    },
    [runSearch],
  );

  const buildRowMessage = useCallback(
    (row: PaymentFinderRow, t: MessageTone): string => {
      const rangeStart = result ? formatDate(result.rangeStart, locale(lang)) : '';
      const rangeEnd = result ? formatDate(result.rangeEnd, locale(lang)) : '';
      return buildPaymentMessage(
        {
          customerName: row.customerName,
          storeName,
          dueDate: row.effectiveDueDate ? formatDate(row.effectiveDueDate, locale(lang)) : undefined,
          isEstimated: row.isEstimated,
          closureStart: rangeStart,
          closureEnd: rangeEnd,
        },
        lang,
        t,
      );
    },
    [result, storeName, lang],
  );

  const openMessage = useCallback(
    (row: PaymentFinderRow) => {
      if (!phoneDigits(row.phone)) {
        toast(T.noPhone[lang], 'error');
        return;
      }
      setMsgRow(row);
      setMsgText(buildRowMessage(row, tone));
    },
    [buildRowMessage, tone, lang, toast],
  );

  const onCall = useCallback(
    (row: PaymentFinderRow) => {
      const digits = phoneDigits(row.phone);
      if (!digits) { toast(T.noPhone[lang], 'error'); return; }
      window.open(`tel:${digits}`);
    },
    [lang, toast],
  );

  const onCopyNumber = useCallback(
    async (row: PaymentFinderRow) => {
      const digits = phoneDigits(row.phone);
      if (!digits) { toast(T.noPhone[lang], 'error'); return; }
      try {
        await navigator.clipboard.writeText(formatPhone(row.phone));
        toast(T.copied[lang], 'success');
      } catch {
        toast(T.copyFail[lang], 'error');
      }
    },
    [lang, toast],
  );

  const onOpenWa = useCallback(() => {
    if (!msgRow) return;
    openWhatsApp(msgRow.phone, msgText);
    setMsgRow(null);
  }, [msgRow, msgText]);

  const onCopyText = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(msgText);
      toast(T.textCopied[lang], 'success');
    } catch {
      toast(T.copyFail[lang], 'error');
    }
  }, [msgText, lang, toast]);

  const loc = locale(lang);

  return (
    <div className="rounded-lg border p-3 mb-3" style={{ background: '#0F172A', borderColor: '#1F2937' }}>
      {/* Header */}
      <div className="flex items-center justify-between cursor-pointer" onClick={() => setCollapsed((c) => !c)}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm">🗓️</span>
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-300 m-0">{T.title[lang]}</p>
            {!collapsed && <p className="text-[10px] text-slate-500 m-0 truncate">{T.subtitle[lang]}</p>}
          </div>
        </div>
        <span className="text-slate-500 text-xs">{collapsed ? '▸' : '▾'}</span>
      </div>

      {!collapsed && (
        <div className="mt-3">
          {/* Presets */}
          <div className="flex flex-wrap gap-1.5 mb-2">
            {(Object.keys(PRESET_LABELS) as PresetKey[]).map((key) => (
              <button
                key={key}
                onClick={() => applyPreset(key)}
                className="text-[11px] px-2 py-1 rounded border border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                {PRESET_LABELS[key][lang]}
              </button>
            ))}
          </div>

          {/* Date range + search */}
          <div className="flex flex-wrap items-end gap-2 mb-2">
            <label className="text-[11px] text-slate-400">
              {T.from[lang]}
              <input
                type="date"
                value={startStr}
                onChange={(e) => setStartStr(e.target.value)}
                className="block bg-slate-800 border border-slate-700 rounded text-slate-200 text-xs px-2 py-1 mt-0.5"
              />
            </label>
            <label className="text-[11px] text-slate-400">
              {T.to[lang]}
              <input
                type="date"
                value={endStr}
                onChange={(e) => setEndStr(e.target.value)}
                className="block bg-slate-800 border border-slate-700 rounded text-slate-200 text-xs px-2 py-1 mt-0.5"
              />
            </label>
            <button
              onClick={() => runSearch(startStr, endStr)}
              className="text-xs font-semibold px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white"
            >
              {T.search[lang]}
            </button>
          </div>

          {/* Options */}
          <div className="flex flex-wrap items-center gap-3 mb-3 text-[11px] text-slate-400">
            <label className="flex items-center gap-1">
              {T.compare[lang]}:
              <select
                value={compareMonths}
                onChange={(e) => setCompareMonths(Number(e.target.value) as 0 | 1 | 2)}
                className="bg-slate-800 border border-slate-700 rounded text-slate-200 px-1 py-0.5"
              >
                <option value={0}>{T.none[lang]}</option>
                <option value={1}>1</option>
                <option value={2}>2</option>
              </select>
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={includeEstimated} onChange={(e) => setIncludeEstimated(e.target.checked)} />
              {T.estimated[lang]}
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={includeAlreadyPaid} onChange={(e) => setIncludeAlreadyPaid(e.target.checked)} />
              {T.alreadyPaid[lang]}
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
              {T.inactive[lang]}
            </label>
            <label className="flex items-center gap-1 ml-auto">
              {T.tone[lang]}:
              <select
                value={tone}
                onChange={(e) => setTone(e.target.value as MessageTone)}
                className="bg-slate-800 border border-slate-700 rounded text-slate-200 px-1 py-0.5"
              >
                {MESSAGE_TONES.map((tk) => (
                  <option key={tk} value={tk}>{TONE_LABELS[tk][lang]}</option>
                ))}
              </select>
            </label>
          </div>

          {/* Results */}
          {!result ? (
            <p className="text-[11px] text-slate-500 italic">{T.runPrompt[lang]}</p>
          ) : result.rows.length === 0 ? (
            <p className="text-[11px] text-slate-500 italic">{T.noResults[lang]}</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-3 mb-2 text-[11px] text-slate-400">
                <span className="font-semibold text-slate-200">{result.counts.total} {T.results[lang]}</span>
                {result.counts.dueInRange > 0 && <span style={{ color: STATUS_META.due_in_range.color }}>● {result.counts.dueInRange}</span>}
                {result.counts.estimatedDue > 0 && <span style={{ color: STATUS_META.estimated_due.color }}>● {result.counts.estimatedDue}</span>}
                {result.counts.historicalMatch > 0 && <span style={{ color: STATUS_META.historical_match.color }}>● {result.counts.historicalMatch}</span>}
                {result.counts.alreadyPaid > 0 && <span style={{ color: STATUS_META.already_paid.color }}>● {result.counts.alreadyPaid}</span>}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-slate-500 text-left border-b border-slate-800">
                      <th className="py-1 pr-2 font-medium">{T.colName[lang]}</th>
                      <th className="py-1 pr-2 font-medium">{T.colCarrier[lang]}</th>
                      <th className="py-1 pr-2 font-medium text-center">{T.colLines[lang]}</th>
                      <th className="py-1 pr-2 font-medium">{T.colLast[lang]}</th>
                      <th className="py-1 pr-2 font-medium text-right">{T.colAvg[lang]}</th>
                      <th className="py-1 pr-2 font-medium">{T.colDue[lang]}</th>
                      <th className="py-1 pr-2 font-medium">{T.colStatus[lang]}</th>
                      <th className="py-1 font-medium text-right">{T.colActions[lang]}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row) => {
                      const meta = STATUS_META[row.status];
                      return (
                        <tr key={row.customerId} className="border-b border-slate-800/60">
                          <td className="py-1.5 pr-2 text-slate-200">
                            {row.customerName}
                            {row.isHighValue && <span title="High value" className="ml-1">⭐</span>}
                            <div className="text-slate-500">{formatPhone(row.phone)}</div>
                          </td>
                          <td className="py-1.5 pr-2 text-slate-400">{row.carrier || '—'}</td>
                          <td className="py-1.5 pr-2 text-center text-slate-400">
                            {row.lineCount}{row.isMultiLine ? '📱' : ''}
                          </td>
                          <td className="py-1.5 pr-2 text-slate-400">
                            {row.lastPaymentDate ? formatDate(row.lastPaymentDate, loc) : '—'}
                            {row.lastPaymentAmountCents != null && (
                              <div className="text-slate-500">{formatCurrency(row.lastPaymentAmountCents, loc)}</div>
                            )}
                          </td>
                          <td className="py-1.5 pr-2 text-right text-slate-400">
                            {row.averagePaymentAmountCents != null ? formatCurrency(row.averagePaymentAmountCents, loc) : '—'}
                          </td>
                          <td className="py-1.5 pr-2 text-slate-300">
                            {row.effectiveDueDate ? formatDate(row.effectiveDueDate, loc) : '—'}
                            {row.isEstimated && row.effectiveDueDate && (
                              <span className="ml-1 text-[9px] text-amber-500 uppercase">{T.estBadge[lang]}</span>
                            )}
                          </td>
                          <td className="py-1.5 pr-2">
                            <span
                              className="px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap"
                              style={{ background: meta.color + '1F', color: meta.color }}
                            >
                              {meta.label[lang]}
                            </span>
                          </td>
                          <td className="py-1.5 text-right whitespace-nowrap">
                            <button onClick={() => onCall(row)} title={T.call[lang]} className="px-1.5 py-0.5 rounded hover:bg-slate-800">📞</button>
                            <button onClick={() => onCopyNumber(row)} title={T.copy[lang]} className="px-1.5 py-0.5 rounded hover:bg-slate-800">⧉</button>
                            <button onClick={() => openMessage(row)} title={T.message[lang]} className="px-1.5 py-0.5 rounded hover:bg-slate-800">💬</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* Message modal */}
      <Modal
        open={!!msgRow}
        onClose={() => setMsgRow(null)}
        title={msgRow ? `${T.msgTitle[lang]} — ${msgRow.customerName}` : ''}
        size="max-w-lg"
        footer={
          <>
            <button onClick={onCopyText} className="text-xs px-3 py-1.5 rounded border border-slate-600 text-slate-200 hover:bg-slate-800">
              {T.copyText[lang]}
            </button>
            <button onClick={onOpenWa} className="text-xs font-semibold px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white">
              {T.openWa[lang]}
            </button>
          </>
        }
      >
        <div className="flex items-center gap-2 mb-2 text-[11px] text-slate-400">
          {T.tone[lang]}:
          <select
            value={tone}
            onChange={(e) => {
              const nt = e.target.value as MessageTone;
              setTone(nt);
              if (msgRow) setMsgText(buildRowMessage(msgRow, nt));
            }}
            className="bg-slate-800 border border-slate-700 rounded text-slate-200 px-1 py-0.5"
          >
            {MESSAGE_TONES.map((tk) => (
              <option key={tk} value={tk}>{TONE_LABELS[tk][lang]}</option>
            ))}
          </select>
        </div>
        <textarea
          value={msgText}
          onChange={(e) => setMsgText(e.target.value)}
          rows={9}
          className="w-full bg-slate-900 border border-slate-700 rounded text-slate-200 text-xs p-2"
        />
        <p className="text-[10px] text-slate-500 mt-1">{T.msgHint[lang]}</p>
      </Modal>
    </div>
  );
}
