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

export function TextRenderer({ element }: { element: TextElement }) {
  const fontSize = resolveTextFontSize(element);
  const fontFamily = element.fontFamily ?? 'Arial';
  const hasWidth = typeof element.width === 'number';
  const hasHeight = typeof element.height === 'number';

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
