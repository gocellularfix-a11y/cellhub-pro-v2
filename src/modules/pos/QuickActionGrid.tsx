// ============================================================
// CellHub Pro — Quick Action Grid
// Exact visual match of the original single-file HTML app
// ============================================================

import { type CSSProperties } from 'react';
import type { CustomCategory } from './types';
import { useTranslation } from '@/i18n';

interface QuickActionGridProps {
  lang: string;
  L: Record<string, any>;
  customCategories: CustomCategory[];
  onSelectCategory: (category: string) => void;
  onPhonePayment: () => void;
  onCredentialMaker: () => void;
  onNotepad: () => void;
  onEstimate: () => void;
  onRMALabel: () => void;
  onLabelPrinter: () => void;
  onAddCategory: () => void;
}

interface ActionDef {
  id: string;
  emoji: string;
  labelKey: string;
  labelFallback: string;
  descKey: string;
  descFallback: string;
  /** rgba color for gradient/border/text */
  r: number; g: number; b: number;
  /** Text color override (hex) */
  textColor: string;
}

const ACTIONS: ActionDef[] = [
  { id: 'credential',    emoji: '🪪', labelKey: 'credentialMaker',    labelFallback: 'Credential Maker',      descKey: 'credentialMakerDesc',    descFallback: 'Generate customer ID cards',         r: 139, g: 92,  b: 246, textColor: '#a78bfa' },
  { id: 'phone_payment', emoji: '📱', labelKey: 'cellphonePayments', labelFallback: 'Cellphone Payments',     descKey: 'cellphonePaymentsDesc', descFallback: 'Bill payments for all carriers',      r: 59,  g: 130, b: 246, textColor: '#60a5fa' },
  { id: 'accessories',   emoji: '🎧', labelKey: 'qaAccessories',     labelFallback: 'Accessories',            descKey: 'qaAccessoriesDesc',     descFallback: 'Cases, chargers, screen protectors',  r: 16,  g: 185, b: 129, textColor: '#34d399' },
  { id: 'cellphones',    emoji: '📱', labelKey: 'qaCellphones',      labelFallback: 'Cellphones',             descKey: 'qaCellphonesDesc',      descFallback: 'Sell phones from inventory',          r: 139, g: 92,  b: 246, textColor: '#a78bfa' },
  // PRINT-DESK-MODULE-V1-UI-ONLY: 'notepad' tile repurposed as Print Desk (id kept to avoid wiring ripple).
  { id: 'notepad',       emoji: '🖨️', labelKey: 'quick.printDesk',    labelFallback: 'Print Desk',             descKey: 'printDeskDesc',         descFallback: 'Paste, rotate & print labels',        r: 251, g: 191, b: 36,  textColor: '#fbbf24' },
  { id: 'estimates',     emoji: '📋', labelKey: 'estimates',         labelFallback: 'Estimates',              descKey: 'estimatesDesc',         descFallback: 'Quick estimate with receipt',         r: 34,  g: 211, b: 238, textColor: '#22d3ee' },
  { id: 'services',      emoji: '🔧', labelKey: 'qaServices',        labelFallback: 'Services',               descKey: 'qaServicesDesc',        descFallback: 'Repairs & unlocking services',        r: 148, g: 163, b: 184, textColor: '#cbd5e1' },
  { id: 'international', emoji: '🌎', labelKey: 'internationalTopUp', labelFallback: 'International Top Up',  descKey: 'qaInternationalTopUpDesc', descFallback: 'Boss Revolution • Tila TopUp',     r: 16, g: 185, b: 129, textColor: '#34d399' },
  { id: 'rma_label',     emoji: '📦', labelKey: 'rmaLabel',          labelFallback: 'RMA Label',              descKey: 'rmaLabelDesc',          descFallback: 'Create return shipping label 4×6',    r: 168, g: 85,  b: 247, textColor: '#a855f7' },
  { id: 'label_printer', emoji: '🏷️', labelKey: 'quick.labelPrinter', labelFallback: 'Label Printer',          descKey: 'labelPrinterDesc',      descFallback: 'Paste & print 4×6 labels',            r: 234, g: 179, b: 8,   textColor: '#fbbf24' },
];

function makeButtonStyle(r: number, g: number, b: number): CSSProperties {
  return {
    background: `linear-gradient(135deg, rgba(${r},${g},${b}, 0.2) 0%, rgba(${r},${g},${b}, 0.1) 100%)`,
    border: `2px solid rgba(${r},${g},${b}, 0.3)`,
    borderRadius: '24px',
    padding: '3rem',
    cursor: 'pointer',
    transition: 'all 0.3s ease',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: '1.5rem',
  };
}

