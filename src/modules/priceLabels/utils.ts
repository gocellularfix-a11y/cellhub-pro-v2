export function formatPrice(price: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(price);
}

export function formatDate(isoString: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(isoString));
}

/** 1 mm = 3.7795px at 96 DPI (CSS standard reference pixel) */
export const MM_TO_PX = 3.7795;

export function mmToPx(mm: number): number {
  return Math.round(mm * MM_TO_PX);
}

export function deriveBarcodeValue(product: { imei?: string; sku: string; barcode: string }): string {
  return product.imei?.trim() || product.sku.trim() || product.barcode.trim();
}

// ── Standard label size constants ─────────────────────────────────────────────
// Single source of truth — referenced by templates, editor presets, and history.

/** 2.25 × 1.25 in — industry-standard small price/barcode tag */
export const SMALL_PRICE_LABEL_W_MM = 57.15;
export const SMALL_PRICE_LABEL_H_MM = 31.75;

/** 4 × 6 in — standard shipping / large product display label */
export const LARGE_LABEL_W_MM = 101.6;
export const LARGE_LABEL_H_MM = 152.4;
