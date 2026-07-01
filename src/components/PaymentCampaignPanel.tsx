// ============================================================
// PAYMENT DATE FINDER — F4: Campaign dashboard + detail (persisted)
// ============================================================
//
// Renders saved outreach campaigns (dashboard grouped by lifecycle) and, when
// one is opened, a detail view of its snapshot customers with PERSISTED
// per-customer workflow actions (Mark Contacted / Skip / Note / Follow-Up).
//
// All persistence goes through paymentCampaignStore (localStorage, versioned
// key) — this component owns NO storage path of its own and never touches
// Customer records (actions are keyed by customerId only). Messages are rebuilt
// from the snapshot + campaign context via the F2 builder; nothing auto-sends.
// ============================================================

import { useState, useCallback, useEffect } from 'react';
import {
  listCampaigns,
  getCampaign,
  deleteCampaign,
  setCampaignStatus,
  setCustomerAction,
  campaignProgress,
  CAMPAIGN_TYPE_LABELS,
  type PaymentCampaign,
  type CampaignStatus,
  type CampaignCustomer,
} from '@/services/intelligence/payment/paymentCampaignStore';
import { buildPaymentMessage, type MessageTone, type MsgLang } from '@/services/intelligence/payment/paymentMessages';
import { openWhatsApp } from '@/services/whatsapp';
import { formatDate } from '@/utils/dates';
import { formatPhone, phoneDigits } from '@/utils/normalize';
import Modal from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

type Lang = 'en' | 'es' | 'pt';

interface Props {
  storeName: string;
  lang: Lang;
  /** Bumped by the parent after a save so the list reloads. */
  refreshSignal: number;
}

const T = {
  header: { en: 'Campaigns', es: 'Campañas', pt: 'Campanhas' },
  none: { en: 'No saved campaigns yet.', es: 'Aún no hay campañas guardadas.', pt: 'Nenhuma campanha salva ainda.' },
  open: { en: 'Open', es: 'Abrir', pt: 'Abrir' },
  activate: { en: 'Activate', es: 'Activar', pt: 'Ativar' },
  complete: { en: 'Complete', es: 'Completar', pt: 'Concluir' },
  reopen: { en: 'Reopen', es: 'Reabrir', pt: 'Reabrir' },
  del: { en: 'Delete', es: 'Eliminar', pt: 'Excluir' },
  back: { en: '← Back to campaigns', es: '← Volver a campañas', pt: '← Voltar às campanhas' },
  handled: { en: 'handled', es: 'gestionados', pt: 'tratados' },
  contacted: { en: 'Contacted', es: 'Contactado', pt: 'Contatado' },
  skip: { en: 'Skip', es: 'Omitir', pt: 'Pular' },
  note: { en: 'Note', es: 'Nota', pt: 'Nota' },
  followUp: { en: 'Follow-up', es: 'Seguimiento', pt: 'Acompanhar' },
  call: { en: 'Call', es: 'Llamar', pt: 'Ligar' },
  copy: { en: 'Copy', es: 'Copiar', pt: 'Copiar' },
  message: { en: 'Message', es: 'Mensaje', pt: 'Mensagem' },
  colCustomer: { en: 'Customer', es: 'Cliente', pt: 'Cliente' },
  colDue: { en: 'Due (est.)', es: 'Vence (est.)', pt: 'Vence (est.)' },
  colState: { en: 'Action', es: 'Acción', pt: 'Ação' },
  noPhone: { en: 'No phone on file', es: 'Sin teléfono', pt: 'Sem telefone' },
  copied: { en: 'Number copied', es: 'Número copiado', pt: 'Número copiado' },
  copyFail: { en: 'Could not copy', es: 'No se pudo copiar', pt: 'Não foi possível copiar' },
  msgTitle: { en: 'WhatsApp message', es: 'Mensaje de WhatsApp', pt: 'Mensagem do WhatsApp' },
  msgHint: {
    en: 'Edit freely. Nothing sends until you press Open WhatsApp.',
    es: 'Edita libremente. Nada se envía hasta que presiones Abrir WhatsApp.',
    pt: 'Edite livremente. Nada é enviado até você pressionar Abrir WhatsApp.',
  },
  openWa: { en: 'Open WhatsApp', es: 'Abrir WhatsApp', pt: 'Abrir WhatsApp' },
  confirmDelete: { en: 'Delete this campaign?', es: '¿Eliminar esta campaña?', pt: 'Excluir esta campanha?' },
  yes: { en: 'Delete', es: 'Eliminar', pt: 'Excluir' },
  cancel: { en: 'Cancel', es: 'Cancelar', pt: 'Cancelar' },
};

