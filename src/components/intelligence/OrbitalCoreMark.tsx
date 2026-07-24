// ============================================================
// CellHub Pro — Orbital Core mark (R-ORBITAL-CORE-IDENTITY-V1)
//
// THE canonical visual for CellHub Intelligence. One component, three
// controlled variants — no per-module SVG copies:
//
//   seal   — core + orbital ring, no satellite. ~14–16px. Static.
//            "This was produced by CellHub Intelligence."
//   mark   — core + ring + optional state satellite. ~22–32px. Static.
//            Sidebar tiles / module headers.
//   living — full mark with orbital motion. ~56px. Floating button only.
//
// Geometry (the signature — do not restyle per surface):
//   · circular core, indigo→violet brand gradient (#667eea → #764ba2)
//   · ONE elliptical ring at a fixed 25° inclination that passes BEHIND
//     and IN FRONT of the core (depth — never a flat Saturn/atom read)
//   · single satellite dot; never the only carrier of information
//
// Motion is information: idle orbit ≈40s, processing ≈12s, core breath
// 6s @ ≤2% scale. prefers-reduced-motion freezes everything; state stays
// readable through color + badge + labels.
// ============================================================

import { useEffect, useId } from 'react';

export type OrbitalCoreVariant = 'seal' | 'mark' | 'living';
/** Visual state. info/watch/important/critical mirror the canonical
 *  ProactiveInsightSeverity; idle/processing are UI states, NOT severities. */
export type OrbitalCoreState = 'idle' | 'processing' | 'info' | 'watch' | 'important' | 'critical';

/** Canonical state → color mapping (existing CellHub tones only). */
export const ORBITAL_STATE_COLORS: Record<OrbitalCoreState, string> = {
  idle: '#a5b4fc',        // indigo rest
  processing: '#a78bfa',  // violet
  info: '#94a3b8',        // neutral slate
  watch: '#10b981',       // emerald opportunity
  important: '#f59e0b',   // amber
  critical: '#ef4444',    // red
};

/** Severities that surface a satellite on the static mark variant. */
const SATELLITE_STATES: ReadonlySet<OrbitalCoreState> = new Set(['info', 'watch', 'important', 'critical']);

export function satelliteVisible(variant: OrbitalCoreVariant, state: OrbitalCoreState): boolean {
  if (variant === 'seal') return false;              // ≤16px: dot would be noise
  if (variant === 'living') return true;             // floating button: always
  return SATELLITE_STATES.has(state);                // mark: state indicator only
}

// ── Shared CSS (single injected stylesheet, reduced-motion aware) ──
export const ORBITAL_CORE_STYLE_ID = 'cellhub-orbital-core-styles';
export const ORBITAL_CORE_CSS = `
@keyframes chOrbitalBreath {
  0%, 100% { transform: scale(1);    }
  50%      { transform: scale(1.02); }
}
@keyframes chOrbitalSpin {
  from { transform: rotate(0deg);   }
  to   { transform: rotate(360deg); }
}
.ch-orbital-breath { animation: chOrbitalBreath 6s ease-in-out infinite; transform-origin: center; }
/* AUDIT H1: the spin group lives in a frame translated to the ellipse
   center, so its correct local rotation origin is 0 0. Without this,
   Chromium resolves the default SVG transform-origin (50% 50% of the
   view-box) IN LOCAL UNITS and the satellite orbits an offset point. */
.ch-orbital-spin-idle       { animation: chOrbitalSpin 40s linear infinite; transform-origin: 0 0; }
.ch-orbital-spin-processing { animation: chOrbitalSpin 12s linear infinite; transform-origin: 0 0; }
@media (prefers-reduced-motion: reduce) {
  .ch-orbital-breath,
  .ch-orbital-spin-idle,
  .ch-orbital-spin-processing { animation: none !important; }
}
`;

/** Idempotent style injection (same pattern as Sidebar / operator bubble). */
export function ensureOrbitalCoreStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(ORBITAL_CORE_STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = ORBITAL_CORE_STYLE_ID;
  el.textContent = ORBITAL_CORE_CSS;
  document.head.appendChild(el);
}

// ── Reusable ring + satellite (also consumed by the floating orb) ──
// Renders INSIDE an existing <svg>. Draws the back half of the ring; the
// caller layers its core; then renders the front half + satellite via
// <OrbitalRingFront/>. Keeping both halves here is what guarantees a
// single geometric system across every surface.

export interface OrbitalRingProps {
  cx: number; cy: number; rx: number; ry: number;
  strokeWidth: number;
  stroke?: string;
}

/** Back (upper) half of the 25°-inclined ring — render BEFORE the core. */
export function OrbitalRingBack({ cx, cy, rx, ry, strokeWidth, stroke }: OrbitalRingProps) {
  return (
    <g transform={`rotate(25 ${cx} ${cy}) translate(${cx} ${cy})`}>
      <path
        d={`M ${-rx} 0 A ${rx} ${ry} 0 0 1 ${rx} 0`}
        fill="none"
        stroke={stroke || 'rgba(165,180,252,0.45)'}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </g>
  );
}

