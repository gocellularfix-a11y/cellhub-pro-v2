import { useLayoutEffect, useRef } from 'react';
import type { TextElement, TextSize } from '../../types';

/** Quick-preset px values — also used by ElementPropertiesPanel */
export const FONT_SIZE_PRESETS: Record<TextSize, number> = {
  small: 10,
  medium: 15,
  large: 22,
};

/** Web-safe font families available for text elements */
export const FONT_FAMILIES = [
  'Arial',
  'Helvetica',
  'Times New Roman',
  'Georgia',
  'Courier New',
  'Verdana',
  'Impact',
] as const;

/** Resolve the effective font size for an element (handles legacy `size` field) */
export function resolveTextFontSize(el: Pick<TextElement, 'fontSize' | 'size'>): number {
  return el.fontSize ?? FONT_SIZE_PRESETS[el.size ?? 'medium'];
}

const VALIGN_FLEX: Record<NonNullable<TextElement['valign']>, string> = {
  top: 'flex-start',
  middle: 'center',
  bottom: 'flex-end',
};

const MIN_AUTOFIT_PX = 6;

/**
 * LABEL-STUDIO-DIRECT-PRINT-AND-DYMO-LIKE-TEXT-V1 — DYMO-style text box.
 *
 * Two render modes:
 *  - No box (width/height absent): legacy behavior, byte-identical to the
 *    previous renderer — auto width, optional wrap/clip. Saved history jobs
 *    keep rendering exactly as before.
 *  - Fixed box (width AND height set): outer flex box owns the bounds
 *    (overflow hidden — text can NEVER spill outside), inner span owns the
 *    glyphs. align → text-align, valign → flex alignment, overflow mode:
 *      clip    → fixed font, wrapped, cut at bounds
 *      wrap    → same layout as clip (kept distinct for future no-wrap clip)
 *      autofit → binary-search the largest font ≤ configured fontSize that
 *                fits the box; never enlarges past the configured max.
 *
 * Autofit measures the real DOM synchronously in useLayoutEffect (single
 * pass, no flicker) and writes the fitted size as an INLINE style — so the
 * print path, which captures the portal's innerHTML, ships the exact fitted
 * size to the printer.
 */
export function TextRenderer({ element }: { element: TextElement }) {
  const fontSize = resolveTextFontSize(element);
  const fontFamily = element.fontFamily ?? 'Arial';
  const hasWidth = typeof element.width === 'number';
  const hasHeight = typeof element.height === 'number';
  const isBox = hasWidth && hasHeight;
  const overflow = element.overflow ?? 'wrap';
  const innerRef = useRef<HTMLSpanElement>(null);

  // Autofit: shrink-to-fit inside the fixed box. Runs only in box mode.
  useLayoutEffect(() => {
    const node = innerRef.current;
    if (!node || !isBox) return;
    const boxW = element.width as number;
    const boxH = element.height as number;
    if (overflow !== 'autofit') {
      node.style.fontSize = `${fontSize}px`;
      return;
    }
    // Not measurable (e.g. display:none ancestor) → keep configured size.
    if (node.offsetWidth === 0 && node.scrollWidth === 0) return;
    const fits = (fs: number): boolean => {
      node.style.fontSize = `${fs}px`;
      return node.scrollWidth <= boxW + 0.5 && node.scrollHeight <= boxH + 0.5;
    };
    let lo = MIN_AUTOFIT_PX;
    let hi = fontSize; // configured size is the MAX — autofit never enlarges
    let best = MIN_AUTOFIT_PX;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (fits(mid)) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    node.style.fontSize = `${best}px`;
  }, [element.value, element.width, element.height, fontSize, fontFamily, element.bold, overflow, isBox]);

  // ── Fixed-box mode (DYMO-like) ───────────────────────────────
  if (isBox) {
    return (
      <span
        style={{
          display: 'flex',
          width: element.width,
          height: element.height,
          overflow: 'hidden',
          alignItems: VALIGN_FLEX[element.valign ?? 'top'],
          userSelect: 'none',
        }}
      >
        <span
          ref={innerRef}
          style={{
            display: 'block',
            width: '100%',
            textAlign: element.align ?? 'left',
            fontFamily,
            fontSize,
            fontWeight: element.bold ? 700 : 400,
            color: '#000',
            lineHeight: 1.2,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {element.value || '(empty)'}
        </span>
      </span>
    );
  }

  // ── Legacy auto-size mode (unchanged) ────────────────────────
  return (
    <span
      style={{
        display: 'block',
        fontFamily,
        fontSize,
        fontWeight: element.bold ? 700 : 400,
        color: '#000',
        lineHeight: 1.2,
        userSelect: 'none',
        textAlign: element.align ?? 'left',
        // Width / wrapping
        ...(hasWidth
          ? { width: element.width, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }
          : { whiteSpace: 'pre' }),
        // Height / clipping
        ...(hasHeight
          ? { height: element.height, overflow: 'hidden' }
          : {}),
      }}
    >
      {element.value || '(empty)'}
    </span>
  );
}
