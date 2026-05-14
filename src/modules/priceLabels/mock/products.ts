import type { Product, ProductAdapter } from '../types';

export const MOCK_PRODUCTS: Product[] = [
  {
    id: 'p1',
    name: 'Apple iPhone 15 Pro Max 256GB Natural Titanium',
    price: 699.99,
    sku: 'APL-IP15PM-256-NT',
    imei: '354678901234567',
    barcode: '012345678901',
    category: 'Apple Devices',
  },
  {
    id: 'p2',
    name: 'Samsung Galaxy S24 Ultra 512GB Titanium Black',
    price: 849.99,
    sku: 'SAM-GS24U-512-TB',
    imei: '490154203237518',
    barcode: '012345678902',
    category: 'Samsung Devices',
  },
  {
    id: 'p3',
    name: 'Google Pixel 8 Pro 256GB Obsidian',
    price: 549.99,
    sku: 'GOO-PXL8P-256-OB',
    imei: '356881109876543',
    barcode: '012345678903',
    category: 'Google Devices',
  },
  {
    id: 'p4',
    name: 'Apple iPhone 14 128GB Midnight (Refurbished)',
    price: 399.99,
    sku: 'APL-IP14-128-MN-R',
    imei: '352987001234568',
    barcode: '012345678904',
    category: 'Refurbished',
  },
  {
    id: 'p5',
    name: 'Samsung Galaxy A54 5G 128GB Awesome Graphite',
    price: 249.99,
    sku: 'SAM-A54-128-GR',
    barcode: '012345678905',
    category: 'Samsung Devices',
  },
  {
    id: 'p6',
    name: 'Anker USB-C to USB-C Cable 6ft Braided',
    price: 19.99,
    sku: 'ACC-ANKER-C2C-6FT',
    barcode: '012345678906',
    category: 'Accessories',
  },
  {
    id: 'p7',
    name: 'Spigen Tempered Glass Screen Protector iPhone 15',
    price: 14.99,
    sku: 'ACC-SPG-TG-IP15',
    barcode: '012345678907',
    category: 'Accessories',
  },
  {
    id: 'p8',
    name: 'OtterBox Commuter Case iPhone 15 Pro Black',
    price: 34.99,
    sku: 'ACC-OTB-COM-IP15P-BK',
    barcode: '012345678908',
    category: 'Cases',
  },
];

export class MockProductAdapter implements ProductAdapter {
  async getAll(): Promise<Product[]> {
    return [...MOCK_PRODUCTS];
  }

  async getById(id: string): Promise<Product | null> {
    return MOCK_PRODUCTS.find(p => p.id === id) ?? null;
  }

  async search(query: string): Promise<Product[]> {
    const q = query.toLowerCase();
    return MOCK_PRODUCTS.filter(
      p =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.barcode.includes(q) ||
        (p.imei && p.imei.includes(q)) ||
        (p.category && p.category.toLowerCase().includes(q))
    );
  }
}
