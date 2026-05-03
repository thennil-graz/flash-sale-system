export type OrderStatus = 'idle' | 'pending' | 'success' | 'failed';

export interface OrderResponse {
  id: string;
  userId: string;
  productId: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  eventPublished: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OrderDetails {
  orderId: string;
  productTitle: string;
  productPrice: number;
  email: string;
  deliveryAddress: string;
}

export interface OrderState {
  orderId?: string;
  productTitle?: string;
  productPrice?: number;
  quantity?: number;
  userId?: string;
  productId?: string;
}
