// ============================================================
// CellHub Pro — Store Credit Center (P1-SC-CENTER)
//
// Operational certificate manager + audit surface over the canonical
// StoreCreditLedger. Read-heavy: every figure comes from the persisted
// ledger via the pure view-model (centerViewModel.ts). The ONLY mutation
// this module can perform is the existing certificate void
// (voidLedgerEntry + AdminPinGate + reason — same engine Reports uses).
// No direct balance editing exists anywhere in this module.
//
// Store scope: the ledger arrives already scoped by AppProvider's
// canonical belongsToStore filter. Privacy: liability/amount cards follow
// resolveOwnerFinancialAccess (same policy as Reports). LAN: a read-only
// Secondary can view the mirrored ledger; the void action persists through
// the central persist layer, which blocks writes on Secondaries.
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import { useApp } from '@/store/AppProvider';
import { useTranslation } from '@/i18n';
import { useToast } from '@/components/ui/Toast';
import { Modal } from '@/components/ui';
import AdminPinGate from '@/components/shared/AdminPinGate';
import { usePrint } from '@/hooks/usePrint';
import { formatCurrency } from '@/utils/currency';
import { resolveOwnerFinancialAccess } from '@/utils/financialPrivacy';
import { renderBarcodeSvg, getReceiptBarcodeHeight } from '@/modules/pos/ReceiptModal';
import { voidLedgerEntry } from '@/services/storeCredit/ledger';
import {
  buildCenterSummary, queryCenterRows, resolveCertificateSource,
  buildCertificateTimeline, lastActivityIso, buildLedgerCsv,
  type CenterStatusFilter, type CenterSort,
} from '@/services/storeCredit/centerViewModel';
import { consumePendingCertificateFocus } from '@/services/storeCredit/centerFocus';
import { escHtml } from '@/utils/escHtml';
import { persist } from '@/services/persist';
import type { StoreCreditLedger } from '@/store/types';

const STATUS_BADGE: Record<string, { bg: string; color: string }> = {
  active:   { bg: 'rgba(16,185,129,0.15)', color: '#10b981' },
  redeemed: { bg: 'rgba(148,163,184,0.15)', color: '#94a3b8' },
  voided:   { bg: 'rgba(239,68,68,0.15)', color: '#ef4444' },
  expired:  { bg: 'rgba(245,158,11,0.15)', color: '#f59e0b' },
};

const EVENT_STYLE: Record<string, { icon: string; color: string }> = {
  issuance:   { icon: '🎫', color: '#38bdf8' },
  redemption: { icon: '➖', color: '#f87171' },
  reversal:   { icon: '➕', color: '#34d399' },
  void:       { icon: '⛔', color: '#ef4444' },
};

