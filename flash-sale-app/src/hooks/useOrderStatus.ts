import { useState, useEffect, useRef } from 'react';
import { OrderStatus } from '../types/order';
import { getOrder } from '../api/order';

const BASE_URL = import.meta.env.VITE_ORDER_SERVICE_URL ?? 'http://localhost:3001';

export function useOrderStatus(userId: string | null, productId: string | null): OrderStatus {
  const [status, setStatus] = useState<OrderStatus>('idle');
  const esRef = useRef<EventSource | null>(null);

  // On mount: check if an order already exists and restore its status
  useEffect(() => {
    if (!userId || !productId) return;
    getOrder(productId, userId)
      .then((order) => {
        if (!order) return;
        if (order.status === 'SUCCESS') setStatus('success');
        else if (order.status === 'PENDING') setStatus('pending');
        else if (order.status === 'FAILED') setStatus('failed');
      })
      .catch(() => {});
  }, [userId, productId]);

  // SSE: real-time payment result pushed from the backend
  useEffect(() => {
    if (!userId) return;

    const es = new EventSource(`${BASE_URL}/events/${userId}`);
    esRef.current = es;

    es.onmessage = (e: MessageEvent) => {
      const data = JSON.parse(e.data) as { status: string; orderId: string };
      setStatus(data.status === 'SUCCESS' ? 'success' : 'failed');
    };

    es.onerror = () => setStatus('failed');

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [userId]);

  return status;
}
