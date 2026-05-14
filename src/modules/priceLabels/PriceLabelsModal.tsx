import { useMemo } from 'react';
import { useApp } from '@/store/AppProvider';
import { PriceLabels } from './index';
import { CellHubProductAdapter } from './adapters/CellHubProductAdapter';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function PriceLabelsModal({ open, onClose }: Props) {
  const { state: { inventory } } = useApp();
  const adapter = useMemo(() => new CellHubProductAdapter(inventory), [inventory]);

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9000,
        background: 'var(--bg-base, #0f172a)',
        overflowY: 'auto',
      }}
    >
      {/* Close button — fixed so it stays visible while scrolling */}
      <button
        onClick={onClose}
        style={{
          position: 'fixed',
          top: '1rem',
          right: '1rem',
          zIndex: 9001,
          background: 'rgba(239,68,68,0.15)',
          border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: '10px',
          color: '#f87171',
          padding: '0.4rem 0.9rem',
          cursor: 'pointer',
          fontSize: '0.85rem',
          fontWeight: 600,
        }}
      >
        ✕ Close
      </button>

      <PriceLabels adapter={adapter} />
    </div>
  );
}
