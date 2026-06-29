/**
 * CellHubCommandCenterMockup.tsx
 *
 * STATIC VISUAL MOCKUP ONLY. No business logic, no real data, no routing.
 * Pixel-precision recreation of the CellHub Pro command-center dashboard.
 *
 * Spec source-of-truth:
 *   - Sidebar 248px / Topbar 72px / main padding 20px
 *   - Section gap 18px / card gap 16px
 *   - Radii: cards 18px, pills 999px, buttons 14px
 *   - Hero 520×360, module cards 170h, grid 520px repeat(3, 1fr)
 *   - Inter typography, Lucide-style stroke 1.8 icons (inlined SVG, no new dep)
 */

import React, { CSSProperties } from 'react';

// ────────────────────────────────────────────────────────────────────────────
// Design tokens
// ────────────────────────────────────────────────────────────────────────────

const C = {
  bg: '#050816',
  panel: '#0B1020',
  panel2: '#10182B',
  border: 'rgba(255,255,255,0.06)',
  borderStrong: 'rgba(255,255,255,0.10)',
  purple: '#A855F7',
  purpleGlow: 'rgba(168,85,247,0.35)',
  blue: '#0EA5E9',
  green: '#10B981',
  orange: '#F59E0B',
  red: '#EF4444',
  text: '#FFFFFF',
  muted: '#94A3B8',
  dim: '#64748B',
};

const FONT =
  '"Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

// ────────────────────────────────────────────────────────────────────────────
// Inline Lucide-style SVG icons (stroke 1.8)
// ────────────────────────────────────────────────────────────────────────────

type IconProps = { size?: number; className?: string; style?: CSSProperties };

const baseSvg = (size = 22): React.SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
});

