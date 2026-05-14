declare module 'jsbarcode' {
  interface JsBarcodeOptions {
    format?: string;
    width?: number;
    height?: number;
    displayValue?: boolean;
    text?: string;
    fontOptions?: string;
    font?: string;
    textAlign?: string;
    textPosition?: string;
    textMargin?: number;
    fontSize?: number;
    background?: string;
    lineColor?: string;
    margin?: number;
    marginTop?: number;
    marginBottom?: number;
    marginLeft?: number;
    marginRight?: number;
    valid?: (valid: boolean) => void;
  }

  function JsBarcode(
    element: SVGElement | HTMLCanvasElement | HTMLImageElement | string,
    value: string,
    options?: JsBarcodeOptions
  ): void;

  export default JsBarcode;
}