export default function StoreCreditCenterModule() {
  const {
    state: { storeCreditLedger, settings, currentEmployee, isAdminMode },
    dispatch,
    setStoreCreditLedger,
    setActiveTab,
  } = useApp();
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { printHtml } = usePrint();

  const canSeeFinancials = resolveOwnerFinancialAccess({ settings, currentEmployee, isAdminMode });

  // ── Query state ─────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<CenterStatusFilter>('all');
  const [source, setSource] = useState<'all' | 'return' | 'unknown'>('all');
  const [sort, setSort] = useState<CenterSort>('newest');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [employee, setEmployee] = useState('');
  const [detail, setDetail] = useState<StoreCreditLedger | null>(null);

  // Contextual focus hand-off (Customer 360 → Center).
  useEffect(() => {
    const focusId = consumePendingCertificateFocus();
    if (!focusId) return;
    const entry = (storeCreditLedger || []).find((l) => l.id === focusId);
    if (entry) setDetail(entry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the open detail in sync with ledger updates (e.g. after a void).
  useEffect(() => {
    if (!detail) return;
    const fresh = (storeCreditLedger || []).find((l) => l.id === detail.id);
    if (fresh && fresh !== detail) setDetail(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeCreditLedger]);

  const summary = useMemo(() => buildCenterSummary(storeCreditLedger), [storeCreditLedger]);
  const rows = useMemo(
    () => queryCenterRows(storeCreditLedger, { search, status, source, sort, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, employee: employee || undefined }),
    [storeCreditLedger, search, status, source, sort, dateFrom, dateTo, employee],
  );
  const issuers = useMemo(() => {
    const set = new Set<string>();
    for (const l of storeCreditLedger || []) if (l.issuedByEmployeeName) set.add(l.issuedByEmployeeName);
    return [...set].sort();
  }, [storeCreditLedger]);

  const fmtDate = (iso: string) => (iso ? new Date(iso).toLocaleDateString(locale === 'en' ? 'en-US' : locale === 'pt' ? 'pt-BR' : 'es-MX') : '—');
  const money = (cents: number) => (canSeeFinancials ? formatCurrency(cents) : '•••');

  // ── Actions ─────────────────────────────────────────────
  const viewCustomer = (entry: StoreCreditLedger) => {
    if (!entry.customerId) { toast(t('scc.noLinkedCustomer'), 'info'); return; }
    dispatch({ type: 'SET_PENDING_CUSTOMER_HISTORY', payload: entry.customerId });
    setActiveTab('customers');
  };

  const viewRelatedSale = (invoice: string) => {
    if (!invoice) return;
    dispatch({ type: 'SET_GLOBAL_SEARCH', payload: invoice });
    setActiveTab('reports');
  };

  const reprintCertificate = (entry: StoreCreditLedger) => {
    // Same physical layout family as the Returns-issued certificate, built
    // with the existing print infrastructure (printHtml + shared barcode
    // renderer). Marked REPRINT and shows the CURRENT remaining balance so a
    // reprinted paper can never overstate value.
    const barcodeSvg = renderBarcodeSvg(entry.certificateNumber, getReceiptBarcodeHeight(settings.paperSize));
    const storeName = escHtml(settings.storeName || 'GO CELLULAR');
    const html = `<!DOCTYPE html><html><head><title>Store Credit Certificate</title>
<style>
  body{font-family:monospace;font-size:12px;width:3in;margin:0;padding:8px;color:#000}
  .title{text-align:center;font-weight:800;font-size:13px;margin:6px 0}
  .row{display:flex;justify-content:space-between;margin:2px 0}
  .big{font-size:18px;font-weight:800;text-align:center;margin:8px 0}
  .bc{text-align:center;margin:8px 0}
  .muted{color:#333;font-size:10px;text-align:center}
  hr{border:none;border-top:1px dashed #000;margin:6px 0}
</style></head><body>
  <div class="title">${storeName}</div>
  <div class="title">${escHtml(t('scc.print.certTitle'))} — ${escHtml(t('scc.print.reprint'))}</div>
  <hr/>
  <div class="row"><span>${escHtml(t('scc.col.certificate'))}</span><span>${escHtml(entry.certificateNumber)}</span></div>
  <div class="row"><span>${escHtml(t('scc.col.customer'))}</span><span>${escHtml(entry.customerName || '—')}</span></div>
  <div class="row"><span>${escHtml(t('scc.col.issued'))}</span><span>${escHtml(fmtDate(entry.issuedAt))}</span></div>
  <div class="row"><span>${escHtml(t('scc.detail.issuedAmount'))}</span><span>${formatCurrency(entry.issuedAmount || 0)}</span></div>
  <hr/>
  <div class="big">${escHtml(t('scc.col.remaining'))}: ${formatCurrency(entry.remainingAmount || 0)}</div>
  <div class="bc">${barcodeSvg}</div>
  <div class="muted">${escHtml(t('scc.print.reprintFooter'))} ${escHtml(new Date().toLocaleString())}</div>
</body></html>`;
    printHtml(html, { silent: false, printer: (settings as unknown as { detectedPrinters?: string[] }).detectedPrinters?.[0] });
  };

  const printLedger = () => {
    const rowsHtml = rows.map((l) => `
      <tr>
        <td>${escHtml(l.certificateNumber)}</td>
        <td>${escHtml(l.customerName || '—')}</td>
        <td style="text-align:right">${formatCurrency(l.issuedAmount || 0)}</td>
        <td style="text-align:right">${formatCurrency(l.redeemedAmount || 0)}</td>
        <td style="text-align:right">${formatCurrency(l.remainingAmount || 0)}</td>
        <td>${escHtml(l.status)}</td>
        <td>${escHtml(fmtDate(l.issuedAt))}</td>
      </tr>`).join('');
    const html = `<!DOCTYPE html><html><head><title>${escHtml(t('scc.print.ledgerTitle'))}</title>
<style>
  body{font-family:Arial,sans-serif;font-size:11px;color:#000;margin:16px}
  h1{font-size:16px;margin:0 0 2px}
  .sub{color:#444;font-size:10px;margin-bottom:10px}
  table{width:100%;border-collapse:collapse}
  th,td{border:1px solid #999;padding:4px 6px;text-align:left}
  th{background:#eee}
</style></head><body>
  <h1>${escHtml(settings.storeName || 'CellHub Pro')} — ${escHtml(t('scc.print.ledgerTitle'))}</h1>
  <div class="sub">${escHtml(new Date().toLocaleString())} · ${rows.length} ${escHtml(t('scc.print.rows'))}</div>
  <table>
    <thead><tr>
      <th>${escHtml(t('scc.col.certificate'))}</th><th>${escHtml(t('scc.col.customer'))}</th>
      <th>${escHtml(t('scc.col.original'))}</th><th>${escHtml(t('scc.col.redeemed'))}</th>
      <th>${escHtml(t('scc.col.remaining'))}</th><th>${escHtml(t('scc.col.status'))}</th>
      <th>${escHtml(t('scc.col.issuedDate'))}</th>
    </tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
</body></html>`;
    printHtml(html, { silent: false });
  };

  const exportCsv = () => {
    try {
      const csv = buildLedgerCsv(rows);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `store-credit-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast(t('scc.exportDone', rows.length), 'success');
    } catch {
      toast(t('scc.exportFailed'), 'error');
    }
  };

  // ── Void certificate (existing engine + PIN + reason) ───
  const [voidTarget, setVoidTarget] = useState<StoreCreditLedger | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidPinOpen, setVoidPinOpen] = useState(false);

  const executeVoid = () => {
    const target = voidTarget;
    if (!target) return;
    try {
      const next = voidLedgerEntry(target, {
        employeeId: currentEmployee?.id,
        employeeName: currentEmployee?.name || '—',
        reason: voidReason.trim() || undefined,
      });
      const updated = (storeCreditLedger || []).map((l) => (l.id === target.id ? next : l));
      setStoreCreditLedger(updated);
      persist.storeCreditLedger(next.id, next as unknown as Record<string, unknown>);
      toast(t('scc.voidDone', target.certificateNumber), 'success');
    } catch (err) {
      console.warn('[scc] void failed:', err);
      toast(t('scc.voidFailed'), 'error');
    } finally {
      setVoidTarget(null);
      setVoidReason('');
      setVoidPinOpen(false);
    }
  };

  // ── Render ──────────────────────────────────────────────
  const cards: Array<{ key: string; label: string; value: string; accent: string }> = [
    { key: 'liability', label: t('scc.card.outstanding'), value: money(summary.outstandingLiabilityCents), accent: '#10b981' },
    { key: 'issued', label: t('scc.card.totalIssued'), value: money(summary.totalIssuedCents), accent: '#38bdf8' },
    { key: 'redeemed', label: t('scc.card.totalRedeemed'), value: money(summary.totalRedeemedCents), accent: '#f59e0b' },
    { key: 'active', label: t('scc.card.activeCerts'), value: String(summary.activeCount), accent: '#34d399' },
    { key: 'full', label: t('scc.card.fullyRedeemed'), value: String(summary.fullyRedeemedCount), accent: '#94a3b8' },
    { key: 'voided', label: t('scc.card.voided'), value: String(summary.voidedCount), accent: '#ef4444' },
  ];

  const detailSummary = detail ? {
    reversed: (detail.reversals || []).reduce((s, r) => s + (r.restoredAmount || 0), 0),
  } : null;

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">🎫 {t('scc.title')}</h1>
          <p className="text-sm text-slate-400 mt-0.5">{t('scc.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary" onClick={printLedger}>🖨️ {t('scc.actions.printLedger')}</button>
          <button className="btn btn-secondary" onClick={exportCsv}>📤 {t('scc.actions.exportLedger')}</button>
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem' }}>
        {cards.map((c) => (
          <div key={c.key} className="rounded-xl bg-white/5 border border-white/10 p-3">
            <p className="text-xs text-slate-400 uppercase tracking-wide">{c.label}</p>
            <p className="text-xl font-bold mt-1" style={{ color: c.accent }}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Search + filters */}
      <div className="rounded-xl bg-white/5 border border-white/10 p-3 flex flex-wrap gap-2 items-center">
        <input
          type="text" className="input" style={{ flex: '2 1 220px' }}
          placeholder={t('scc.searchPlaceholder')}
          value={search} onChange={(e) => setSearch(e.target.value)}
        />
        <select className="input" style={{ flex: '0 1 150px' }} value={status} onChange={(e) => setStatus(e.target.value as CenterStatusFilter)}>
          <option value="all">{t('scc.filter.all')}</option>
          <option value="active">{t('scc.filter.active')}</option>
          <option value="redeemed">{t('scc.filter.redeemed')}</option>
          <option value="voided">{t('scc.filter.voided')}</option>
          <option value="expired">{t('scc.filter.expired')}</option>
          <option value="hasRemaining">{t('scc.filter.hasRemaining')}</option>
          <option value="zeroBalance">{t('scc.filter.zeroBalance')}</option>
        </select>
        <select className="input" style={{ flex: '0 1 140px' }} value={source} onChange={(e) => setSource(e.target.value as 'all' | 'return' | 'unknown')}>
          <option value="all">{t('scc.source.all')}</option>
          <option value="return">{t('scc.source.return')}</option>
          <option value="unknown">{t('scc.source.unknown')}</option>
        </select>
        <select className="input" style={{ flex: '0 1 170px' }} value={sort} onChange={(e) => setSort(e.target.value as CenterSort)}>
          <option value="newest">{t('scc.sort.newest')}</option>
          <option value="oldest">{t('scc.sort.oldest')}</option>
          <option value="highestRemaining">{t('scc.sort.highestRemaining')}</option>
          <option value="lowestRemaining">{t('scc.sort.lowestRemaining')}</option>
          <option value="customer">{t('scc.sort.customer')}</option>
          <option value="certificate">{t('scc.sort.certificate')}</option>
          <option value="lastActivity">{t('scc.sort.lastActivity')}</option>
        </select>
        <input type="date" className="input" style={{ flex: '0 1 140px' }} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} title={t('scc.filter.dateFrom')} />
        <input type="date" className="input" style={{ flex: '0 1 140px' }} value={dateTo} onChange={(e) => setDateTo(e.target.value)} title={t('scc.filter.dateTo')} />
        <select className="input" style={{ flex: '0 1 150px' }} value={employee} onChange={(e) => setEmployee(e.target.value)}>
          <option value="">{t('scc.filter.anyEmployee')}</option>
          {issuers.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>

      {/* Main table */}
      <div className="rounded-xl bg-white/5 border border-white/10 overflow-x-auto">
        {rows.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">{t('scc.empty')}</div>
        ) : (
          <table className="w-full text-sm" style={{ minWidth: 900 }}>
            <thead>
              <tr className="text-xs text-slate-400 uppercase" style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                <th className="text-left px-3 py-2">{t('scc.col.certificate')}</th>
                <th className="text-left px-3 py-2">{t('scc.col.customer')}</th>
                <th className="text-left px-3 py-2">{t('scc.col.phone')}</th>
                <th className="text-right px-3 py-2">{t('scc.col.original')}</th>
                <th className="text-right px-3 py-2">{t('scc.col.redeemed')}</th>
                <th className="text-right px-3 py-2">{t('scc.col.remaining')}</th>
                <th className="text-left px-3 py-2">{t('scc.col.status')}</th>
                <th className="text-left px-3 py-2">{t('scc.col.source')}</th>
                <th className="text-left px-3 py-2">{t('scc.col.issuedBy')}</th>
                <th className="text-left px-3 py-2">{t('scc.col.issuedDate')}</th>
                <th className="text-left px-3 py-2">{t('scc.col.lastActivity')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => {
                const badge = STATUS_BADGE[l.status] || STATUS_BADGE.redeemed;
                const src = resolveCertificateSource(l);
                return (
                  <tr
                    key={l.id}
                    onClick={() => setDetail(l)}
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer' }}
                    className="hover:bg-white/5"
                  >
                    <td className="px-3 py-2 font-mono text-sky-300 text-xs font-semibold">{l.certificateNumber}</td>
                    <td className="px-3 py-2 text-slate-200">{l.customerName || '—'}</td>
                    <td className="px-3 py-2 text-slate-400 text-xs">{l.customerPhone || '—'}</td>
                    <td className="px-3 py-2 text-right text-slate-200">{money(l.issuedAmount || 0)}</td>
                    <td className="px-3 py-2 text-right text-slate-400">{money(l.redeemedAmount || 0)}</td>
                    <td className="px-3 py-2 text-right font-bold" style={{ color: (l.remainingAmount || 0) > 0 ? '#10b981' : '#64748b' }}>
                      {money(l.remainingAmount || 0)}
                    </td>
                    <td className="px-3 py-2">
                      <span style={{ padding: '0.1rem 0.5rem', borderRadius: 999, fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', background: badge.bg, color: badge.color }}>
                        {t(`scc.status.${l.status}`)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-400">
                      {t(`scc.source.${src}`)}{l.sourceReturnNumber ? ` · ${l.sourceReturnNumber}` : ''}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-400">{l.issuedByEmployeeName || '—'}</td>
                    <td className="px-3 py-2 text-xs text-slate-400">{fmtDate(l.issuedAt)}</td>
                    <td className="px-3 py-2 text-xs text-slate-400">{fmtDate(lastActivityIso(l))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-slate-500">{t('scc.rowCount', rows.length, summary.totalCount)}</p>

      {/* ── Certificate detail ── */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={`🎫 ${detail?.certificateNumber || ''}`} size="max-w-2xl">
        {detail && (
          <div className="space-y-4">
            {/* Header info */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-xs text-slate-500">{t('scc.col.status')}</p>
                <span style={{ padding: '0.1rem 0.5rem', borderRadius: 999, fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', background: (STATUS_BADGE[detail.status] || STATUS_BADGE.redeemed).bg, color: (STATUS_BADGE[detail.status] || STATUS_BADGE.redeemed).color }}>
                  {t(`scc.status.${detail.status}`)}
                </span>
              </div>
              <div><p className="text-xs text-slate-500">{t('scc.col.customer')}</p><p className="text-slate-200 font-semibold">{detail.customerName || '—'}</p></div>
              <div><p className="text-xs text-slate-500">{t('scc.col.phone')}</p><p className="text-slate-300">{detail.customerPhone || '—'}</p></div>
              <div><p className="text-xs text-slate-500">{t('scc.col.store')}</p><p className="text-slate-300">{detail.storeId || t('scc.legacyStore')}</p></div>
              <div><p className="text-xs text-slate-500">{t('scc.col.issuedDate')}</p><p className="text-slate-300">{fmtDate(detail.issuedAt)}</p></div>
              <div><p className="text-xs text-slate-500">{t('scc.col.issuedBy')}</p><p className="text-slate-300">{detail.issuedByEmployeeName || '—'}</p></div>
              <div>
                <p className="text-xs text-slate-500">{t('scc.col.source')}</p>
                <p className="text-slate-300">{t(`scc.source.${resolveCertificateSource(detail)}`)}{detail.sourceReturnNumber ? ` · ${detail.sourceReturnNumber}` : ''}</p>
              </div>
              {detail.notes && <div className="col-span-2"><p className="text-xs text-slate-500">{t('scc.notes')}</p><p className="text-slate-300 text-xs">{detail.notes}</p></div>}
            </div>

            {/* Financial summary */}
            <div className="grid grid-cols-4 gap-2 rounded-lg bg-white/5 border border-white/10 p-3 text-center">
              <div><p className="text-xs text-slate-500">{t('scc.detail.issuedAmount')}</p><p className="font-bold text-sky-300">{money(detail.issuedAmount || 0)}</p></div>
              <div><p className="text-xs text-slate-500">{t('scc.col.redeemed')}</p><p className="font-bold text-amber-400">{money(detail.redeemedAmount || 0)}</p></div>
              <div><p className="text-xs text-slate-500">{t('scc.detail.reversed')}</p><p className="font-bold text-emerald-300">{money(detailSummary?.reversed || 0)}</p></div>
              <div><p className="text-xs text-slate-500">{t('scc.col.remaining')}</p><p className="font-bold text-emerald-400">{money(detail.remainingAmount || 0)}</p></div>
            </div>

            {/* Timeline */}
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">{t('scc.detail.timeline')}</p>
              <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto pr-1">
                {buildCertificateTimeline(detail).map((ev, i) => {
                  const st = EVENT_STYLE[ev.kind];
                  return (
                    <div key={i} className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-xs">
                      <span>{st.icon}</span>
                      <div className="flex-1 min-w-0">
                        <span className="font-semibold" style={{ color: st.color }}>{t(`scc.event.${ev.kind}`)}</span>
                        {ev.reference && <span className="text-slate-400"> · {ev.reference}</span>}
                        <div className="text-slate-500">{ev.employeeName || '—'} · {fmtDate(ev.atIso)}</div>
                      </div>
                      {ev.kind !== 'void' && (
                        <span className="font-bold" style={{ color: ev.deltaCents >= 0 ? '#34d399' : '#f87171' }}>
                          {ev.deltaCents >= 0 ? '+' : '−'}{money(Math.abs(ev.deltaCents))}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2 justify-end pt-1 border-t border-white/10">
              <button className="btn btn-secondary" onClick={() => viewCustomer(detail)}>👤 {t('scc.actions.viewCustomer')}</button>
              {detail.redemptions?.[0]?.invoiceNumber && (
                <button className="btn btn-secondary" onClick={() => viewRelatedSale(detail.redemptions[0].invoiceNumber!)}>
                  🧾 {t('scc.actions.viewSale')}
                </button>
              )}
              <button className="btn btn-secondary" onClick={() => reprintCertificate(detail)}>🖨️ {t('scc.actions.reprint')}</button>
              {detail.status === 'active' && (
                <button
                  className="btn"
                  style={{ background: 'rgba(239,68,68,0.15)', color: '#fca5a5' }}
                  onClick={() => { setVoidTarget(detail); setVoidReason(''); }}
                >
                  ⛔ {t('scc.actions.voidCert')}
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* ── Void certificate: reason → PIN (existing engine) ── */}
      <Modal open={!!voidTarget && !voidPinOpen} onClose={() => setVoidTarget(null)} title={`⛔ ${t('scc.void.title')}`} size="max-w-md">
        {voidTarget && (
          <div className="space-y-3">
            <p className="text-sm text-slate-300">
              {t('scc.void.confirm', voidTarget.certificateNumber, formatCurrency(voidTarget.remainingAmount || 0))}
            </p>
            <p className="text-xs text-amber-400/90">{t('scc.void.notReversal')}</p>
            <input
              type="text" className="input w-full"
              placeholder={t('scc.void.reasonPlaceholder')}
              value={voidReason} onChange={(e) => setVoidReason(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <button className="btn btn-secondary" onClick={() => setVoidTarget(null)}>{t('common.cancel')}</button>
              <button
                className="btn"
                style={{ background: 'rgba(239,68,68,0.2)', color: '#fca5a5' }}
                disabled={!voidReason.trim()}
                onClick={() => setVoidPinOpen(true)}
              >
                {t('scc.void.continue')}
              </button>
            </div>
          </div>
        )}
      </Modal>
      <AdminPinGate
        open={voidPinOpen && !!voidTarget}
        adminPin={settings.adminPin || ''}
        onSuccess={executeVoid}
        onCancel={() => setVoidPinOpen(false)}
        requireFreshEntry
        lang={locale}
      />
    </div>
  );
}
