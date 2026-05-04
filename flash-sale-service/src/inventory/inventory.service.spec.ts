import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { InventoryService } from './inventory.service';
import { Product } from '../product/product.entity';
import { InventoryRedisService } from '../redis/inventory.redis.service';
import { KafkaConsumerService } from '../kafka/kafka.consumer.service';
import { KafkaProducerService } from '../kafka/kafka.producer.service';
import {
  KAFKA_TOPICS,
  KAFKA_CONSUMER_GROUPS,
  OrderCreatedEvent,
  PaymentResultEvent,
} from '../config/constants';

const PRODUCT_ID = 'product_001';
const USER_ID = 'user_1';
const ORDER_ID = 'order-uuid-1';

const makeMessage = (payload: object) => ({
  message: { value: Buffer.from(JSON.stringify(payload)) },
});

describe('InventoryService', () => {
  let service: InventoryService;
  let mockDecrement: jest.Mock;
  let mockIncrement: jest.Mock;
  let mockRevertClaim: jest.Mock;
  let mockConsume: jest.Mock;
  let mockKafkaEmit: jest.Mock;

  beforeEach(async () => {
    mockDecrement = jest.fn().mockResolvedValue(undefined);
    mockIncrement = jest.fn().mockResolvedValue(undefined);
    mockRevertClaim = jest.fn().mockResolvedValue(undefined);
    mockConsume = jest.fn().mockResolvedValue(undefined);
    mockKafkaEmit = jest.fn().mockReturnValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        {
          provide: getRepositoryToken(Product),
          useValue: { decrement: mockDecrement, increment: mockIncrement },
        },
        {
          provide: InventoryRedisService,
          useValue: { revertClaim: mockRevertClaim },
        },
        {
          provide: KafkaConsumerService,
          useValue: { consume: mockConsume },
        },
        {
          provide: KafkaProducerService,
          useValue: { emit: mockKafkaEmit },
        },
      ],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
  });

  // ─── decrementStock ──────────────────────────────────────────────────────

  describe('decrementStock', () => {
    it('calls productRepo.decrement with the correct arguments', async () => {
      await service.decrementStock(PRODUCT_ID);

      expect(mockDecrement).toHaveBeenCalledTimes(1);
      expect(mockDecrement).toHaveBeenCalledWith({ id: PRODUCT_ID }, 'stock', 1);
    });
  });

  // ─── revertDBStock ───────────────────────────────────────────────────────

  describe('revertDBStock', () => {
    it('calls productRepo.increment with the correct arguments', async () => {
      await service.revertDBStock(PRODUCT_ID, USER_ID);

      expect(mockIncrement).toHaveBeenCalledWith({ id: PRODUCT_ID }, 'stock', 1);
    });

    it('calls redisService.revertClaim with the correct arguments', async () => {
      await service.revertDBStock(PRODUCT_ID, USER_ID);

      expect(mockRevertClaim).toHaveBeenCalledWith(PRODUCT_ID, USER_ID);
    });

    it('increments the DB before reverting the Redis claim', async () => {
      const callOrder: string[] = [];
      mockIncrement.mockImplementation(async () => { callOrder.push('increment'); });
      mockRevertClaim.mockImplementation(async () => { callOrder.push('revertClaim'); });

      await service.revertDBStock(PRODUCT_ID, USER_ID);

      expect(callOrder).toEqual(['increment', 'revertClaim']);
    });
  });

  // ─── Kafka consumer registration ──────────────────────────────────────────

  describe('onModuleInit — consumer registration', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('registers exactly two Kafka consumers', () => {
      expect(mockConsume).toHaveBeenCalledTimes(2);
    });

    it('subscribes the main consumer to ORDER_CREATED and PAYMENT_RESULT_FAILED', () => {
      expect(mockConsume).toHaveBeenCalledWith(
        KAFKA_CONSUMER_GROUPS.INVENTORY,
        [KAFKA_TOPICS.ORDER_CREATED, KAFKA_TOPICS.PAYMENT_RESULT_FAILED],
        expect.any(Function),
      );
    });

    it('subscribes the DLQ consumer to INVENTORY_DLQ', () => {
      expect(mockConsume).toHaveBeenCalledWith(
        KAFKA_CONSUMER_GROUPS.INVENTORY_DLQ,
        [KAFKA_TOPICS.INVENTORY_DLQ],
        expect.any(Function),
      );
    });
  });

  // ─── Main message handler ─────────────────────────────────────────────────

  describe('main Kafka handler', () => {
    type MainHandler = (args: { topic: string; message: any }) => Promise<void>;
    let handler: MainHandler;

    beforeEach(async () => {
      await service.onModuleInit();
      handler = mockConsume.mock.calls[0][2] as MainHandler;
    });

    it('calls decrementStock when ORDER_CREATED is received', async () => {
      const event: OrderCreatedEvent = { orderId: ORDER_ID, userId: USER_ID, productId: PRODUCT_ID };

      await handler({ topic: KAFKA_TOPICS.ORDER_CREATED, ...makeMessage(event) });

      expect(mockDecrement).toHaveBeenCalledWith({ id: PRODUCT_ID }, 'stock', 1);
    });

    it('calls revertDBStock when PAYMENT_RESULT_FAILED is received', async () => {
      const event: PaymentResultEvent = { orderId: ORDER_ID, userId: USER_ID, productId: PRODUCT_ID };

      await handler({ topic: KAFKA_TOPICS.PAYMENT_RESULT_FAILED, ...makeMessage(event) });

      expect(mockIncrement).toHaveBeenCalledWith({ id: PRODUCT_ID }, 'stock', 1);
      expect(mockRevertClaim).toHaveBeenCalledWith(PRODUCT_ID, USER_ID);
    });

    it('emits to INVENTORY_DLQ when ORDER_CREATED processing fails', async () => {
      const event: OrderCreatedEvent = { orderId: ORDER_ID, userId: USER_ID, productId: PRODUCT_ID };
      mockDecrement.mockRejectedValueOnce(new Error('DB error'));

      await handler({ topic: KAFKA_TOPICS.ORDER_CREATED, ...makeMessage(event) });

      expect(mockKafkaEmit).toHaveBeenCalledWith(KAFKA_TOPICS.INVENTORY_DLQ, event);
    });

    it('emits to INVENTORY_DLQ when PAYMENT_RESULT_FAILED processing fails', async () => {
      const event: PaymentResultEvent = { orderId: ORDER_ID, userId: USER_ID, productId: PRODUCT_ID };
      mockIncrement.mockRejectedValueOnce(new Error('DB error'));

      await handler({ topic: KAFKA_TOPICS.PAYMENT_RESULT_FAILED, ...makeMessage(event) });

      expect(mockKafkaEmit).toHaveBeenCalledWith(KAFKA_TOPICS.INVENTORY_DLQ, event);
    });

    it('does not throw when the handler errors — DLQ routing is the recovery path', async () => {
      const event: OrderCreatedEvent = { orderId: ORDER_ID, userId: USER_ID, productId: PRODUCT_ID };
      mockDecrement.mockRejectedValueOnce(new Error('DB error'));

      await expect(
        handler({ topic: KAFKA_TOPICS.ORDER_CREATED, ...makeMessage(event) }),
      ).resolves.not.toThrow();
    });
  });

  // ─── DLQ reconciliation handler ───────────────────────────────────────────

  describe('DLQ reconciliation handler', () => {
    type DlqHandler = (args: { message: any }) => Promise<void>;
    let dlqHandler: DlqHandler;

    beforeEach(async () => {
      await service.onModuleInit();
      dlqHandler = mockConsume.mock.calls[1][2] as DlqHandler;
    });

    it('retries decrementStock for the failed product', async () => {
      const event: OrderCreatedEvent = { orderId: ORDER_ID, userId: USER_ID, productId: PRODUCT_ID };

      await dlqHandler(makeMessage(event));

      expect(mockDecrement).toHaveBeenCalledWith({ id: PRODUCT_ID }, 'stock', 1);
    });

    it('does not throw when reconciliation fails — logs and continues', async () => {
      const event: OrderCreatedEvent = { orderId: ORDER_ID, userId: USER_ID, productId: PRODUCT_ID };
      mockDecrement.mockRejectedValueOnce(new Error('Still broken'));

      await expect(dlqHandler(makeMessage(event))).resolves.not.toThrow();
    });
  });
});
