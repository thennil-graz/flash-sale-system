import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { Redis } from 'ioredis';
import { PaymentService } from '../../src/payment/payment.service';
import { PaymentGatewayService } from '../../src/payment/payment.gateway.service';
import { OrderService } from '../../src/order/order.service';
import { OrderStatus } from '../../src/order/order.entity';
import { InventoryRedisService } from '../../src/redis/inventory.redis.service';
import { KafkaConsumerService } from '../../src/kafka/kafka.consumer.service';
import { KafkaProducerService } from '../../src/kafka/kafka.producer.service';
import { RedisModule } from '../../src/redis/redis.module';
import {
  REDIS_CLIENT,
  REDIS_KEYS,
  KAFKA_TOPICS,
  KAFKA_CONSUMER_GROUPS,
  OrderCreatedEvent,
} from '../../src/config/constants';

// ─── helpers ────────────────────────────────────────────────────────────────

const PRODUCT_ID = 'product_001';
const USER_ID = 'user_payment_integration';
const ORDER_ID = 'order-uuid-payment-1';
const INITIAL_STOCK = 10;

const ORDER_CREATED_EVENT: OrderCreatedEvent = {
  orderId: ORDER_ID,
  userId: USER_ID,
  productId: PRODUCT_ID,
};

const makeMessage = (payload: object) => ({
  message: { value: Buffer.from(JSON.stringify(payload)) },
});

// ─── suite ──────────────────────────────────────────────────────────────────

