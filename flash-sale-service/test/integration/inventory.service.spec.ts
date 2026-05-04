import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Redis } from 'ioredis';
import { InventoryModule } from '../../src/inventory/inventory.module';
import { InventoryService } from '../../src/inventory/inventory.service';
import { KafkaProducerService } from '../../src/kafka/kafka.producer.service';
import { KafkaConsumerService } from '../../src/kafka/kafka.consumer.service';
import {
  KAFKA_CLIENT,
  REDIS_CLIENT,
  REDIS_KEYS,
  KAFKA_TOPICS,
  OrderCreatedEvent,
  PaymentResultEvent,
} from '../../src/config/constants';
import { Product } from '../../src/product/product.entity';

// ─── helpers ────────────────────────────────────────────────────────────────

const PRODUCT_ID = 'product_001';
const USER_ID = 'user_1';
const ORDER_ID = 'order-uuid-inventory-1';
const INITIAL_STOCK = 10;

const makeMessage = (payload: object) => ({
  message: { value: Buffer.from(JSON.stringify(payload)) },
});

// ─── suite ──────────────────────────────────────────────────────────────────

describe('InventoryService (integration)', () => {
  let app: INestApplication;
  let service: InventoryService;
  let productRepo: Repository<Product>;
  let redis: Redis;
  let mockConsume: jest.Mock;
  let mockKafkaEmit: jest.Mock;

  type MainHandler = (args: { topic: string; message: any }) => Promise<void>;
  type DlqHandler = (args: { message: any }) => Promise<void>;
  let mainHandler: MainHandler;
  let dlqHandler: DlqHandler;

  beforeAll(async () => {
    mockConsume = jest.fn().mockResolvedValue(undefined);
    mockKafkaEmit = jest.fn().mockReturnValue(undefined);

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({
          type: 'mysql',
          host: process.env.MYSQL_HOST ?? 'localhost',
          port: parseInt(process.env.MYSQL_PORT ?? '3306'),
          username: process.env.MYSQL_USER ?? 'appuser',
          password: process.env.MYSQL_PASSWORD ?? 'apppassword',
          database: process.env.MYSQL_DATABASE ?? 'flashsale',
          entities: [Product],
          synchronize: false,
          timezone: 'Z',
        }),
        InventoryModule,
      ],
    })
      .overrideProvider(KAFKA_CLIENT)
      .useValue({
        connect: jest.fn().mockResolvedValue(undefined),
        close: jest.fn().mockResolvedValue(undefined),
      })
      .overrideProvider(KafkaProducerService)
      .useValue({ emit: mockKafkaEmit })
      .overrideProvider(KafkaConsumerService)
      .useValue({ consume: mockConsume })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init(); // triggers onModuleInit — handlers are registered here

    service = moduleRef.get<InventoryService>(InventoryService);
    productRepo = moduleRef.get<Repository<Product>>(getRepositoryToken(Product));
    redis = moduleRef.get<Redis>(REDIS_CLIENT);

    // Capture the handlers registered during onModuleInit
    mainHandler = mockConsume.mock.calls[0][2] as MainHandler;
    dlqHandler = mockConsume.mock.calls[1][2] as DlqHandler;
  });

  afterAll(async () => {
    await app.close();
    await redis.quit();
  });

  beforeEach(async () => {
    await productRepo.save({
      id: PRODUCT_ID,
      name: 'Test Product',
      description: null,
      stock: INITIAL_STOCK,
      price: 99.99,
      saleStartDate: null,
      saleEndDate: null,
    });

    await redis.set(REDIS_KEYS.stock(PRODUCT_ID), INITIAL_STOCK);
    await redis.del(REDIS_KEYS.buyers(PRODUCT_ID));

    mockKafkaEmit.mockClear();
  });

  const getDBStock = async (): Promise<number> => {
    const product = await productRepo.findOne({ where: { id: PRODUCT_ID } });
    return product!.stock;
  };

  const getRedisStock = async (): Promise<number> =>
    parseInt((await redis.get(REDIS_KEYS.stock(PRODUCT_ID)))!);

  // ─── decrementStock ──────────────────────────────────────────────────────

  describe('decrementStock', () => {
    it('decrements MySQL product stock by 1', async () => {
      await service.decrementStock(PRODUCT_ID);

      expect(await getDBStock()).toBe(INITIAL_STOCK - 1);
    });

    it('decrements stock by N when called N times in sequence', async () => {
      await service.decrementStock(PRODUCT_ID);
      await service.decrementStock(PRODUCT_ID);
      await service.decrementStock(PRODUCT_ID);

      expect(await getDBStock()).toBe(INITIAL_STOCK - 3);
    });
  });

  // ─── revertDBStock ───────────────────────────────────────────────────────

  describe('revertDBStock', () => {
    it('increments MySQL product stock by 1', async () => {
      await service.revertDBStock(PRODUCT_ID, USER_ID);

      expect(await getDBStock()).toBe(INITIAL_STOCK + 1);
    });

    it('increments the Redis stock counter', async () => {
      await service.revertDBStock(PRODUCT_ID, USER_ID);

      expect(await getRedisStock()).toBe(INITIAL_STOCK + 1);
    });

    it('removes the userId from the Redis buyers set', async () => {
      await redis.sadd(REDIS_KEYS.buyers(PRODUCT_ID), USER_ID);

      await service.revertDBStock(PRODUCT_ID, USER_ID);

      const isMember = await redis.sismember(REDIS_KEYS.buyers(PRODUCT_ID), USER_ID);
      expect(isMember).toBe(0);
    });

    it('fully restores both MySQL and Redis after a prior claim — net change is zero', async () => {
      // Simulate what the order service does on a successful claim
      await service.decrementStock(PRODUCT_ID);
      await redis.sadd(REDIS_KEYS.buyers(PRODUCT_ID), USER_ID);
      await redis.decr(REDIS_KEYS.stock(PRODUCT_ID));

      await service.revertDBStock(PRODUCT_ID, USER_ID);

      expect(await getDBStock()).toBe(INITIAL_STOCK);
      expect(await getRedisStock()).toBe(INITIAL_STOCK);
      expect(await redis.sismember(REDIS_KEYS.buyers(PRODUCT_ID), USER_ID)).toBe(0);
    });
  });

  // ─── ORDER_CREATED handler ────────────────────────────────────────────────

  describe('ORDER_CREATED Kafka handler', () => {
    it('decrements MySQL stock when an ORDER_CREATED message is processed', async () => {
      const event: OrderCreatedEvent = { orderId: ORDER_ID, userId: USER_ID, productId: PRODUCT_ID };

      await mainHandler({ topic: KAFKA_TOPICS.ORDER_CREATED, ...makeMessage(event) });

      expect(await getDBStock()).toBe(INITIAL_STOCK - 1);
    });

    it('does not affect Redis stock — Redis is the fast-path gate, MySQL is the record', async () => {
      const event: OrderCreatedEvent = { orderId: ORDER_ID, userId: USER_ID, productId: PRODUCT_ID };

      await mainHandler({ topic: KAFKA_TOPICS.ORDER_CREATED, ...makeMessage(event) });

      // Redis stock is owned by the order service's Lua script — inventory consumer
      // only updates MySQL so the DB stays in sync with what Redis already gated.
      expect(await getRedisStock()).toBe(INITIAL_STOCK);
    });
  });

  // ─── PAYMENT_RESULT_FAILED handler ───────────────────────────────────────

  describe('PAYMENT_RESULT_FAILED Kafka handler', () => {
    it('increments MySQL stock and fully restores Redis when payment fails', async () => {
      // Simulate state after a successful order claim but before payment
      await service.decrementStock(PRODUCT_ID);
      await redis.sadd(REDIS_KEYS.buyers(PRODUCT_ID), USER_ID);
      await redis.decr(REDIS_KEYS.stock(PRODUCT_ID));

      const event: PaymentResultEvent = { orderId: ORDER_ID, userId: USER_ID, productId: PRODUCT_ID };

      await mainHandler({ topic: KAFKA_TOPICS.PAYMENT_RESULT_FAILED, ...makeMessage(event) });

      expect(await getDBStock()).toBe(INITIAL_STOCK);
      expect(await getRedisStock()).toBe(INITIAL_STOCK);
      expect(await redis.sismember(REDIS_KEYS.buyers(PRODUCT_ID), USER_ID)).toBe(0);
    });
  });

  // ─── DLQ reconciliation handler ──────────────────────────────────────────

  describe('DLQ reconciliation handler', () => {
    it('decrements MySQL stock when retrying a DLQ message', async () => {
      const event: OrderCreatedEvent = { orderId: ORDER_ID, userId: USER_ID, productId: PRODUCT_ID };

      await dlqHandler(makeMessage(event));

      expect(await getDBStock()).toBe(INITIAL_STOCK - 1);
    });

    it('does not throw when reconciliation fails — logs error and continues without a further DLQ emit', async () => {
      const event: OrderCreatedEvent = { orderId: ORDER_ID, userId: USER_ID, productId: PRODUCT_ID };
      jest.spyOn(service, 'decrementStock').mockRejectedValueOnce(new Error('Simulated DB failure'));

      await expect(dlqHandler(makeMessage(event))).resolves.not.toThrow();

      // No second DLQ — the reconciliation handler is the terminal recovery path.
      // A failure here requires manual intervention.
      expect(mockKafkaEmit).not.toHaveBeenCalled();
    });
  });
});
