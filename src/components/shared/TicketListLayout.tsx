// ============================================================
// CellHub Pro — Shared Ticket List Layout
// Reusable list view for Repairs, Unlocks, Special Orders
//
// r-global-search: search/onSearchChange/searchPlaceholder are now OPTIONAL.
// Modules can render their own <GlobalSearchBar> separately (via headerActions
// or before the layout) and pass nothing to disable the internal SearchInput.
// When omitted, the internal SearchInput simply doesn't render.
// ============================================================

import { type ReactNode } from 'react';
import { SearchInput } from '@/components/ui';
import { useTranslation } from '@/i18n';
import { useLanReadOnlyMode } from '@/hooks/useLanReadOnly';

interface StatCard {
  label: string;
  value: string | number;
  color?: string;
  sub?: string;
}

interface TicketListLayoutProps {
  /** Module title */
  title: string;
  /** Emoji icon */
  icon: string;
  /** Status filter tabs */
  statuses: string[];
  activeStatus: string;
  onStatusChange: (status: string) => void;
  /** Translate status for display */
  translateStatus: (status: string) => string;
  /** Search — r-global-search: now optional. Omit when the parent module
   *  renders <GlobalSearchBar> instead. */
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  /** Stat cards at top */
  stats: StatCard[];
  /** New ticket button */
  onNew: () => void;
  newLabel: string;
  /** The list content (rendered by parent) */
  children: ReactNode;
  /** Optional extra header actions */
  headerActions?: ReactNode;
  /** r-global-search: optional slot rendered above the status tabs.
   *  Used by ticket modules to mount <GlobalSearchBar> while keeping
   *  the rest of the layout intact. */
  globalSearchSlot?: ReactNode;
}

export default function TicketListLayout({
  title,
  icon,
  statuses,
  activeStatus,
  onStatusChange,
  translateStatus,
  search,
  onSearchChange,
  searchPlaceholder,
  stats,
  onNew,
  newLabel,
  children,
  headerActions,
  globalSearchSlot,
}: TicketListLayoutProps) {
  const { t } = useTranslation();
  // SECONDARY-UI-LOCK-V1: block "New" on a read-only LAN Secondary.
  const readOnly = useLanReadOnlyMode();
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">
          {icon} {title}
        </h1>
        <div className="flex gap-3">
          {headerActions}
          <button
            onClick={onNew}
            className="btn btn-primary"
            disabled={readOnly}
            title={readOnly ? t('lan.readOnlyTooltip') : undefined}
            style={readOnly ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
          >
            + {newLabel}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {stats.map((stat, i) => (
          <div key={i} className="stat-card">
            <p className="text-xs text-slate-400 uppercase tracking-wide">{stat.label}</p>
            <p className={`text-2xl font-bold mt-1 ${stat.color || 'text-white'}`}>
              {stat.value}
            </p>
            {stat.sub && <p className="text-xs text-slate-500 mt-1">{stat.sub}</p>}
          </div>
        ))}
      </div>

      {/* r-global-search: optional slot for the parent's GlobalSearchBar */}
      {globalSearchSlot}

      {/* Status filter tabs */}
      <div className="flex gap-1 flex-wrap">
        {statuses.map((status) => (
          <button
            key={status}
            onClick={() => onStatusChange(status)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeStatus === status
                ? 'bg-brand-500 text-white'
                : 'bg-white/5 text-slate-400 hover:bg-white/10'
            }`}
          >
            {translateStatus(status)}
          </button>
        ))}
      </div>

      {/* Search — r-global-search: only render when caller provides search props.
          Modules using GlobalSearchBar via globalSearchSlot omit these props. */}
      {search !== undefined && onSearchChange && (
        <SearchInput
          value={search}
          onChange={onSearchChange}
          placeholder={searchPlaceholder || 'Search…'}
        />
      )}

      {/* List content */}
      <div className="space-y-2">
        {children}
      </div>
    </div>
  );
}