const Icon = {
  Home: (p: IconProps) => (
    <svg {...baseSvg(p.size)} style={p.style}>
      <path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
    </svg>
  ),
  LayoutDashboard: (p: IconProps) => (
    <svg {...baseSvg(p.size)} style={p.style}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  Wrench: (p: IconProps) => (
    <svg {...baseSvg(p.size)} style={p.style}>
      <path d="M14.7 6.3a4 4 0 0 0 5 5l-9 9a2.83 2.83 0 1 1-4-4z" />
      <path d="m13 9 6 6" />
    </svg>
  ),
  Package: (p: IconProps) => (
    <svg {...baseSvg(p.size)} style={p.style}>
      <path d="M16.5 9.4 7.55 4.24" />
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </svg>
  ),
  Users: (p: IconProps) => (
    <svg {...baseSvg(p.size)} style={p.style}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  Unlock: (p: IconProps) => (
    <svg {...baseSvg(p.size)} style={p.style}>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
    </svg>
  ),
  Clipboard: (p: IconProps) => (
    <svg {...baseSvg(p.size)} style={p.style}>
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    </svg>
  ),
  Calendar: (p: IconProps) => (
    <svg {...baseSvg(p.size)} style={p.style}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  ),
  Brain: (p: IconProps) => (
    <svg {...baseSvg(p.size)} style={p.style}>
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24A2.5 2.5 0 0 1 9.5 2" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24A2.5 2.5 0 0 0 14.5 2" />
    </svg>
  ),
  BarChart: (p: IconProps) => (
    <svg {...baseSvg(p.size)} style={p.style}>
      <line x1="12" y1="20" x2="12" y2="10" />
      <line x1="18" y1="20" x2="18" y2="4" />
      <line x1="6" y1="20" x2="6" y2="16" />
      <line x1="3" y1="20" x2="21" y2="20" />
    </svg>
  ),
  Settings: (p: IconProps) => (
    <svg {...baseSvg(p.size)} style={p.style}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.09a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  Search: (p: IconProps) => (
    <svg {...baseSvg(p.size)} style={p.style}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  ),
  Cash: (p: IconProps) => (
    <svg {...baseSvg(p.size)} style={p.style}>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="3" />
      <path d="M6 12h.01M18 12h.01" />
    </svg>
  ),
  Bell: (p: IconProps) => (
    <svg {...baseSvg(p.size)} style={p.style}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  ),
  ChevronRight: (p: IconProps) => (
    <svg {...baseSvg(p.size)} style={p.style}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  ),
  ArrowRight: (p: IconProps) => (
    <svg {...baseSvg(p.size)} style={p.style}>
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  ),
  Phone: (p: IconProps) => (
    <svg {...baseSvg(p.size)} style={p.style}>
      <rect x="6" y="2" width="12" height="20" rx="2" />
      <path d="M11 18h2" />
    </svg>
  ),
  Headphones: (p: IconProps) => (
    <svg {...baseSvg(p.size)} style={p.style}>
      <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
      <path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z" />
    </svg>
  ),
  Wallet: (p: IconProps) => (
    <svg {...baseSvg(p.size)} style={p.style}>
      <path d="M20 12V8a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
    </svg>
  ),
  CreditCard: (p: IconProps) => (
    <svg {...baseSvg(p.size)} style={p.style}>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
    </svg>
  ),
  FileText: (p: IconProps) => (
    <svg {...baseSvg(p.size)} style={p.style}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
    </svg>
  ),
  RotateCcw: (p: IconProps) => (
    <svg {...baseSvg(p.size)} style={p.style}>
      <path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-6.36 2.64L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  ),
  Shield: (p: IconProps) => (
    <svg {...baseSvg(p.size)} style={p.style}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  Sparkles: (p: IconProps) => (
    <svg {...baseSvg(p.size)} style={p.style}>
      <path d="m12 3-1.9 5.1L5 10l5.1 1.9L12 17l1.9-5.1L19 10l-5.1-1.9z" />
      <path d="M5 3v4M3 5h4M19 17v4M17 19h4" />
    </svg>
  ),
  Bot: (p: IconProps) => (
    <svg {...baseSvg(p.size)} style={p.style}>
      <rect x="3" y="8" width="18" height="12" rx="3" />
      <path d="M12 8V4M8 4h8" />
      <circle cx="9" cy="14" r="1" />
      <circle cx="15" cy="14" r="1" />
    </svg>
  ),
  Clock: (p: IconProps) => (
    <svg {...baseSvg(p.size)} style={p.style}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  Store: (p: IconProps) => (
    <svg {...baseSvg(p.size)} style={p.style}>
      <path d="M3 9V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4l-2 2-2-2-2 2-2-2-2 2-2-2-2 2-2-2z" />
      <path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8" />
    </svg>
  ),
};

// ────────────────────────────────────────────────────────────────────────────
// Reusable primitives
// ────────────────────────────────────────────────────────────────────────────

const Badge: React.FC<{
  tone?: 'red' | 'amber' | 'green' | 'blue' | 'slate';
  children: React.ReactNode;
}> = ({ tone = 'slate', children }) => {
  const tones: Record<string, { bg: string; bd: string; tx: string; gl: string }> = {
    red:   { bg: 'rgba(239,68,68,0.14)',  bd: 'rgba(239,68,68,0.45)',  tx: '#FCA5A5', gl: 'rgba(239,68,68,0.22)' },
    amber: { bg: 'rgba(245,158,11,0.14)', bd: 'rgba(245,158,11,0.45)', tx: '#FCD34D', gl: 'rgba(245,158,11,0.22)' },
    green: { bg: 'rgba(16,185,129,0.14)', bd: 'rgba(16,185,129,0.45)', tx: '#6EE7B7', gl: 'rgba(16,185,129,0.22)' },
    blue:  { bg: 'rgba(14,165,233,0.14)', bd: 'rgba(14,165,233,0.45)', tx: '#7DD3FC', gl: 'rgba(14,165,233,0.22)' },
    slate: { bg: 'rgba(148,163,184,0.10)',bd: 'rgba(148,163,184,0.30)',tx: '#CBD5E1', gl: 'transparent' },
  };
  const t = tones[tone];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 10px',
        borderRadius: 999,
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: 0.2,
        color: t.tx,
        background: t.bg,
        border: `1px solid ${t.bd}`,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.05), 0 0 14px ${t.gl}`,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
};

const Pill: React.FC<{
  tone?: 'red' | 'amber' | 'green' | 'blue' | 'neutral';
  icon?: React.ReactNode;
  children: React.ReactNode;
}> = ({ tone = 'neutral', icon, children }) => {
  const tones: Record<string, { bg: string; bd: string; tx: string; gl: string }> = {
    red:     { bg: 'linear-gradient(180deg,rgba(239,68,68,0.14),rgba(239,68,68,0.04))',  bd: 'rgba(239,68,68,0.42)',  tx: '#FECACA', gl: 'rgba(239,68,68,0.18)' },
    amber:   { bg: 'linear-gradient(180deg,rgba(245,158,11,0.14),rgba(245,158,11,0.04))', bd: 'rgba(245,158,11,0.42)', tx: '#FDE68A', gl: 'rgba(245,158,11,0.18)' },
    green:   { bg: 'linear-gradient(180deg,rgba(16,185,129,0.14),rgba(16,185,129,0.04))', bd: 'rgba(16,185,129,0.42)', tx: '#BBF7D0', gl: 'rgba(16,185,129,0.18)' },
    blue:    { bg: 'linear-gradient(180deg,rgba(14,165,233,0.14),rgba(14,165,233,0.04))', bd: 'rgba(14,165,233,0.42)', tx: '#BAE6FD', gl: 'rgba(14,165,233,0.18)' },
    neutral: { bg: 'linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.015))', bd: C.border, tx: '#CFD5E3', gl: 'rgba(0,0,0,0.3)' },
  };
  const t = tones[tone];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 14px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        color: t.tx,
        background: t.bg,
        border: `1px solid ${t.bd}`,
        boxShadow: `0 8px 22px ${t.gl}, inset 0 1px 0 rgba(255,255,255,0.05)`,
        whiteSpace: 'nowrap',
        fontFamily: FONT,
      }}
    >
      {icon}
      {children}
    </span>
  );
};

// ────────────────────────────────────────────────────────────────────────────
// Sidebar
// ────────────────────────────────────────────────────────────────────────────

type NavItem = {
  icon: React.ReactNode;
  label: string;
  badge?: { tone: 'red' | 'amber' | 'green' | 'blue' | 'slate'; text: string };
  active?: boolean;
};

const navItems: NavItem[] = [
  { icon: <Icon.Home />,            label: 'Home',         active: true },
  { icon: <Icon.LayoutDashboard />, label: 'Dashboard' },
  { icon: <Icon.Wrench />,          label: 'Repairs',      badge: { tone: 'red',   text: '3' } },
  { icon: <Icon.Package />,         label: 'Inventory',    badge: { tone: 'amber', text: '374' } },
  { icon: <Icon.Users />,           label: 'Customers' },
  { icon: <Icon.Unlock />,          label: 'Unlocks' },
  { icon: <Icon.Clipboard />,       label: 'Orders',       badge: { tone: 'amber', text: '2' } },
  { icon: <Icon.Calendar />,        label: 'Appointments', badge: { tone: 'green', text: '4' } },
  { icon: <Icon.Brain />,           label: 'Intelligence', badge: { tone: 'blue',  text: '5' } },
  { icon: <Icon.BarChart />,        label: 'Reports' },
  { icon: <Icon.Settings />,        label: 'Settings' },
];

const Sidebar: React.FC = () => (
  <aside
    style={{
      width: 248,
      flex: '0 0 248px',
      height: '100vh',
      background: `linear-gradient(180deg, #06081A 0%, ${C.panel} 40%, #060818 100%)`,
      borderRight: `1px solid ${C.border}`,
      padding: '20px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      position: 'relative',
      overflow: 'hidden',
      boxShadow: '8px 0 40px rgba(0,0,0,0.45), inset -1px 0 0 rgba(255,255,255,0.02)',
      fontFamily: FONT,
    }}
  >
    {/* Top ambient glow */}
    <div
      style={{
        position: 'absolute',
        inset: '-2px auto auto -2px',
        width: '140%',
        height: 280,
        pointerEvents: 'none',
        background:
          'radial-gradient(280px 200px at 20% 0%, rgba(168,85,247,0.30), transparent 70%), radial-gradient(220px 160px at 80% 6%, rgba(14,165,233,0.14), transparent 70%)',
      }}
    />
    {/* Bottom ambient glow */}
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: 220,
        pointerEvents: 'none',
        background: 'radial-gradient(220px 140px at 50% 100%, rgba(168,85,247,0.18), transparent 70%)',
      }}
    />

    {/* Logo */}
    <div style={{ position: 'relative', padding: '6px 8px 4px', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div
        style={{
          fontWeight: 800,
          fontSize: 22,
          letterSpacing: -0.5,
          background: 'linear-gradient(120deg,#C4B5FD 0%,#A855F7 45%,#60A5FA 80%,#22D3EE)',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
          filter: 'drop-shadow(0 4px 14px rgba(168,85,247,0.40))',
        }}
      >
        CellHub Pro
      </div>
      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.34em', color: '#525C70' }}>
        GO CELLULAR
      </div>
    </div>

    {/* Profile card */}
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 11,
        padding: '11px 12px',
        borderRadius: 14,
        background: 'linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.012))',
        border: `1px solid ${C.border}`,
        boxShadow: '0 1px 0 rgba(255,255,255,0.05) inset, 0 8px 22px rgba(0,0,0,0.40)',
      }}
    >
      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          fontWeight: 700,
          fontSize: 12.5,
          color: '#fff',
          position: 'relative',
          background:
            'radial-gradient(20px 14px at 30% 25%, rgba(255,255,255,0.40), transparent 65%), linear-gradient(135deg,#A855F7,#3B82F6)',
          boxShadow:
            '0 0 0 1px rgba(255,255,255,0.12) inset, 0 8px 22px rgba(168,85,247,0.45), 0 0 18px rgba(168,85,247,0.30)',
        }}
      >
        JO
        <span
          style={{
            position: 'absolute',
            right: -2,
            bottom: -2,
            width: 11,
            height: 11,
            borderRadius: '50%',
            background: '#10B981',
            border: `2px solid ${C.bg}`,
            boxShadow: '0 0 10px rgba(16,185,129,0.80)',
          }}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, lineHeight: 1.18 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#EEF0F6' }}>Jorge Ochoa</div>
        <div style={{ fontSize: 10.5, color: C.muted }}>Owner</div>
      </div>
    </div>

    {/* Nav */}
    <nav style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 4, marginTop: 2 }}>
      {navItems.map((item) => (
        <a
          key={item.label}
          href="#"
          onClick={(e) => e.preventDefault()}
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            gap: 11,
            height: 42,
            padding: '0 12px',
            borderRadius: 14,
            textDecoration: 'none',
            fontSize: 13,
            fontWeight: item.active ? 600 : 500,
            color: item.active ? '#FFFFFF' : '#AAB2C4',
            border: item.active ? '1px solid rgba(168,85,247,0.55)' : '1px solid transparent',
            background: item.active
              ? 'linear-gradient(135deg, rgba(168,85,247,0.42) 0%, rgba(99,102,241,0.28) 60%, rgba(59,130,246,0.18) 100%)'
              : 'transparent',
            boxShadow: item.active
              ? '0 0 0 1px rgba(168,85,247,0.30) inset, 0 1px 0 rgba(255,255,255,0.08) inset, 0 14px 28px rgba(168,85,247,0.32), 0 0 28px rgba(168,85,247,0.20)'
              : 'none',
            transition: 'background .22s ease, color .22s ease, border-color .22s ease',
          }}
        >
          {item.active && (
            <span
              style={{
                position: 'absolute',
                left: -14,
                top: '50%',
                transform: 'translateY(-50%)',
                width: 3,
                height: 22,
                borderRadius: 3,
                background: 'linear-gradient(180deg,#C4B5FD,#A855F7)',
                boxShadow: '0 0 14px rgba(168,85,247,0.80)',
              }}
            />
          )}
          <span
            style={{
              display: 'inline-flex',
              color: item.active ? '#E9DEFE' : '#7A8295',
              filter: item.active ? 'drop-shadow(0 0 8px rgba(168,85,247,0.6))' : 'none',
            }}
          >
            {React.cloneElement(item.icon as React.ReactElement, { size: 22 })}
          </span>
          <span style={{ flex: 1 }}>{item.label}</span>
          {item.badge && (
            <Badge tone={item.badge.tone}>{item.badge.text}</Badge>
          )}
        </a>
      ))}
    </nav>

    {/* Companion card */}
    <div
      style={{
        position: 'relative',
        marginTop: 'auto',
        padding: 14,
        borderRadius: 16,
        background:
          'radial-gradient(200px 120px at 100% 0%, rgba(192,132,252,0.26), transparent 70%), radial-gradient(180px 120px at 0% 120%, rgba(56,189,248,0.14), transparent 70%), linear-gradient(160deg, rgba(192,132,252,0.10), rgba(124,58,237,0.04) 60%, rgba(20,16,32,0.6)), #0A0D17',
        border: '1px solid rgba(192,132,252,0.32)',
        boxShadow:
          '0 14px 40px rgba(124,58,237,0.30), 0 0 0 1px rgba(255,255,255,0.04) inset, 0 1px 0 rgba(255,255,255,0.07) inset',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        gap: 11,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 'auto -30% -60% auto',
          width: 200,
          height: 200,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(192,132,252,0.42), transparent 65%)',
          pointerEvents: 'none',
          filter: 'blur(2px)',
        }}
      />
      <div
        style={{
          position: 'relative',
          width: 38,
          height: 38,
          borderRadius: 12,
          display: 'grid',
          placeItems: 'center',
          color: '#FFFFFF',
          background:
            'radial-gradient(20px 14px at 30% 22%, rgba(255,255,255,0.45), transparent 65%), linear-gradient(135deg,#A855F7,#7C3AED 55%,#6366F1)',
          boxShadow:
            '0 10px 26px rgba(168,85,247,0.55), inset 0 1px 0 rgba(255,255,255,0.28), inset 0 0 0 1px rgba(255,255,255,0.10)',
        }}
      >
        <Icon.Bot size={20} />
      </div>
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#F4F0FF', letterSpacing: 0.1 }}>
          Companion
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#D6C8FF' }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: C.orange,
              boxShadow: `0 0 0 0 ${C.orange}, 0 0 10px ${C.orange}`,
              animation: 'cellhubPulse 1.8s infinite',
            }}
          />
          1 aprobación pendiente
        </div>
      </div>
    </div>
  </aside>
);

