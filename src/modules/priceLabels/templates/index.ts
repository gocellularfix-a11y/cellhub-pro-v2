import type { ComponentType } from 'react';
import type { LabelProps, LabelTemplate, TemplateId } from '../types';
import {
  SMALL_PRICE_LABEL_W_MM,
  SMALL_PRICE_LABEL_H_MM,
  LARGE_LABEL_W_MM,
  LARGE_LABEL_H_MM,
} from '../utils';
import { SmallPriceLabel } from './SmallPriceLabel';
import { BarcodeLabel } from './BarcodeLabel';
import { ShelfLabel } from './ShelfLabel';
import { LargeLabel } from './LargeLabel';

interface TemplateEntry extends LabelTemplate {
  component: ComponentType<LabelProps>;
}

export const TEMPLATE_REGISTRY: Record<TemplateId, TemplateEntry> = {
  'small-price': {
    id: 'small-price',
    name: 'Small Price Label',
    description: `2.25×1.25 in (${SMALL_PRICE_LABEL_W_MM}×${SMALL_PRICE_LABEL_H_MM} mm) — compact price tag`,
    widthMm: SMALL_PRICE_LABEL_W_MM,
    heightMm: SMALL_PRICE_LABEL_H_MM,
    component: SmallPriceLabel,
  },
  'barcode-label': {
    id: 'barcode-label',
    name: 'Barcode Label',
    description: '3.5×1.4 in (89×36 mm) — full-width barcode with product info',
    widthMm: 89,
    heightMm: 36,
    component: BarcodeLabel,
  },
  'shelf-label': {
    id: 'shelf-label',
    name: 'Shelf Label',
    description: '4×3 in (101.6×76.2 mm) — large retail shelf tag',
    widthMm: 101.6,
    heightMm: 76.2,
    component: ShelfLabel,
  },
  'large-label': {
    id: 'large-label',
    name: 'Large / Shipping Label',
    description: `4×6 in (${LARGE_LABEL_W_MM}×${LARGE_LABEL_H_MM} mm) — display or shipping`,
    widthMm: LARGE_LABEL_W_MM,
    heightMm: LARGE_LABEL_H_MM,
    component: LargeLabel,
  },
};

export const TEMPLATE_LIST = Object.values(TEMPLATE_REGISTRY);
