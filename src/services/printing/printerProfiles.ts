// R-PRINT-PROFILES: Centralized printer paper profiles.
// Pure helpers — no side effects, no module-specific logic.

export type ReceiptPaperKind = 'roll' | 'fixed';

export type PrinterPaperSize = '58mm' | '80mm' | '4x6';

export interface PrinterProfile {
  paperSize: PrinterPaperSize;
  kind: ReceiptPaperKind;

  widthPx: number;
  heightPx: number | 'auto';

  fontSizePx: number;
  lineHeightPx: number;
  maxCharsPerLine: number;

  showLogo: boolean;
  showItemSku: boolean;
  compact: boolean;
}

const PROFILES: Record<PrinterPaperSize, PrinterProfile> = {
  '58mm': {
    paperSize: '58mm',
    kind: 'roll',
    widthPx: 384,
    heightPx: 'auto',
    fontSizePx: 11,
    lineHeightPx: 14,
    maxCharsPerLine: 32,
    showLogo: false,
    showItemSku: false,
    compact: true,
  },
  '80mm': {
    paperSize: '80mm',
    kind: 'roll',
    widthPx: 576,
    heightPx: 'auto',
    fontSizePx: 12,
    lineHeightPx: 16,
    maxCharsPerLine: 48,
    showLogo: true,
    showItemSku: true,
    compact: true,
  },
  '4x6': {
    paperSize: '4x6',
    kind: 'fixed',
    widthPx: 768,
    heightPx: 1152,
    fontSizePx: 14,
    lineHeightPx: 20,
    maxCharsPerLine: 64,
    showLogo: true,
    showItemSku: true,
    compact: false,
  },
};

export function getPrinterProfile(paperSize: PrinterPaperSize): PrinterProfile {
  return PROFILES[paperSize];
}

export function formatReceiptLine(text: string, profile: PrinterProfile): string[] {
  const max = profile.maxCharsPerLine;
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (word.length === 0) continue;

    // Word longer than line — break it hard
    if (word.length > max) {
      if (current.length > 0) {
        lines.push(current);
        current = '';
      }
      let remaining = word;
      while (remaining.length > max) {
        lines.push(remaining.slice(0, max));
        remaining = remaining.slice(max);
      }
      current = remaining;
      continue;
    }

    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (candidate.length <= max) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }

  if (current.length > 0) lines.push(current);
  return lines;
}

export function getReceiptCss(profile: PrinterProfile): string {
  const spacing = profile.compact ? '4px 6px' : '8px 12px';
  const parts = [
    `width: ${profile.widthPx}px`,
    `font-size: ${profile.fontSizePx}px`,
    `line-height: ${profile.lineHeightPx}px`,
    `padding: ${spacing}`,
    `box-sizing: border-box`,
  ];

  if (profile.kind === 'fixed' && typeof profile.heightPx === 'number') {
    parts.push(`height: ${profile.heightPx}px`);
    parts.push(`overflow: hidden`);
  }

  return parts.join('; ') + ';';
}
