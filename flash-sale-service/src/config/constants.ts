export const KAFKA_TOPICS = {
  ORDER_CREATED: 'ORDER_CREATED',
  PAYMENT_RESULT_SUCCESS: 'PAYMENT_RESULT_SUCCESS',
  PAYMENT_RESULT_FAILED: 'PAYMENT_RESULT_FAILED',
  INVENTORY_DLQ: 'INVENTORY_DLQ',
  PAYMENT_DLQ: 'PAYMENT_DLQ',
} as const;

export const REDIS_KEYS = {
  stock: (productId: string) => `stock:${productId}`,
  buyers: (productId: string) => `product:${productId}:buyers`,
};

export const KAFKA_CLIENT = 'KAFKA_CLIENT';
export const REDIS_CLIENT = 'REDIS_CLIENT';

export const KAFKA_CONSUMER_GROUPS = {
  INVENTORY: 'flash-sale-inventory-consumer',
  INVENTORY_DLQ: 'flash-sale-inventory-dlq-consumer',
  PAYMENT: 'flash-sale-payment-consumer',
  SSE: 'flash-sale-sse-consumer',
} as const;

// ---------------------------------------------------------------------------
// Shared Kafka event payloads
// ---------------------------------------------------------------------------

export interface OrderCreatedEvent {
  orderId: string;
  userId: string;
  productId: string;
}

export interface PaymentResultEvent {
  orderId: string;
  userId: string;
  productId: string;
}