// ────────────────────────────────────────────────────────────────────────────
// Topbar
// ────────────────────────────────────────────────────────────────────────────

const Topbar: React.FC = () => (
  <div
    style={{
      height: 72,
      flex: '0 0 72px',
      padding: '0 20px',
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      borderBottom: `1px solid ${C.border}`,
      background: `linear-gradient(180deg, rgba(11,16,32,0.85), rgba(5,8,22,0.55))`,
      backdropFilter: 'blur(10px)',
      position: 'relative',
      zIndex: 2,
    }}
  >
    {/* Search */}
    <div style={{ position: 'relative', width: 480, maxWidth: 480 }}>
      <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: C.dim }}>
        <Icon.Search size={16} />
      </span>
      <input
        readOnly
        placeholder="Buscar clientes, teléfonos, accesorios, SKU…"
        style={{
          width: '100%',
          height: 42,
          padding: '0 64px 0 42px',
          background: 'linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.012))',
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          color: C.text,
          fontFamily: FONT,
          fontSize: 13,
          outline: 'none',
          boxShadow: '0 6px 18px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.04)',
        }}
      />
      <span
        style={{
          position: 'absolute',
          right: 10,
          top: '50%',
          transform: 'translateY(-50%)',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 0.6,
          color: C.muted,
          padding: '4px 8px',
          borderRadius: 8,
          background: 'linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))',
          border: `1px solid ${C.border}`,
        }}
      >
        ⌘K
      </span>
    </div>

    {/* Metric pills */}
    <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', alignItems: 'center' }}>
      <Pill tone="red"   icon={<Icon.Wrench size={14} />}><span style={{ opacity: 0.85 }}>Repairs</span> <b style={{ color: '#fff', fontWeight: 700, marginLeft: 2 }}>3</b></Pill>
      <Pill tone="amber" icon={<Icon.Package size={14} />}><span style={{ opacity: 0.85 }}>Low Stock</span> <b style={{ color: '#fff', fontWeight: 700, marginLeft: 2 }}>374</b></Pill>
      <Pill tone="green" icon={<Icon.Cash size={14} />}><b style={{ color: '#fff', fontWeight: 700 }}>$208</b> <span style={{ opacity: 0.85, marginLeft: 2 }}>today</span></Pill>
      <Pill tone="blue"  icon={<Icon.Brain size={14} />}><span style={{ opacity: 0.85 }}>Alerts</span> <b style={{ color: '#fff', fontWeight: 700, marginLeft: 2 }}>5</b></Pill>

      {/* Utility */}
      <button
        style={{
          width: 42,
          height: 42,
          borderRadius: 14,
          display: 'grid',
          placeItems: 'center',
          background: 'linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.012))',
          border: `1px solid ${C.border}`,
          color: '#CFD5E3',
          cursor: 'pointer',
          marginLeft: 4,
          boxShadow: '0 6px 18px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.04)',
        }}
      >
        <Icon.Bell size={18} />
      </button>
    </div>
  </div>
);

