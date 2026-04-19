// ============================================================
// CellHub Pro — Shared inline styles for Tax tab components
// ============================================================

import type { CSSProperties } from 'react';

export const inputStyle: CSSProperties = {
  width: '100%',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '0.5rem',
  padding: '0.55rem 0.75rem',
  color: '#e2e8f0',
  fontSize: '0.85rem',
  outline: 'none',
};

export const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: '0.7rem',
  color: '#94a3b8',
  marginBottom: '0.3rem',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
};

export const thStyle: CSSProperties = {
  padding: '0.7rem 0.875rem',
  textAlign: 'left',
  fontSize: '0.7rem',
  color: '#94a3b8',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

export const tdStyle: CSSProperties = {
  padding: '0.7rem 0.875rem',
  fontSize: '0.82rem',
  color: '#cbd5e1',
};

export const iconBtnStyle = (color: 'blue' | 'red'): CSSProperties => ({
  background: color === 'blue' ? 'rgba(59,130,246,0.12)' : 'rgba(239,68,68,0.12)',
  border: `1px solid ${color === 'blue' ? 'rgba(59,130,246,0.35)' : 'rgba(239,68,68,0.35)'}`,
  borderRadius: '0.4rem',
  padding: '0.3rem 0.55rem',
  fontSize: '0.75rem',
  cursor: 'pointer',
});

export const modalOverlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.7)',
  backdropFilter: 'blur(4px)',
  zIndex: 200,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '1rem',
};

export const modalCard: CSSProperties = {
  background: '#0f172a',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '1rem',
  padding: '1.5rem',
  maxWidth: '560px',
  width: '100%',
  maxHeight: '90vh',
  overflowY: 'auto',
  boxShadow: '0 25px 50px -12px rgba(0,0,0,0.8)',
};

export const btnSecondaryStyle: CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '0.5rem',
  padding: '0.65rem 1.25rem',
  color: '#cbd5e1',
  fontSize: '0.85rem',
  fontWeight: 600,
  cursor: 'pointer',
};

export const btnPrimaryStyle: CSSProperties = {
  background: 'linear-gradient(135deg, #22d3ee, #0891b2)',
  border: 'none',
  borderRadius: '0.5rem',
  padding: '0.65rem 1.5rem',
  color: '#0f172a',
  fontSize: '0.85rem',
  fontWeight: 700,
  cursor: 'pointer',
};

export const btnAddStyle: CSSProperties = {
  background: 'linear-gradient(135deg, #22d3ee, #0891b2)',
  border: 'none',
  borderRadius: '0.5rem',
  padding: '0.6rem 1.1rem',
  color: '#0f172a',
  fontSize: '0.82rem',
  fontWeight: 700,
  cursor: 'pointer',
};

export const cardBox: CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '0.75rem',
  padding: '1rem',
  marginBottom: '0.875rem',
};
