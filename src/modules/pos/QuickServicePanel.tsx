// ============================================================
// CellHub Pro — Quick Service Panel
// Shown inline in POS when "Services" category is selected.
// Three quick-charge buttons: Repair, Unlock, Activation.
// No customer data — just amount + optional description + tax toggle → cart.
// ============================================================

import { useState } from 'react';
import { generateId } from '@/utils/dates';
import { formatCurrency, toCents } from '@/utils/currency';
import { forwardTaxFromBase } from '@/utils/depositTax';
import { useTranslation } from '@/i18n';
import type { CartItem } from '@/store/types';

interface QuickServicePanelProps {
  lang: string;
  taxRate: number;
  onAddToCart: (item: CartItem) => void;
  onBack: () => void;
}

type ServiceType = 'repair' | 'unlock' | 'activation';

const SERVICE_CONFIG: Record<ServiceType, { emoji: string; labelKey: string; r: number; g: number; b: number }> = {
  repair:     { emoji: '🔧', labelKey: 'quickServicePanel.service.repair',     r: 251, g: 146, b: 60  },
  unlock:     { emoji: '🔓', labelKey: 'quickServicePanel.service.unlock',     r: 139, g: 92,  b: 246 },
  activation: { emoji: '📶', labelKey: 'quickServicePanel.service.activation', r: 16,  g: 185, b: 129 },
};