function handleHoverIn(e: React.MouseEvent, r: number, g: number, b: number) {
  const el = e.currentTarget as HTMLElement;
  el.style.transform = 'translateY(-8px)';
  el.style.boxShadow = `0 20px 60px rgba(${r},${g},${b}, 0.3)`;
}

function handleHoverOut(e: React.MouseEvent) {
  const el = e.currentTarget as HTMLElement;
  el.style.transform = 'translateY(0)';
  el.style.boxShadow = 'none';
}

export default function QuickActionGrid({
  lang,
  L,
  customCategories,
  onSelectCategory,
  onPhonePayment,
  onCredentialMaker,
  onNotepad,
  onEstimate,
  onRMALabel,
  onLabelPrinter,
  onAddCategory,
}: QuickActionGridProps) {
  const { t } = useTranslation();
  const handleClick = (id: string) => {
    if (id === 'phone_payment') onPhonePayment();
    else if (id === 'credential') onCredentialMaker();
    else if (id === 'notepad') onNotepad();
    else if (id === 'estimates') onEstimate();
    else if (id === 'rma_label') onRMALabel();
    else if (id === 'label_printer') onLabelPrinter();
    else onSelectCategory(id);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h2 style={{ fontSize: '1.875rem', fontWeight: 700 }}>
            {t('quickActions')}
          </h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
            {t('selectCategoryToBegin')}
          </p>
        </div>
      </div>

      {/* Grid */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: '1.5rem',
        alignContent: 'start',
      }}>
        {/* Built-in action buttons */}
        {ACTIONS.map((action) => (
          <button
            key={action.id}
            onClick={() => handleClick(action.id)}
            style={makeButtonStyle(action.r, action.g, action.b)}
            onMouseEnter={(e) => handleHoverIn(e, action.r, action.g, action.b)}
            onMouseLeave={handleHoverOut}
          >
            <div style={{ fontSize: '5rem', lineHeight: 1 }}>{action.emoji}</div>
            <div style={{ textAlign: 'center' }}>
              <div style={{
                fontSize: '1.75rem',
                fontWeight: 800,
                color: action.textColor,
                marginBottom: '0.5rem',
                textTransform: 'uppercase',
                letterSpacing: '0.02em',
              }}>
                {(() => {
                  const val = t(action.labelKey);
                  return (val && val !== action.labelKey ? val : action.labelFallback).toUpperCase();
                })()}
              </div>
              <div style={{ fontSize: '0.95rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
                {(() => {
                  const val = t(action.descKey);
                  return val && val !== action.descKey ? val : action.descFallback;
                })()}
              </div>
            </div>
          </button>
        ))}

        {/* Custom categories */}
        {customCategories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => onSelectCategory(`custom:${cat.id}`)}
            style={makeButtonStyle(139, 92, 246)}
            onMouseEnter={(e) => handleHoverIn(e, 139, 92, 246)}
            onMouseLeave={handleHoverOut}
          >
            <div style={{ fontSize: '5rem', lineHeight: 1 }}>{cat.icon || '📦'}</div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#a78bfa', textTransform: 'uppercase' }}>
                {lang === 'es' && cat.labelEs ? cat.labelEs : cat.label}
              </div>
              {cat.description && (
                <div style={{ fontSize: '0.95rem', color: 'var(--text-secondary)' }}>{cat.description}</div>
              )}
            </div>
          </button>
        ))}

        {/* Add Category */}
        <button
          onClick={onAddCategory}
          style={{
            background: 'var(--bg-input)',
            border: '2px dashed var(--border-default)',
            borderRadius: '24px',
            padding: '3rem',
            cursor: 'pointer',
            transition: 'all 0.3s ease',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '1.5rem',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-strong)';
            (e.currentTarget as HTMLElement).style.background = 'var(--bg-input)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-default)';
            (e.currentTarget as HTMLElement).style.background = 'var(--bg-input)';
          }}
        >
          <div style={{ fontSize: '4rem', lineHeight: 1, opacity: 0.5 }}>➕</div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              {t('qaAddCategory')}
            </div>
            <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              {t('qaAddCategoryDesc')}
            </div>
          </div>
        </button>
      </div>
    </div>
  );
}