// ────────────────────────────────────────────────────────────────────────────
// Greeting
// ────────────────────────────────────────────────────────────────────────────

const Greeting: React.FC = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    <h1
      style={{
        margin: 0,
        fontSize: 38,
        fontWeight: 800,
        letterSpacing: -1,
        background: 'linear-gradient(120deg,#FFFFFF 0%,#E5E9F3 55%,#A8B1C6 100%)',
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        color: 'transparent',
        lineHeight: 1.08,
      }}
    >
      Buenos días, Jorge!
    </h1>
    <div style={{ fontSize: 14, color: C.muted }}>
      Vamos a operar la tienda · Lunes 11 de mayo, 2026
    </div>
  </div>
);

// ────────────────────────────────────────────────────────────────────────────
// Hero POS card
// ────────────────────────────────────────────────────────────────────────────

const HeroCard: React.FC = () => (
  <section
    style={{
      gridColumn: '1 / span 1',
      gridRow: '1 / span 2',
      position: 'relative',
      height: 360,
      borderRadius: 22,
      padding: '28px 28px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      gap: 14,
      overflow: 'hidden',
      background:
        'radial-gradient(420px 280px at 92% 92%, rgba(192,132,252,0.55), transparent 70%), radial-gradient(360px 240px at 8% 0%, rgba(99,102,241,0.50), transparent 70%), linear-gradient(160deg, #1C1758 0%, #3A1F8C 30%, #5B21B6 65%, #7C3AED 100%)',
      border: '1px solid rgba(192,132,252,0.45)',
      boxShadow:
        '0 30px 80px rgba(91,33,182,0.55), 0 12px 40px rgba(124,58,237,0.42), 0 0 60px rgba(124,58,237,0.22), 0 0 0 1px rgba(255,255,255,0.08) inset, 0 1px 0 rgba(255,255,255,0.18) inset',
    }}
  >
    {/* Layered overlays */}
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        background:
          'linear-gradient(180deg, rgba(255,255,255,0.12) 0%, transparent 35%, transparent 65%, rgba(0,0,0,0.25) 100%), radial-gradient(260px 140px at 14% -10%, rgba(255,255,255,0.30), transparent 70%), radial-gradient(420px 260px at 100% 120%, rgba(34,211,238,0.22), transparent 70%)',
      }}
    />
    {/* Grid pattern center */}
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%,-50%)',
        width: 280,
        height: 180,
        opacity: 0.08,
        pointerEvents: 'none',
        background:
          'repeating-linear-gradient(90deg, rgba(255,255,255,0.4) 0 1px, transparent 1px 22px), repeating-linear-gradient(0deg, rgba(255,255,255,0.25) 0 1px, transparent 1px 18px)',
        WebkitMaskImage: 'radial-gradient(closest-side, #000, transparent 75%)',
        maskImage: 'radial-gradient(closest-side, #000, transparent 75%)',
      }}
    />

    {/* Eyebrow */}
    <div style={{ position: 'relative', display: 'flex' }}>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 7,
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: '0.34em',
          color: '#E9D8FF',
          padding: '5px 12px',
          borderRadius: 999,
          background: 'rgba(255,255,255,0.12)',
          border: '1px solid rgba(255,255,255,0.22)',
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: '#A3E635',
            boxShadow: '0 0 8px rgba(163,230,53,0.90)',
          }}
        />
        ACCIÓN PRINCIPAL
      </span>
    </div>

    {/* Icon block */}
    <div style={{ position: 'relative', display: 'grid', placeItems: 'center' }}>
      <div
        style={{
          width: 110,
          height: 110,
          borderRadius: 26,
          display: 'grid',
          placeItems: 'center',
          color: '#fff',
          background:
            'radial-gradient(54px 38px at 30% 22%, rgba(255,255,255,0.62), transparent 60%), linear-gradient(160deg, rgba(255,255,255,0.32) 0%, rgba(255,255,255,0.12) 50%, rgba(255,255,255,0.04) 100%)',
          border: '1px solid rgba(255,255,255,0.36)',
          boxShadow:
            '0 22px 50px rgba(0,0,0,0.55), 0 0 50px rgba(167,139,250,0.45), inset 0 1px 0 rgba(255,255,255,0.42), inset 0 -1px 0 rgba(0,0,0,0.28), inset 0 0 0 1px rgba(255,255,255,0.10)',
        }}
      >
        <div
          style={{
            filter:
              'drop-shadow(0 3px 14px rgba(255,255,255,0.55)) drop-shadow(0 0 22px rgba(167,139,250,0.60))',
          }}
        >
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="8" width="18" height="13" rx="2" />
            <path d="M7 8V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v3M7 13h10M7 17h6" />
          </svg>
        </div>
      </div>
    </div>

    {/* Text */}
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'center' }}>
      <div
        style={{
          fontSize: 28,
          fontWeight: 800,
          letterSpacing: -0.6,
          color: '#FFFFFF',
          lineHeight: 1.05,
          textShadow: '0 2px 14px rgba(0,0,0,0.45), 0 0 30px rgba(192,132,252,0.50)',
        }}
      >
        Punto de Venta
      </div>
      <div style={{ fontSize: 13, color: '#E6D8FF', letterSpacing: 0.2, opacity: 0.95, lineHeight: 1.45 }}>
        Nueva venta, recibir pagos, activaciones de línea y accesorios — todo desde aquí.
      </div>
    </div>

    {/* CTA */}
    <div style={{ position: 'relative', display: 'grid', placeItems: 'center' }}>
      <button
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 10,
          padding: '13px 22px 13px 24px',
          borderRadius: 999,
          border: 0,
          cursor: 'pointer',
          fontFamily: FONT,
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: '0.06em',
          color: '#3B1289',
          background: 'linear-gradient(180deg,#FFFFFF,#ECE5FF)',
          boxShadow:
            '0 16px 36px rgba(0,0,0,0.45), 0 0 28px rgba(255,255,255,0.30), inset 0 -1px 0 rgba(0,0,0,0.10)',
        }}
      >
        ABRIR POS
        <Icon.ArrowRight size={16} />
      </button>
    </div>
  </section>
);

