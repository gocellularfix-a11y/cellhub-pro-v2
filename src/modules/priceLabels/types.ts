// ── Product & template types ──────────────────────────────────────────────────

export type TemplateId =
  | 'small-price'
  | 'barcode-label'
  | 'shelf-label'
  | 'large-label';

export interface Product {
  id: string;
  name: string;
  price: number;
  sku: string;
  imei?: string;
  barcode: string;
  category?: string;
}

export interface LabelTemplate {
  id: TemplateId;
  name: string;
  description: string;
  widthMm: number;
  heightMm: number;
}

/** Props every product-template component receives */
export interface LabelProps {
  product: Product;
  barcodeValue: string;
}

// ── Custom label element types ────────────────────────────────────────────────

/** Legacy quick-size preset — kept for backward compat with saved jobs */
export type TextSize = 'small' | 'medium' | 'large';

export interface TextElement {
  id: string;
  type: 'text';
  x: number;
  y: number;
  value: string;
  bold: boolean;
  /** Numeric font size 6–72 px (primary). If absent, derived from `size` preset. */
  fontSize?: number;
  /** Quick-size preset — optional, kept for backward compat */
  size?: TextSize;
  /** CSS font-family string. Defaults to 'Arial' when absent. */
  fontFamily?: string;
  /** Text-box width in px. When set, enables word-wrapping; otherwise auto-width. */
  width?: number;
  /** Text-box height in px. When set, clips overflow. */
  height?: number;
}

export interface BarcodeElement {
  id: string;
  type: 'barcode';
  x: number;
  y: number;
  value: string;
  /** Bar height in px — range 20–180 */
  height: number;
  /** Total barcode width in px — range 60–500. When set, barcode fills this width. */
  width?: number;
}

export interface QRElement {
  id: string;
  type: 'qr';
  x: number;
  y: number;
  value: string;
  /** Square side in px — range 30–300 */
  size: number;
}

export type LabelElement = TextElement | BarcodeElement | QRElement;

export interface CustomLabelConfig {
  widthMm: number;
  heightMm: number;
  elements: LabelElement[];
}

// ── Job history ───────────────────────────────────────────────────────────────

export interface LabelJob {
  id: string;
  createdAt: string;
  templateName: string;
  copies: number;
  barcodeValue: string;
  product?: Product;
  templateId?: TemplateId;
  isCustom?: boolean;
  customLabel?: CustomLabelConfig;
}

/** Swap MockProductAdapter for a real CellHub adapter without changing UI code */
export interface ProductAdapter {
  getAll(): Promise<Product[]>;
  getById(id: string): Promise<Product | null>;
  search(query: string): Promise<Product[]>;
}