export default function QuickServicePanel({ lang, taxRate, onAddToCart, onBack }: QuickServicePanelProps) {
  const { t } = useTranslation();
  // lang prop kept for parent compat — vestigial after migration
  const [selected, setSelected] = useState<ServiceType | null>(null);
  const [amount, setAmount] = useState('');
  const [taxable, setTaxable] = useState(false);
  const [description, setDescription] = useState('');

  // Single source of truth for amount/tax math — matches cart behavior so the
  // preview total below can never diverge from what POS will charge.
  const subtotalCents = toCents(amount);
  const fwd = forwardTaxFromBase(subtotalCents, taxRate, taxable);

  const handleAddToCart = () => {
    if (subtotalCents <= 0 || !selected) return;
    const cfg = SERVICE_CONFIG[selected];
    const label = t(cfg.labelKey);

    const cartItem: CartItem = {
      id: generateId(),
      name: `${cfg.emoji} ${label}${description.trim() ? ` — ${description.trim()}` : ''}`,
      category: 'service',
      price: subtotalCents,
      qty: 1,
      taxable,
      cbeEligible: false,
    };

    onAddToCart(cartItem);
    // Reset for next quick charge
    setSelected(null);
    setAmount('');
    setTaxable(false);
    setDescription('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header with back button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
        <button
          onClick={onBack}
          style={{
            background: 'var(--bg-input)',
            border: '1px solid var(--border-default)',
            borderRadius: '8px',
            color: 'var(--text-secondary)',
            padding: '0.5rem 0.75rem',
            cursor: 'pointer',
            fontSize: '0.85rem',
          }}
        >
          ← {t('quickServicePanel.back')}
        </button>
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 800, margin: 0 }}>
            ⚡ {t('quickServicePanel.title')}
          </h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.25rem 0 0' }}>
            {t('quickServicePanel.subtitle')}
          </p>
        </div>
      </div>

      {/* Service type buttons */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
        {(Object.keys(SERVICE_CONFIG) as ServiceType[]).map((key) => {
          const cfg = SERVICE_CONFIG[key];
          const isActive = selected === key;
          return (
            <button
              key={key}
              onClick={() => {
                setSelected(key);
                setAmount('');
                setTaxable(false);
                setDescription('');
              }}
              style={{
                background: isActive
                  ? `linear-gradient(135deg, rgba(${cfg.r},${cfg.g},${cfg.b}, 0.3) 0%, rgba(${cfg.r},${cfg.g},${cfg.b}, 0.15) 100%)`
                  : `linear-gradient(135deg, rgba(${cfg.r},${cfg.g},${cfg.b}, 0.12) 0%, rgba(${cfg.r},${cfg.g},${cfg.b}, 0.04) 100%)`,
                border: isActive
                  ? `3px solid rgba(${cfg.r},${cfg.g},${cfg.b}, 0.7)`
                  : `2px solid rgba(${cfg.r},${cfg.g},${cfg.b}, 0.25)`,
                borderRadius: '16px',
                padding: '2rem 1rem',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                display: 'flex',
                flexDirection: 'column' as const,
                alignItems: 'center',
                gap: '0.75rem',
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.transform = 'translateY(-4px)';
                  (e.currentTarget as HTMLElement).style.boxShadow = `0 12px 30px rgba(${cfg.r},${cfg.g},${cfg.b}, 0.2)`;
                }
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
                (e.currentTarget as HTMLElement).style.boxShadow = 'none';
              }}
            >
              <div style={{ fontSize: '3rem' }}>{cfg.emoji}</div>
              <div style={{
                fontSize: '1.1rem',
                fontWeight: 800,
                color: `rgb(${cfg.r},${cfg.g},${cfg.b})`,
                textTransform: 'uppercase',
                letterSpacing: '0.03em',
              }}>
                {t(cfg.labelKey)}
              </div>
            </button>
          );
        })}
      </div>

      {/* Amount form — only when a service is selected */}
      {selected && (
        <div style={{
          padding: '1.5rem',
          background: 'var(--bg-input)',
          border: '1px solid var(--border-default)',
          borderRadius: '16px',
        }}>
          {/* Amount input */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.4rem', fontWeight: 600 }}>
              {t('quickServicePanel.amountLabel')} *
            </label>
            <input
              type="number"
              className="input"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              step="0.01"
              min="0"
              autoFocus
              style={{ fontSize: '1.5rem', fontWeight: 700, textAlign: 'center' }}
            />
          </div>

          {/* Optional description */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.4rem', fontWeight: 600 }}>
              {t('quickServicePanel.descriptionLabel')}
            </label>
            <input
              type="text"
              className="input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('quickServicePanel.descriptionPlaceholder')}
            />
          </div>

          {/* Tax toggle */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.6rem 0.75rem',
            background: 'var(--bg-input)',
            borderRadius: '8px',
            border: '1px solid var(--border-default)',
            marginBottom: '1.25rem',
          }}>
            <input
              type="checkbox"
              id="quick-service-tax"
              checked={taxable}
              onChange={(e) => setTaxable(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            <label htmlFor="quick-service-tax" style={{ fontSize: '0.85rem', color: 'var(--text-primary)', cursor: 'pointer', flex: 1 }}>
              {t('quickServicePanel.chargeTaxRate', (taxRate * 100).toFixed(2))}
            </label>
            {taxable && subtotalCents > 0 && (
              <span style={{ fontSize: '0.78rem', color: '#f59e0b', fontWeight: 600 }}>
                +{formatCurrency(fwd.taxCents)}
              </span>
            )}
          </div>

          {/* Total preview + Add to cart button */}
          {subtotalCents > 0 && (
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '0.75rem 1rem',
              background: 'rgba(16,185,129,0.08)',
              border: '1px solid rgba(16,185,129,0.2)',
              borderRadius: '10px',
              marginBottom: '1rem',
            }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', fontWeight: 600 }}>
                {t('quickServicePanel.totalLabel')}
              </span>
              <span style={{ color: '#10b981', fontSize: '1.25rem', fontWeight: 800 }}>
                {formatCurrency(fwd.totalCents)}
              </span>
            </div>
          )}

          <button
            onClick={handleAddToCart}
            disabled={subtotalCents <= 0}
            className="btn btn-primary"
            style={{
              width: '100%',
              padding: '0.85rem',
              fontSize: '1rem',
              fontWeight: 700,
              opacity: subtotalCents <= 0 ? 0.4 : 1,
            }}
          >
            🛒 {t('addToCart')}
          </button>
        </div>
      )}

      {/* Empty state when no service selected */}
      {!selected && (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: '3rem', opacity: 0.3, marginBottom: '0.75rem' }}>👆</div>
          <p>{t('quickServicePanel.emptyHint')}</p>
        </div>
      )}
    </div>
  );
}