// ────────────────────────────────────────────────────────────────────────────
// Module card
// ────────────────────────────────────────────────────────────────────────────

type ModuleCardProps = {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  accent: string;
  badge?: { tone: 'red' | 'amber' | 'green' | 'blue' | 'slate'; text: string };
  spanRows?: number;
};

const ModuleCard: React.FC<ModuleCardProps> = ({ icon, title, subtitle, accent, badge }) => {
  // Convert hex accent to rgba helpers (manual splits — accent expected as #RRGGBB)
  const r = parseInt(accent.slice(1, 3), 16);
  const g = parseInt(accent.slice(3, 5), 16);
  const b = parseInt(accent.slice(5, 7), 16);
  const rgba = (a: number) => `rgba(${r},${g},${b},${a})`;

  return (
    <div
      style={{
        position: 'relative',
        height: 170,
        borderRadius: 18,
        padding: 22,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        overflow: 'hidden',
        cursor: 'pointer',
        background: `
          radial-gradient(260px 160px at 100% 0%, ${rgba(0.22)}, transparent 70%),
          radial-gradient(220px 140px at 0% 110%, ${rgba(0.10)}, transparent 70%),
          linear-gradient(160deg, ${C.panel2} 0%, ${C.panel} 55%, #080C1A 100%)
        `,
        border: `1px solid ${C.border}`,
        boxShadow:
          '0 16px 38px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.05), inset 0 0 0 1px rgba(255,255,255,0.015)',
        transition: 'transform .22s cubic-bezier(.2,.7,.2,1), border-color .22s ease, box-shadow .22s ease',
      }}
    >
      {/* Top sheen */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          borderRadius: 'inherit',
          background:
            'linear-gradient(180deg, rgba(255,255,255,0.04) 0%, transparent 30%, transparent 70%, rgba(0,0,0,0.18) 100%)',
        }}
      />
      {/* Accent corner */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          borderRadius: 'inherit',
          background: `linear-gradient(135deg, transparent 55%, ${rgba(0.15)} 100%)`,
          mixBlendMode: 'screen',
          opacity: 0.6,
        }}
      />

      {/* Header row: icon + arrow */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div
          style={{
            position: 'relative',
            width: 54,
            height: 54,
            borderRadius: 15,
            display: 'grid',
            placeItems: 'center',
            color: '#fff',
            background: `
              radial-gradient(26px 18px at 30% 22%, rgba(255,255,255,0.45), transparent 65%),
              linear-gradient(160deg, ${rgba(0.85)} 0%, ${rgba(0.40)} 55%, ${rgba(0.14)} 100%)
            `,
            border: `1px solid ${rgba(0.55)}`,
            boxShadow: `
              inset 0 1px 0 rgba(255,255,255,0.30),
              inset 0 -1px 0 rgba(0,0,0,0.25),
              inset 0 0 0 1px rgba(255,255,255,0.06),
              0 14px 28px ${rgba(0.36)},
              0 0 26px ${rgba(0.28)}
            `,
          }}
        >
          <div
            style={{
              filter: `drop-shadow(0 2px 2px rgba(0,0,0,0.45)) drop-shadow(0 0 12px ${rgba(0.70)})`,
            }}
          >
            {React.cloneElement(icon as React.ReactElement, { size: 26 })}
          </div>
        </div>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 10,
            display: 'grid',
            placeItems: 'center',
            color: rgba(0.95),
            border: `1px solid ${rgba(0.30)}`,
            background: rgba(0.08),
          }}
        >
          <Icon.ChevronRight size={15} />
        </div>
      </div>

      {/* Title + subtitle */}
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 4, marginTop: 'auto' }}>
        <div
          style={{
            fontSize: 24,
            fontWeight: 700,
            letterSpacing: -0.3,
            color: '#FFFFFF',
            lineHeight: 1.1,
            textShadow: `0 0 18px ${rgba(0.22)}`,
          }}
        >
          {title}
        </div>
        <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.35 }}>{subtitle}</div>
      </div>

      {/* Bottom status badge */}
      {badge && (
        <div style={{ position: 'relative', marginTop: 4 }}>
          <Badge tone={badge.tone}>{badge.text}</Badge>
        </div>
      )}
    </div>
  );
};