export interface OrbitalRingFrontProps extends OrbitalRingProps {
  satellite?: { color: string; r: number; spinClass?: string } | null;
}

/** Front (lower) half + optional satellite — render AFTER the core. */
export function OrbitalRingFront({ cx, cy, rx, ry, strokeWidth, stroke, satellite }: OrbitalRingFrontProps) {
  return (
    <g transform={`rotate(25 ${cx} ${cy}) translate(${cx} ${cy})`}>
      <path
        d={`M ${rx} 0 A ${rx} ${ry} 0 0 1 ${-rx} 0`}
        fill="none"
        stroke={stroke || 'rgba(165,180,252,0.60)'}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      {satellite && (
        // The scale maps the satellite's circular spin onto the ellipse.
        // The dot flattens slightly under the scale — at 2–4px rendered it
        // reads as a subtle motion streak along the orbit (intentional).
        <g transform={`scale(1 ${(ry / rx).toFixed(4)})`}>
          <g className={satellite.spinClass || undefined}>
            <circle cx={rx} cy={0} r={satellite.r} fill={satellite.color} />
          </g>
        </g>
      )}
    </g>
  );
}

// ── The canonical mark ────────────────────────────────────

export interface OrbitalCoreMarkProps {
  /** Rendered box size in px. */
  size?: number;
  variant?: OrbitalCoreVariant;
  state?: OrbitalCoreState;
  /** Enables motion (living variant only respects it; others stay static). */
  animated?: boolean;
  /** Decorative = aria-hidden (adjacent text identifies the source). */
  decorative?: boolean;
  /** Accessible name when NOT decorative. */
  label?: string;
  /** Optional count badge (unread opportunities etc.). */
  badge?: number;
}

export default function OrbitalCoreMark({
  size = 22,
  variant = 'mark',
  state = 'idle',
  animated = false,
  decorative = true,
  label,
  badge,
}: OrbitalCoreMarkProps) {
  const gid = useId().replace(/[^a-zA-Z0-9]/g, '');
  useEffect(() => { ensureOrbitalCoreStyles(); }, []);

  // Fixed internal geometry (viewBox 120): core r30, ring 54×21 @25°.
  const CX = 60; const CY = 60;
  const CORE_R = 30; const RX = 54; const RY = 21;
  // Stroke thickness compensates small render sizes (≈1.2–1.6px visual).
  const sw = variant === 'seal' ? 12 : variant === 'mark' ? 7 : 3.5;
  const stateColor = ORBITAL_STATE_COLORS[state];
  const showSatellite = satelliteVisible(variant, state);
  const live = variant === 'living' && animated;
  const spinClass = live
    ? (state === 'processing' ? 'ch-orbital-spin-processing' : 'ch-orbital-spin-idle')
    : undefined;

  const a11y = decorative
    ? { 'aria-hidden': true as const }
    : { role: 'img' as const, 'aria-label': label || 'CellHub Intelligence' };

  return (
    <span
      {...a11y}
      style={{ position: 'relative', display: 'inline-flex', width: size, height: size, flexShrink: 0 }}
      data-orbital-core={variant}
      data-orbital-state={state}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 120 120"
        xmlns="http://www.w3.org/2000/svg"
        style={{ display: 'block', overflow: 'visible' }}
        className={live ? 'ch-orbital-breath' : undefined}
      >
        <defs>
          <radialGradient id={`chCore-${gid}`} cx="42%" cy="34%" r="70%">
            <stop offset="0%" stopColor="#8fa2ff" />
            <stop offset="45%" stopColor="#667eea" />
            <stop offset="100%" stopColor="#764ba2" />
          </radialGradient>
        </defs>
        <OrbitalRingBack cx={CX} cy={CY} rx={RX} ry={RY} strokeWidth={sw} />
        <circle cx={CX} cy={CY} r={CORE_R} fill={`url(#chCore-${gid})`} />
        {/* soft top-left specular so the core reads dimensional at any size */}
        <ellipse cx={CX - 9} cy={CY - 11} rx={11} ry={7} fill="#ffffff" fillOpacity={0.28} transform={`rotate(-20 ${CX - 9} ${CY - 11})`} />
        <OrbitalRingFront
          cx={CX} cy={CY} rx={RX} ry={RY} strokeWidth={sw}
          satellite={showSatellite ? { color: stateColor, r: variant === 'living' ? 8 : 9, spinClass } : null}
        />
      </svg>
      {typeof badge === 'number' && badge > 0 && (
        <span
          style={{
            position: 'absolute', top: -4, right: -6,
            minWidth: 14, height: 14, padding: '0 3px',
            borderRadius: 999, background: stateColor, color: '#0f172a',
            fontSize: 9, fontWeight: 800, lineHeight: '14px', textAlign: 'center',
          }}
        >
          {badge}
        </span>
      )}
    </span>
  );
}
