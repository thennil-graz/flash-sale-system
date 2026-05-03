import { OrderResponse } from '../types/order';

const BASE_URL = import.meta.env.VITE_ORDER_SERVICE_URL ?? 'http://localhost:3001';

export async function placeOrder(userId: string, productId: string): Promise<OrderResponse> {
  const res = await fetch(`${BASE_URL}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, productId }),
  });
  if (!res.ok) throw new Error('Order failed');
  return res.json();
}

export async function getOrder(productId: string, userId: string): Promise<OrderResponse | null> {
  const res = await fetch(
    `${BASE_URL}/orders?productId=${encodeURIComponent(productId)}&userId=${encodeURIComponent(userId)}`,
  );
  if (!res.ok) throw new Error('Failed to fetch order');
  return res.json();
}
