// OperatorSidebar — Phase 1 placeholder shell
// Phase 2: full Operator State panel, scored Suggested Actions, live Task feed.
import { useTranslation } from '@/i18n';
import { formatCurrency } from '@/utils/currency';

const SIDEBAR_BG     = '#0D1626';
const SIDEBAR_BORDER = '#1F2937';

export interface OperatorSidebarProps {
  todayRevenue: number;
  todaySalesCount: number;
  totalAlerts: number;
  staleRecoverable: number;
  deadStockLocked: number;
  productOppsCount: number;
  outreachCount: number;
  repairsPending: number;
  staleRepairCount: number;
  biggestLeak: number;
  onFireChat: (text: string) => void;
  // R-FINANCIAL-PRIVACY-V3: when false the "Fix profit" button is hidden
  // entirely. Default true so callers that don't pass the prop keep
  // the existing behavior.
  canSeeOwnerFinancials?: boolean;
}

export default function OperatorSidebar({
  todayRevenue,
  todaySalesCount,
  totalAlerts,
  staleRecoverable,
  deadStockLocked,
  productOppsCount,
  outreachCount,
  repairsPending,
  staleRepairCount,
  biggestLeak,
  onFireChat,
  canSeeOwnerFinancials = true,
}: OperatorSidebarProps) {
  const { t, locale } = useTranslation();

  const repairStat = repairsPending > 0
    ? staleRepairCount > 0
      ? `${repairsPending} · ${staleRepairCount} ${t('intelligence.console.staleLabel')}`
      : String(repairsPending)
    : undefined;

  const collectStat = staleRecoverable >= 2000
    ? formatCurrency(staleRecoverable)
    : deadStockLocked > 0
      ? formatCurrency(deadStockLocked)
      : undefined;

  return (
    <div
      style={{
        background: SIDEBAR_BG,
        borderRight: `1px solid ${SIDEBAR_BORDER}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '12px 10px',
        overflowY: 'auto',
      }}
    >
      {/* Stats strip */}
      <div style={{ paddingBottom: 10, borderBottom: `1px solid ${SIDEBAR_BORDER}` }}>
        <div style={{
          fontSize: 10, fontWeight: 700, color: '#4B5563',
          letterSpacing: '0.1em', marginBottom: 8, textTransform: 'uppercase',
        }}>
          {t('intelligence.console.todayLabel')}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <StatRow label={t('intelligence.console.salesAbbr')} value={formatCurrency(todayRevenue)} valueColor="#34D399" />
          <StatRow label={t('intelligence.console.ordersAbbr')} value={String(todaySalesCount)} />
          {totalAlerts > 0 && (
            <StatRow label={t('intelligence.console.alertsAbbr')} value={String(totalAlerts)} valueColor="#FBBF24" />
          )}
        </div>
      </div>

      {/* Action shortcuts */}
      <div style={{
        fontSize: 10, fontWeight: 700, color: '#4B5563',
        letterSpacing: '0.1em', textTransform: 'uppercase',
      }}>
        {t('intelligence.console.makeMoneyTitle')}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <SidebarBtn
          icon="💰"
          label={t('intelligence.console.collectMoneyTitle')}
          stat={collectStat}
          accent="#10B981"
          onClick={() => onFireChat('where is money stuck')}
        />
        <SidebarBtn
          icon="🤝"
          label={t('intelligence.console.closeDealsTitle')}
          accent="#22C55E"
          onClick={() => onFireChat('help me close sales today')}
        />
        <SidebarBtn
          icon="🚀"
          label={t('intelligence.console.promoteProduct')}
          stat={productOppsCount > 0 ? String(productOppsCount) : undefined}
          accent="#8B5CF6"
          onClick={() => onFireChat(t('intelligence.console.queryPromoteThis') || 'promote product')}
        />
        <SidebarBtn
          icon="📞"
          label={t('intelligence.console.contactCustomers')}
          stat={outreachCount >= 2 ? String(outreachCount) : undefined}
          accent="#3B82F6"
          onClick={() => onFireChat(t('intelligence.console.queryContactToday') || 'who should I contact today')}
        />
        <SidebarBtn
          icon="🔧"
          label={t('intelligence.console.repairsReadyTitle')}
          stat={repairStat}
          accent="#F59E0B"
          onClick={() => onFireChat(t('intelligence.console.queryReadyRepairs') || 'repairs ready for pickup')}
        />
        {/* R-FINANCIAL-PRIVACY-V3: hide the "Fix profit" quick-chat button
            when the viewer is not admin/owner. The chat itself still
            short-circuits the underlying intent, but hiding the entry
            point removes the temptation. */}
        {canSeeOwnerFinancials && (
          <SidebarBtn
            icon="💸"
            label={t('intelligence.console.fixProfitTitle')}
            stat={biggestLeak > 0 ? formatCurrency(biggestLeak) : undefined}
            accent="#EF4444"
            onClick={() => onFireChat(t('intelligence.dash.quickProfit') || 'where am I losing profit')}
          />
        )}
      </div>

      {/* Phase 2 placeholder */}
      <div style={{
        marginTop: 'auto', padding: '10px 8px',
        borderTop: `1px solid ${SIDEBAR_BORDER}`,
        fontSize: 10, color: '#374151', fontStyle: 'italic', textAlign: 'center',
      }}>
        {locale === 'es' ? 'Estado y tareas — próximamente'
         : locale === 'pt' ? 'Estado e tarefas — em breve'
         : 'Operator state & tasks — coming soon'}
      </div>
    </div>
  );
}

function StatRow({ label, value, valueColor = '#D1D5DB' }: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <span style={{ fontSize: 11, color: '#6B7280' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: valueColor }}>{value}</span>
    </div>
  );
}

function SidebarBtn({ icon, label, stat, accent, onClick }: {
  icon: string;
  label: string;
  stat?: string;
  accent: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '7px 9px',
        borderRadius: 6,
        background: accent + '0D',
        border: `1px solid ${accent}33`,
        cursor: 'pointer',
        width: '100%',
        textAlign: 'left',
        transition: 'background 0.12s',
      }}
    >
      <span style={{ fontSize: 15, lineHeight: 1, flexShrink: 0 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12, fontWeight: 600, color: accent,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          lineHeight: '1.25',
        }}>
          {label}
        </div>
        {stat && (
          <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 1 }}>{stat}</div>
        )}
      </div>
    </button>
  );
}
