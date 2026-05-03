import { Product } from '../types/product';

const BASE_URL = import.meta.env.VITE_ORDER_SERVICE_URL ?? 'http://localhost:3001';

export async function getProduct(id: string): Promise<Product> {
  const res = await fetch(`${BASE_URL}/products/${id}`);
  if (!res.ok) throw new Error('Failed to fetch product');
  return res.json();
}