const TYPE_LABELS = CAMPAIGN_TYPE_LABELS;

const STATUS_META: Record<CampaignStatus, { color: string; label: Record<Lang, string> }> = {
  draft: { color: '#94A3B8', label: { en: 'Draft', es: 'Borrador', pt: 'Rascunho' } },
  active: { color: '#F59E0B', label: { en: 'Active', es: 'Activa', pt: 'Ativa' } },
  completed: { color: '#10B981', label: { en: 'Completed', es: 'Completada', pt: 'Concluída' } },
};

const locale = (lang: Lang) => (lang === 'es' ? 'es-US' : lang === 'pt' ? 'pt-BR' : 'en-US');

export default function PaymentCampaignPanel({ storeName, lang, refreshSignal }: Props) {
  const { toast } = useToast();
  const [campaigns, setCampaigns] = useState<PaymentCampaign[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Message modal.
  const [msgCust, setMsgCust] = useState<CampaignCustomer | null>(null);
  const [msgText, setMsgText] = useState('');

  const reload = useCallback(() => setCampaigns(listCampaigns()), []);
  useEffect(() => { reload(); }, [reload, refreshSignal]);

  const open = openId ? getCampaign(openId) : null;
  const loc = locale(lang);

  // ── Mutations (all via the store) ──
  const onSetStatus = useCallback((id: string, status: CampaignStatus) => {
    setCampaignStatus(id, status);
    reload();
  }, [reload]);

  const onDelete = useCallback((id: string) => {
    deleteCampaign(id);
    setConfirmDeleteId(null);
    if (openId === id) setOpenId(null);
    reload();
  }, [openId, reload]);

  const patchCustomer = useCallback((campaignId: string, customerId: string, patch: Parameters<typeof setCustomerAction>[2]) => {
    setCustomerAction(campaignId, customerId, patch);
    reload();
  }, [reload]);

  const buildMsg = useCallback((camp: PaymentCampaign, cust: CampaignCustomer): string => {
    const l = locale(lang);
    return buildPaymentMessage(
      {
        customerName: cust.customerName,
        storeName,
        dueDate: cust.effectiveDueDate ? formatDate(cust.effectiveDueDate, l) : undefined,
        isEstimated: cust.isEstimated,
        lineCount: cust.lineCount,
        closureStart: formatDate(camp.rangeStart, l),
        closureEnd: formatDate(camp.rangeEnd, l),
      },
      (camp.lang as MsgLang) || 'en',
      (camp.tone as MessageTone) || 'friendly',
    );
  }, [storeName, lang]);

  const onCall = useCallback((phone: string) => {
    const d = phoneDigits(phone);
    if (!d) { toast(T.noPhone[lang], 'error'); return; }
    window.open(`tel:${d}`);
  }, [lang, toast]);

  const onCopy = useCallback(async (phone: string) => {
    const d = phoneDigits(phone);
    if (!d) { toast(T.noPhone[lang], 'error'); return; }
    try { await navigator.clipboard.writeText(formatPhone(phone)); toast(T.copied[lang], 'success'); }
    catch { toast(T.copyFail[lang], 'error'); }
  }, [lang, toast]);

  const openMessage = useCallback((camp: PaymentCampaign, cust: CampaignCustomer) => {
    if (!phoneDigits(cust.phone)) { toast(T.noPhone[lang], 'error'); return; }
    setMsgCust(cust);
    setMsgText(buildMsg(camp, cust));
  }, [buildMsg, lang, toast]);

  const onOpenWa = useCallback(() => {
    if (!msgCust) return;
    openWhatsApp(msgCust.phone, msgText);
    setMsgCust(null);
  }, [msgCust, msgText]);

  // ── Dashboard (list) ──
  const renderList = () => {
    if (campaigns.length === 0) {
      return <p className="text-[11px] text-slate-500 italic">{T.none[lang]}</p>;
    }
    return (
      <div className="flex flex-col gap-1.5">
        {campaigns.map((c) => {
          const meta = STATUS_META[c.status];
          const p = campaignProgress(c);
          return (
            <div key={c.id} className="flex items-center gap-2 rounded border border-slate-800 bg-slate-900/40 px-2 py-1.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-slate-200 text-xs font-semibold truncate">{c.name}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: meta.color + '1F', color: meta.color }}>
                    {meta.label[lang]}
                  </span>
                  <span className="text-[9px] text-slate-500">{TYPE_LABELS[c.type][lang]}</span>
                </div>
                <div className="text-[10px] text-slate-500">
                  {p.handled}/{p.total} {T.handled[lang]} · {formatDate(c.rangeStart, loc)}–{formatDate(c.rangeEnd, loc)}
                </div>
              </div>
              <button onClick={() => setOpenId(c.id)} className="text-[10px] px-2 py-0.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800">
                {T.open[lang]}
              </button>
              {c.status === 'draft' && (
                <button onClick={() => onSetStatus(c.id, 'active')} className="text-[10px] px-2 py-0.5 rounded border border-amber-700 text-amber-400 hover:bg-slate-800">
                  {T.activate[lang]}
                </button>
              )}
              {c.status === 'active' && (
                <button onClick={() => onSetStatus(c.id, 'completed')} className="text-[10px] px-2 py-0.5 rounded border border-emerald-700 text-emerald-400 hover:bg-slate-800">
                  {T.complete[lang]}
                </button>
              )}
              {c.status === 'completed' && (
                <button onClick={() => onSetStatus(c.id, 'active')} className="text-[10px] px-2 py-0.5 rounded border border-slate-700 text-slate-400 hover:bg-slate-800">
                  {T.reopen[lang]}
                </button>
              )}
              <button onClick={() => setConfirmDeleteId(c.id)} title={T.del[lang]} className="text-[10px] px-1.5 py-0.5 rounded text-red-400 hover:bg-slate-800">
                🗑
              </button>
            </div>
          );
        })}
      </div>
    );
  };

  // ── Detail (opened campaign) ──
  const renderDetail = (camp: PaymentCampaign) => {
    const meta = STATUS_META[camp.status];
    return (
      <div>
        <div className="flex items-center justify-between mb-2">
          <button onClick={() => setOpenId(null)} className="text-[11px] text-slate-400 hover:text-slate-200">
            {T.back[lang]}
          </button>
          <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: meta.color + '1F', color: meta.color }}>
            {meta.label[lang]}
          </span>
        </div>
        <div className="text-xs font-semibold text-slate-200 mb-2">
          {camp.name}
          <span className="ml-2 text-[10px] font-normal text-slate-500">{TYPE_LABELS[camp.type][lang]}{camp.reason ? ` · ${camp.reason}` : ''}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-slate-500 text-left border-b border-slate-800">
                <th className="py-1 pr-2 font-medium">{T.colCustomer[lang]}</th>
                <th className="py-1 pr-2 font-medium">{T.colDue[lang]}</th>
                <th className="py-1 pr-2 font-medium">{T.colState[lang]}</th>
                <th className="py-1 font-medium text-right"> </th>
              </tr>
            </thead>
            <tbody>
              {camp.customers.map((cust) => {
                const a = camp.actions[cust.customerId];
                const contacted = !!a?.contacted;
                const skipped = !!a?.skipped;
                return (
                  <tr key={cust.customerId} className="border-b border-slate-800/60" style={{ opacity: skipped ? 0.55 : 1 }}>
                    <td className="py-1.5 pr-2 text-slate-200">
                      {cust.customerName}
                      <div className="text-slate-500">{formatPhone(cust.phone)}</div>
                    </td>
                    <td className="py-1.5 pr-2 text-slate-300">
                      {cust.effectiveDueDate ? formatDate(cust.effectiveDueDate, loc) : '—'}
                      {cust.isEstimated && cust.effectiveDueDate && <span className="ml-1 text-[9px] text-amber-500 uppercase">est.</span>}
                    </td>
                    <td className="py-1.5 pr-2">
                      <div className="flex flex-wrap items-center gap-1">
                        <button
                          onClick={() => patchCustomer(camp.id, cust.customerId, { contacted: !contacted, contactedAt: !contacted ? Date.now() : undefined })}
                          className="text-[10px] px-1.5 py-0.5 rounded border"
                          style={contacted
                            ? { borderColor: '#10B981', background: '#10B98122', color: '#6EE7B7' }
                            : { borderColor: '#334155', color: '#94A3B8' }}
                        >
                          {contacted ? '✓ ' : ''}{T.contacted[lang]}
                        </button>
                        <button
                          onClick={() => patchCustomer(camp.id, cust.customerId, { skipped: !skipped })}
                          className="text-[10px] px-1.5 py-0.5 rounded border"
                          style={skipped
                            ? { borderColor: '#64748B', background: '#64748B22', color: '#CBD5E1' }
                            : { borderColor: '#334155', color: '#94A3B8' }}
                        >
                          {T.skip[lang]}
                        </button>
                        <input
                          type="date"
                          value={a?.followUpDate || ''}
                          onChange={(e) => patchCustomer(camp.id, cust.customerId, { followUpDate: e.target.value || undefined })}
                          title={T.followUp[lang]}
                          className="bg-slate-800 border border-slate-700 rounded text-slate-200 text-[10px] px-1 py-0.5"
                        />
                        <input
                          type="text"
                          defaultValue={a?.note || ''}
                          onBlur={(e) => { if ((e.target.value || '') !== (a?.note || '')) patchCustomer(camp.id, cust.customerId, { note: e.target.value || undefined }); }}
                          placeholder={T.note[lang]}
                          className="bg-slate-800 border border-slate-700 rounded text-slate-200 text-[10px] px-1 py-0.5 w-24"
                        />
                      </div>
                    </td>
                    <td className="py-1.5 text-right whitespace-nowrap">
                      <button onClick={() => onCall(cust.phone)} title={T.call[lang]} className="px-1 py-0.5 rounded hover:bg-slate-800">📞</button>
                      <button onClick={() => onCopy(cust.phone)} title={T.copy[lang]} className="px-1 py-0.5 rounded hover:bg-slate-800">⧉</button>
                      <button onClick={() => openMessage(camp, cust)} title={T.message[lang]} className="px-1 py-0.5 rounded hover:bg-slate-800">💬</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="mt-3 rounded-lg border p-3" style={{ background: '#0B1220', borderColor: '#1F2937' }}>
      <p className="text-xs font-bold uppercase tracking-wider text-slate-300 m-0 mb-2">📋 {T.header[lang]}</p>
      {open ? renderDetail(open) : renderList()}

      {/* Delete confirm */}
      <Modal
        open={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        title={T.confirmDelete[lang]}
        size="max-w-sm"
        footer={
          <>
            <button onClick={() => setConfirmDeleteId(null)} className="text-xs px-3 py-1.5 rounded border border-slate-600 text-slate-200 hover:bg-slate-800">
              {T.cancel[lang]}
            </button>
            <button onClick={() => confirmDeleteId && onDelete(confirmDeleteId)} className="text-xs font-semibold px-3 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white">
              {T.yes[lang]}
            </button>
          </>
        }
      >
        <p className="text-xs text-slate-400">{T.confirmDelete[lang]}</p>
      </Modal>

      {/* Message modal */}
      <Modal
        open={!!msgCust}
        onClose={() => setMsgCust(null)}
        title={msgCust ? `${T.msgTitle[lang]} — ${msgCust.customerName}` : ''}
        size="max-w-lg"
        footer={
          <button onClick={onOpenWa} className="text-xs font-semibold px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white">
            {T.openWa[lang]}
          </button>
        }
      >
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
