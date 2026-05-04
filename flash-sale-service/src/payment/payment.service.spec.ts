import { Test, TestingModule } from '@nestjs/testing';
import { PaymentService } from './payment.service';
import { PaymentGatewayService } from './payment.gateway.service';
import { OrderService } from '../order/order.service';
import { OrderStatus } from '../order/order.entity';
import { InventoryRedisService } from '../redis/inventory.redis.service';
import { KafkaConsumerService } from '../kafka/kafka.consumer.service';
import { KafkaProducerService } from '../kafka/kafka.producer.service';
import {
  KAFKA_TOPICS,
  KAFKA_CONSUMER_GROUPS,
  OrderCreatedEvent,
} from '../config/constants';

const PRODUCT_ID = 'product_001';
const USER_ID = 'user_1';
const ORDER_ID = 'order-uuid-1';

const ORDER_CREATED_EVENT: OrderCreatedEvent = {
  orderId: ORDER_ID,
  userId: USER_ID,
  productId: PRODUCT_ID,
};

const makeMessage = (payload: object) => ({
  message: { value: Buffer.from(JSON.stringify(payload)) },
});

describe('PaymentService', () => {
  let service: PaymentService;
  let mockCharge: jest.Mock;
  let mockUpdateStatus: jest.Mock;
  let mockRevertClaim: jest.Mock;
  let mockConsume: jest.Mock;
  let mockKafkaEmit: jest.Mock;

  beforeEach(async () => {
    mockCharge = jest.fn();
    mockUpdateStatus = jest.fn().mockResolvedValue(undefined);
    mockRevertClaim = jest.fn().mockResolvedValue(undefined);
    mockConsume = jest.fn().mockResolvedValue(undefined);
    mockKafkaEmit = jest.fn().mockReturnValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: PaymentGatewayService, useValue: { charge: mockCharge } },
        { provide: OrderService, useValue: { updateStatus: mockUpdateStatus } },
        { provide: InventoryRedisService, useValue: { revertClaim: mockRevertClaim } },
        { provide: KafkaConsumerService, useValue: { consume: mockConsume } },
        { provide: KafkaProducerService, useValue: { emit: mockKafkaEmit } },
      ],
    }).compile();

    service = module.get<PaymentService>(PaymentService);
  });

  // ─── Kafka consumer registration ──────────────────────────────────────────

  describe('onModuleInit — consumer registration', () => {
    it('registers exactly one Kafka consumer', async () => {
      await service.onModuleInit();

      expect(mockConsume).toHaveBeenCalledTimes(1);
    });

    it('subscribes to ORDER_CREATED with the PAYMENT consumer group', async () => {
      await service.onModuleInit();

      expect(mockConsume).toHaveBeenCalledWith(
        KAFKA_CONSUMER_GROUPS.PAYMENT,
        [KAFKA_TOPICS.ORDER_CREATED],
        expect.any(Function),
      );
    });
  });

  // ─── processPayment — success path ───────────────────────────────────────

  describe('processPayment — charge succeeds', () => {
    beforeEach(() => {
      mockCharge.mockResolvedValue(true);
    });

    it('calls paymentGateway.charge with the userId', async () => {
      await service.processPayment(ORDER_CREATED_EVENT);

      expect(mockCharge).toHaveBeenCalledWith(USER_ID);
    });

    it('updates the order status to SUCCESS', async () => {
      await service.processPayment(ORDER_CREATED_EVENT);

      expect(mockUpdateStatus).toHaveBeenCalledWith(ORDER_ID, OrderStatus.SUCCESS);
    });

    it('emits PAYMENT_RESULT_SUCCESS with orderId, userId, productId', async () => {
      await service.processPayment(ORDER_CREATED_EVENT);

      expect(mockKafkaEmit).toHaveBeenCalledWith(
        KAFKA_TOPICS.PAYMENT_RESULT_SUCCESS,
        { orderId: ORDER_ID, userId: USER_ID, productId: PRODUCT_ID },
      );
    });

    it('does not revert the Redis claim on success', async () => {
      await service.processPayment(ORDER_CREATED_EVENT);

      expect(mockRevertClaim).not.toHaveBeenCalled();
    });

    it('does not emit PAYMENT_RESULT_FAILED on success', async () => {
      await service.processPayment(ORDER_CREATED_EVENT);

      const failedEmits = mockKafkaEmit.mock.calls.filter(
        ([topic]) => topic === KAFKA_TOPICS.PAYMENT_RESULT_FAILED,
      );
      expect(failedEmits).toHaveLength(0);
    });
  });

  // ─── processPayment — failure path ───────────────────────────────────────

  describe('processPayment — charge fails', () => {
    beforeEach(() => {
      mockCharge.mockResolvedValue(false);
    });

    it('updates the order status to FAILED', async () => {
      await service.processPayment(ORDER_CREATED_EVENT);

      expect(mockUpdateStatus).toHaveBeenCalledWith(ORDER_ID, OrderStatus.FAILED);
    });

    it('reverts the Redis claim with the correct productId and userId', async () => {
      await service.processPayment(ORDER_CREATED_EVENT);

      expect(mockRevertClaim).toHaveBeenCalledWith(PRODUCT_ID, USER_ID);
    });

    it('emits PAYMENT_RESULT_FAILED with orderId, userId, productId', async () => {
      await service.processPayment(ORDER_CREATED_EVENT);

      expect(mockKafkaEmit).toHaveBeenCalledWith(
        KAFKA_TOPICS.PAYMENT_RESULT_FAILED,
        { orderId: ORDER_ID, userId: USER_ID, productId: PRODUCT_ID },
      );
    });

    it('does not emit PAYMENT_RESULT_SUCCESS on failure', async () => {
      await service.processPayment(ORDER_CREATED_EVENT);

      const successEmits = mockKafkaEmit.mock.calls.filter(
        ([topic]) => topic === KAFKA_TOPICS.PAYMENT_RESULT_SUCCESS,
      );
      expect(successEmits).toHaveLength(0);
    });
  });

  // ─── Kafka handler ────────────────────────────────────────────────────────

  describe('ORDER_CREATED Kafka handler', () => {
    type Handler = (args: { message: any }) => Promise<void>;
    let handler: Handler;

    beforeEach(async () => {
      await service.onModuleInit();
      handler = mockConsume.mock.calls[0][2] as Handler;
    });

    it('calls processPayment with the parsed event when a message arrives', async () => {
      mockCharge.mockResolvedValue(true);
      const spy = jest.spyOn(service, 'processPayment');

      await handler(makeMessage(ORDER_CREATED_EVENT));

      expect(spy).toHaveBeenCalledWith(ORDER_CREATED_EVENT);
    });

    it('emits to PAYMENT_DLQ when processPayment throws', async () => {
      mockCharge.mockRejectedValue(new Error('Gateway timeout'));

      await handler(makeMessage(ORDER_CREATED_EVENT));

      expect(mockKafkaEmit).toHaveBeenCalledWith(
        KAFKA_TOPICS.PAYMENT_DLQ,
        expect.objectContaining({ orderId: ORDER_ID }),
      );
    });

    it('does not throw when processPayment errors — DLQ routing is the recovery path', async () => {
      mockCharge.mockRejectedValue(new Error('Gateway timeout'));

      await expect(handler(makeMessage(ORDER_CREATED_EVENT))).resolves.not.toThrow();
    });
  });
});