// ────────────────────────────────────────────────────────────────────────────
// Section header
// ────────────────────────────────────────────────────────────────────────────

const SectionLabel: React.FC<{ label: string; accent?: string }> = ({ label, accent = C.purple }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
    <span
      style={{
        position: 'relative',
        paddingLeft: 14,
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: '0.30em',
        color: '#8C95AA',
        textTransform: 'uppercase',
      }}
    >
      <span
        style={{
          position: 'absolute',
          left: 0,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: accent,
          boxShadow: `0 0 10px ${accent}, 0 0 0 3px ${accent}33`,
        }}
      />
      {label}
    </span>
    <span
      style={{
        flex: 1,
        height: 1,
        background: `linear-gradient(90deg, ${accent}88 0%, ${accent}33 30%, transparent 80%)`,
      }}
    />
  </div>
);

// ────────────────────────────────────────────────────────────────────────────
// Top grid module cards (next to hero — 6 cards)
// ────────────────────────────────────────────────────────────────────────────

const topModules: ModuleCardProps[] = [
  { icon: <Icon.Phone />,       title: 'Celulares',     subtitle: 'Smartphones · Prepaid · Postpaid', accent: '#F59E0B', badge: { tone: 'blue',  text: '128 en stock' } },
  { icon: <Icon.Headphones />,  title: 'Accesorios',    subtitle: 'Cases · Cables · Audio',           accent: '#22D3EE', badge: { tone: 'blue',  text: '256 en stock' } },
  { icon: <Icon.CreditCard />,  title: 'Pagos',         subtitle: 'Carrier · Repair balances',        accent: '#F59E0B', badge: { tone: 'amber', text: '$823 pendiente' } },
  { icon: <Icon.Wrench />,      title: 'Reparaciones',  subtitle: 'Tickets · Pickups · Diagnóstico',  accent: '#2DD4BF', badge: { tone: 'red',   text: '3 esperando' } },
  { icon: <Icon.Unlock />,      title: 'Unlocks',       subtitle: 'Carrier · FRP · IMEI',             accent: '#C084FC', badge: { tone: 'slate', text: '0 pendientes' } },
  { icon: <Icon.Wallet />,      title: 'Layaways',      subtitle: 'Pagos parciales · Reservas',       accent: '#10B981', badge: { tone: 'green', text: '14 activos' } },
];

