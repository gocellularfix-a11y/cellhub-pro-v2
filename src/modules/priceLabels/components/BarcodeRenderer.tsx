import { useEffect, useRef, memo } from 'react';
import JsBarcode from 'jsbarcode';

interface BarcodeRendererProps {
  value: string;
  height?: number;
  displayValue?: boolean;
  barWidth?: number;
  lineColor?: string;
  background?: string;
  fontSize?: number;
  textMargin?: number;
  /** If true, stretches the SVG to 100% of its container width via viewBox scaling */
  fillWidth?: boolean;
}

export const BarcodeRenderer = memo(function BarcodeRenderer({
  value,
  height = 50,
  displayValue = true,
  barWidth = 1.5,
  lineColor = '#000000',
  background = '#ffffff',
  fontSize = 10,
  textMargin = 2,
  fillWidth = false,
}: BarcodeRendererProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !value) return;

    try {
      JsBarcode(svg, value, {
        format: 'CODE128',
        width: barWidth,
        height,
        displayValue,
        lineColor,
        background,
        fontSize,
        textMargin,
        margin: 4,
        font: 'monospace',
        textAlign: 'center',
        textPosition: 'bottom',
      });

      if (fillWidth) {
        // Add viewBox so CSS width:100% scales correctly
        const w = svg.getAttribute('width');
        const h = svg.getAttribute('height');
        if (w && h) {
          svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
          svg.removeAttribute('width');
          svg.style.width = '100%';
          svg.style.height = h + 'px';
        }
      }
    } catch {
      if (svg) {
        svg.innerHTML =
          '<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#cc0000" font-size="10" font-family="Arial">Invalid barcode value</text>';
      }
    }
  }, [value, height, displayValue, barWidth, lineColor, background, fontSize, textMargin, fillWidth]);

  return <svg ref={svgRef} style={{ display: 'block' }} />;
});
