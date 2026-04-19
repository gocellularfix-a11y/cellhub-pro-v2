// ============================================================
// CellHub Pro — Barcode & Label Service
// JsBarcode for barcode generation, DYMO LabelWriter for printing
// ============================================================

/**
 * Generate a barcode SVG string using JsBarcode.
 * JsBarcode is loaded as a global from the CDN or npm.
 */
export function generateBarcodeSvg(
  value: string,
  options?: {
    format?: string;
    width?: number;
    height?: number;
    displayValue?: boolean;
  },
): string {
  const {
    format = 'CODE128',
    width = 2,
    height = 50,
    displayValue = true,
  } = options || {};

  // Create a temporary SVG element
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

  try {
    // JsBarcode should be available globally or via import
    const JsBarcode = (window as unknown as Record<string, unknown>).JsBarcode as (
      el: SVGElement,
      value: string,
      opts: Record<string, unknown>,
    ) => void;

    if (JsBarcode) {
      JsBarcode(svg, value, {
        format,
        width,
        height,
        displayValue,
        margin: 5,
        fontSize: 12,
      });
    }
  } catch (err) {
    console.error('[Barcode] Generation error:', err);
  }

  return svg.outerHTML;
}

/**
 * Generate HTML for a DYMO price label.
 */
export function generatePriceLabel(
  name: string,
  sku: string,
  price: string,
  barcode?: string,
): string {
  const barcodeHtml = barcode ? generateBarcodeSvg(barcode) : '';

  return `
    <div style="width: 2.25in; height: 1.25in; padding: 4px; font-family: Arial, sans-serif; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center;">
      <div style="font-size: 10px; font-weight: bold; margin-bottom: 2px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        ${name}
      </div>
      <div style="font-size: 8px; color: #666; margin-bottom: 4px;">
        SKU: ${sku}
      </div>
      ${barcodeHtml ? `<div style="margin-bottom: 4px;">${barcodeHtml}</div>` : ''}
      <div style="font-size: 16px; font-weight: bold;">
        ${price}
      </div>
    </div>
  `;
}