const operacionesModules: ModuleCardProps[] = [
  { icon: <Icon.Package />,    title: 'Inventario',  subtitle: 'SKUs · Stock · Recibos',         accent: '#F59E0B', badge: { tone: 'red',   text: '3 sin stock' } },
  { icon: <Icon.Clipboard />,  title: 'Órdenes',     subtitle: 'Special orders · POs · Tracking',accent: '#22D3EE', badge: { tone: 'amber', text: '5 pendientes' } },
  { icon: <Icon.RotateCcw />,  title: 'Devoluciones',subtitle: 'Refunds · Cambios · RMAs',       accent: '#F0ABFC', badge: { tone: 'amber', text: '4 a procesar' } },
  { icon: <Icon.Users />,      title: 'Clientes',    subtitle: 'Cuentas · Historial · Loyalty',  accent: '#818CF8', badge: { tone: 'blue',  text: '420 total' } },
  { icon: <Icon.Calendar />,   title: 'Citas',       subtitle: 'Reservas · Walk-ins',            accent: '#A3E635', badge: { tone: 'green', text: '4 hoy' } },
  { icon: <Icon.FileText />,   title: 'Estimados',   subtitle: 'Cotizaciones · Conversión',      accent: '#A3E635', badge: { tone: 'amber', text: '8 borradores' } },
];