describe('PaymentService (integration)', () => {
  let app: INestApplication;
  let service: PaymentService;
  let redis: Redis;
  let mockCharge: jest.Mock;
  let mockUpdateStatus: jest.Mock;
  let mockConsume: jest.Mock;
  let mockKafkaEmit: jest.Mock;

  type Handler = (args: { message: any }) => Promise<void>;
  let handler: Handler;

  beforeAll(async () => {
    mockCharge = jest.fn();
    mockUpdateStatus = jest.fn().mockResolvedValue(undefined);
    mockConsume = jest.fn().mockResolvedValue(undefined);
    mockKafkaEmit = jest.fn().mockReturnValue(undefined);

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        RedisModule, // real Redis — the only infra under test here
      ],
      providers: [
        PaymentService,
        // Control charge outcome per-test
        { provide: PaymentGatewayService, useValue: { charge: mockCharge } },
        // Mocked — OrderService is already covered by the order integration tests
        { provide: OrderService, useValue: { updateStatus: mockUpdateStatus } },
        { provide: KafkaConsumerService, useValue: { consume: mockConsume } },
        { provide: KafkaProducerService, useValue: { emit: mockKafkaEmit } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init(); // triggers onModuleInit — handler is registered here

    service = moduleRef.get<PaymentService>(PaymentService);
    redis = moduleRef.get<Redis>(REDIS_CLIENT);

    // Capture the handler registered during onModuleInit
    handler = mockConsume.mock.calls[0][2] as Handler;
  });

  afterAll(async () => {
    await app.close();
    await redis.quit();
  });

  beforeEach(async () => {
    // Simulate the Redis state left by a successful order claim
    await redis.set(REDIS_KEYS.stock(PRODUCT_ID), INITIAL_STOCK);
    await redis.sadd(REDIS_KEYS.buyers(PRODUCT_ID), USER_ID);

    mockCharge.mockReset();
    mockUpdateStatus.mockReset().mockResolvedValue(undefined);
    mockKafkaEmit.mockReset();
  });

  const getRedisStock = async (): Promise<number> =>
    parseInt((await redis.get(REDIS_KEYS.stock(PRODUCT_ID)))!);

  // ─── Consumer registration ────────────────────────────────────────────────

  describe('onModuleInit — consumer registration', () => {
    it('registers one consumer on the PAYMENT group listening to ORDER_CREATED', () => {
      expect(mockConsume).toHaveBeenCalledWith(
        KAFKA_CONSUMER_GROUPS.PAYMENT,
        [KAFKA_TOPICS.ORDER_CREATED],
        expect.any(Function),
      );
    });
  });

  // ─── processPayment — success ─────────────────────────────────────────────

  describe('processPayment — charge succeeds', () => {
    beforeEach(() => {
      mockCharge.mockResolvedValue(true);
    });

    it('does not touch Redis — no revert on success', async () => {
      await service.processPayment(ORDER_CREATED_EVENT);

      expect(await getRedisStock()).toBe(INITIAL_STOCK);
      expect(await redis.sismember(REDIS_KEYS.buyers(PRODUCT_ID), USER_ID)).toBe(1);
    });

    it('emits PAYMENT_RESULT_SUCCESS with the correct payload', async () => {
      await service.processPayment(ORDER_CREATED_EVENT);

      expect(mockKafkaEmit).toHaveBeenCalledWith(
        KAFKA_TOPICS.PAYMENT_RESULT_SUCCESS,
        { orderId: ORDER_ID, userId: USER_ID, productId: PRODUCT_ID },
      );
    });

    it('updates order status to SUCCESS', async () => {
      await service.processPayment(ORDER_CREATED_EVENT);

      expect(mockUpdateStatus).toHaveBeenCalledWith(ORDER_ID, OrderStatus.SUCCESS);
    });
  });

  // ─── processPayment — failure ─────────────────────────────────────────────

  describe('processPayment — charge fails', () => {
    beforeEach(() => {
      mockCharge.mockResolvedValue(false);
    });

    it('increments the Redis stock counter (revertClaim)', async () => {
      await service.processPayment(ORDER_CREATED_EVENT);

      expect(await getRedisStock()).toBe(INITIAL_STOCK + 1);
    });

    it('removes the userId from the Redis buyers set (revertClaim)', async () => {
      await service.processPayment(ORDER_CREATED_EVENT);

      expect(await redis.sismember(REDIS_KEYS.buyers(PRODUCT_ID), USER_ID)).toBe(0);
    });

    it('emits PAYMENT_RESULT_FAILED with the correct payload', async () => {
      await service.processPayment(ORDER_CREATED_EVENT);

      expect(mockKafkaEmit).toHaveBeenCalledWith(
        KAFKA_TOPICS.PAYMENT_RESULT_FAILED,
        { orderId: ORDER_ID, userId: USER_ID, productId: PRODUCT_ID },
      );
    });

    it('updates order status to FAILED', async () => {
      await service.processPayment(ORDER_CREATED_EVENT);

      expect(mockUpdateStatus).toHaveBeenCalledWith(ORDER_ID, OrderStatus.FAILED);
    });
  });

  // ─── ORDER_CREATED Kafka handler ──────────────────────────────────────────

  describe('ORDER_CREATED Kafka handler — end-to-end via captured handler', () => {
    it('reverts Redis claim when payment fails via the Kafka handler', async () => {
      mockCharge.mockResolvedValue(false);

      await handler(makeMessage(ORDER_CREATED_EVENT));

      expect(await getRedisStock()).toBe(INITIAL_STOCK + 1);
      expect(await redis.sismember(REDIS_KEYS.buyers(PRODUCT_ID), USER_ID)).toBe(0);
    });

    it('leaves Redis untouched when payment succeeds via the Kafka handler', async () => {
      mockCharge.mockResolvedValue(true);

      await handler(makeMessage(ORDER_CREATED_EVENT));

      expect(await getRedisStock()).toBe(INITIAL_STOCK);
      expect(await redis.sismember(REDIS_KEYS.buyers(PRODUCT_ID), USER_ID)).toBe(1);
    });

    it('emits to PAYMENT_DLQ and does not throw when processPayment errors', async () => {
      mockCharge.mockRejectedValue(new Error('Gateway timeout'));

      await expect(handler(makeMessage(ORDER_CREATED_EVENT))).resolves.not.toThrow();

      expect(mockKafkaEmit).toHaveBeenCalledWith(
        KAFKA_TOPICS.PAYMENT_DLQ,
        expect.objectContaining({ orderId: ORDER_ID }),
      );
    });
  });
});
