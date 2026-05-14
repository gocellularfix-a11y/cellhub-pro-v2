import type { Product, ProductAdapter } from '../types';
import type { InventoryItem } from '@/store/types';

function toProduct(item: InventoryItem): Product {
  return {
    id: item.id,
    name: item.name,
    price: item.price / 100,           // CellHub stores cents; labels module uses dollars
    sku: item.sku,
    imei: item.imei,
    barcode: item.barcode || item.sku, // barcode is optional on InventoryItem; fall back to sku
    category: item.category,
  };
}

export class CellHubProductAdapter implements ProductAdapter {
  constructor(private inventory: InventoryItem[]) {}

  async getAll(): Promise<Product[]> {
    return this.inventory.map(toProduct);
  }

  async getById(id: string): Promise<Product | null> {
    const item = this.inventory.find(i => i.id === id);
    return item ? toProduct(item) : null;
  }

  async search(query: string): Promise<Product[]> {
    const q = query.toLowerCase();
    return this.inventory
      .filter(i =>
        i.name.toLowerCase().includes(q) ||
        i.sku.toLowerCase().includes(q) ||
        (i.barcode || '').includes(q) ||
        (i.imei || '').includes(q) ||
        (i.category || '').toLowerCase().includes(q)
      )
      .map(toProduct);
  }
}