const gestionModules: ModuleCardProps[] = [
  { icon: <Icon.BarChart />,   title: 'Reportes',     subtitle: 'Ventas · Profit · Tax · EOD',  accent: '#FB923C', badge: { tone: 'slate', text: 'Hoy listo' } },
  { icon: <Icon.Brain />,      title: 'Intelligence', subtitle: 'Alertas · Insights · Anomalías', accent: '#0EA5E9', badge: { tone: 'blue',  text: '5 nuevas' } },
  { icon: <Icon.Shield />,     title: 'Empleados',    subtitle: 'Turnos · Comisiones · Permisos', accent: '#FB7185', badge: { tone: 'slate', text: '4 activos' } },
  { icon: <Icon.Settings />,   title: 'Configuración',subtitle: 'Tienda · Impresoras · Impuestos', accent: '#F87171', badge: { tone: 'slate', text: 'Sistema' } },
];

// ────────────────────────────────────────────────────────────────────────────
// Status bar (footer)
// ────────────────────────────────────────────────────────────────────────────

const StatusBar: React.FC = () => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      padding: '12px 18px',
      borderRadius: 14,
      background:
        'radial-gradient(220px 60px at 0% 50%, rgba(168,85,247,0.10), transparent 70%), radial-gradient(220px 60px at 100% 50%, rgba(16,185,129,0.08), transparent 70%), linear-gradient(180deg, rgba(11,16,32,0.85), rgba(5,8,22,0.85))',
      border: `1px solid ${C.border}`,
      boxShadow: '0 14px 36px rgba(0,0,0,0.40), inset 0 1px 0 rgba(255,255,255,0.05)',
      fontSize: 12,
      color: '#B8BFCF',
      marginTop: 18,
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <span style={{ color: '#6B748A' }}><Icon.Store size={14} /></span>
      Store: <b style={{ color: '#E7EAF2', fontWeight: 600 }}>Go Cellular</b>
    </div>
    <div style={{ width: 1, height: 14, background: C.border }} />
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <span style={{ color: '#6B748A' }}><Icon.Cash size={14} /></span>
      Register: <b style={{ color: '#E7EAF2', fontWeight: 600 }}>Front Counter</b>
    </div>
    <div style={{ width: 1, height: 14, background: C.border }} />
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <span style={{ color: '#6B748A' }}><Icon.Clock size={14} /></span>
      Session: <b style={{ color: '#E7EAF2', fontWeight: 600 }}>9:15 AM</b>
    </div>
    <div style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8, color: '#BBF7D0', fontWeight: 600 }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: '#10B981',
          boxShadow: '0 0 12px rgba(16,185,129,0.70)',
        }}
      />
      All Systems Operational
    </div>
  </div>
);

// ────────────────────────────────────────────────────────────────────────────
// Main mockup component
// ────────────────────────────────────────────────────────────────────────────

const CellHubCommandCenterMockup: React.FC = () => {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        background: C.bg,
        color: C.text,
        fontFamily: FONT,
        overflow: 'hidden',
      }}
    >
      <style>{`
        @keyframes cellhubPulse {
          0% { box-shadow: 0 0 0 0 rgba(245,158,11,0.55), 0 0 10px rgba(245,158,11,0.75); }
          70% { box-shadow: 0 0 0 8px rgba(245,158,11,0), 0 0 10px rgba(245,158,11,0.30); }
          100% { box-shadow: 0 0 0 0 rgba(245,158,11,0), 0 0 10px rgba(245,158,11,0.75); }
        }
        .chmu-scroll::-webkit-scrollbar { width: 8px; }
        .chmu-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.06); border-radius: 8px; }
        .chmu-scroll::-webkit-scrollbar-track { background: transparent; }
      `}</style>

      {/* Ambient page glow */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background:
            'radial-gradient(1200px 700px at 18% -10%, rgba(168,85,247,0.16), transparent 60%), radial-gradient(1000px 600px at 100% 110%, rgba(14,165,233,0.10), transparent 60%)',
          zIndex: 0,
        }}
      />

      <Sidebar />

      <main
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <Topbar />

        <div
          className="chmu-scroll"
          style={{
            flex: 1,
            padding: '20px 20px 20px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
          }}
        >
          <Greeting />

          {/* Top dashboard grid: hero + 6 modules */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '520px repeat(3, 1fr)',
              gridAutoRows: '172px',
              gap: 16,
            }}
          >
            <HeroCard />
            {topModules.map((m) => (
              <ModuleCard key={m.title} {...m} />
            ))}
          </div>

          {/* OPERACIONES */}
          <section>
            <SectionLabel label="OPERACIONES" accent="#22D3EE" />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
              {operacionesModules.map((m) => (
                <ModuleCard key={m.title} {...m} />
              ))}
            </div>
          </section>

          {/* GESTIÓN */}
          <section>
            <SectionLabel label="GESTIÓN" accent="#F59E0B" />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
              {gestionModules.map((m) => (
                <ModuleCard key={m.title} {...m} />
              ))}
            </div>
          </section>

          <StatusBar />
        </div>
      </main>
    </div>
  );
};

export default CellHubCommandCenterMockup;
