import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Redis } from 'ioredis';
import * as request from 'supertest';
import { OrderModule } from '../../src/order/order.module';
import { ProductModule } from '../../src/product/product.module';
import { KafkaProducerService } from '../../src/kafka/kafka.producer.service';
import { KafkaConsumerService } from '../../src/kafka/kafka.consumer.service';
import { KAFKA_CLIENT, REDIS_CLIENT, REDIS_KEYS } from '../../src/config/constants';
import { Order, OrderStatus } from '../../src/order/order.entity';
import { Product } from '../../src/product/product.entity';

// ─── helpers ────────────────────────────────────────────────────────────────

const PRODUCT_ID = 'product_001';
const DEFAULT_STOCK = 10;

const activeProduct = (): Partial<Product> => ({
  id: PRODUCT_ID,
  name: 'Flash Product',
  description: null,
  stock: DEFAULT_STOCK,
  price: 99.99,
  saleStartDate: new Date(Date.now() - 3_600_000),
  saleEndDate: new Date(Date.now() + 3_600_000),
});

// ─── suite ──────────────────────────────────────────────────────────────────

describe('OrderController (integration)', () => {
  let app: INestApplication;
  let orderRepo: Repository<Order>;
  let productRepo: Repository<Product>;
  let redis: Redis;
  let mockKafkaEmit: jest.Mock;

  beforeAll(async () => {
    mockKafkaEmit = jest.fn().mockResolvedValue(undefined);

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
          entities: [Order, Product],
          synchronize: false,
          timezone: 'Z',
        }),
        ProductModule,
        OrderModule,
      ],
    })
      .overrideProvider(KAFKA_CLIENT)
      .useValue({
        connect: jest.fn().mockResolvedValue(undefined),
        close: jest.fn().mockResolvedValue(undefined),
        emit: jest.fn(),
        subscribeToResponseOf: jest.fn(),
      })
      .overrideProvider(KafkaProducerService)
      .useValue({ emit: mockKafkaEmit })
      .overrideProvider(KafkaConsumerService)
      .useValue({ consume: jest.fn().mockResolvedValue(undefined) })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    orderRepo = moduleRef.get<Repository<Order>>(getRepositoryToken(Order));
    productRepo = moduleRef.get<Repository<Product>>(getRepositoryToken(Product));
    redis = moduleRef.get<Redis>(REDIS_CLIENT);
  });

  afterAll(async () => {
    await app.close();
    await redis.quit();
  });

  beforeEach(async () => {
    await orderRepo.createQueryBuilder().delete().execute();

    await productRepo.save(activeProduct());

    await redis.set(REDIS_KEYS.stock(PRODUCT_ID), DEFAULT_STOCK);
    await redis.del(REDIS_KEYS.buyers(PRODUCT_ID));

    mockKafkaEmit.mockResolvedValue(undefined);
  });

  // ─── POST /orders ──────────────────────────────────────────────────────────

  describe('POST /orders', () => {
    it('returns 201 and a PENDING order when stock is available and sale is active', async () => {
      const res = await request(app.getHttpServer())
        .post('/orders')
        .send({ userId: 'user_1', productId: PRODUCT_ID });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        userId: 'user_1',
        productId: PRODUCT_ID,
        status: OrderStatus.PENDING,
      });
    });

    it('emits an ORDER_CREATED Kafka event with orderId, userId, and productId on success', async () => {
      const res = await request(app.getHttpServer())
        .post('/orders')
        .send({ userId: 'user_kafka', productId: PRODUCT_ID });

      expect(res.status).toBe(201);
      expect(mockKafkaEmit).toHaveBeenCalledTimes(1);
      expect(mockKafkaEmit).toHaveBeenCalledWith(
        'ORDER_CREATED',
        expect.objectContaining({
          orderId: res.body.id,
          userId: 'user_kafka',
          productId: PRODUCT_ID,
        }),
      );
    });

    it('does not emit a Kafka event when the sale has ended', async () => {
      await productRepo.save({
        ...activeProduct(),
        saleStartDate: new Date(Date.now() - 7_200_000),
        saleEndDate: new Date(Date.now() - 3_600_000),
      });

      await request(app.getHttpServer())
        .post('/orders')
        .send({ userId: 'user_1', productId: PRODUCT_ID });

      expect(mockKafkaEmit).not.toHaveBeenCalled();
    });

    it('does not emit a Kafka event when stock is 0', async () => {
      await redis.set(REDIS_KEYS.stock(PRODUCT_ID), 0);

      await request(app.getHttpServer())
        .post('/orders')
        .send({ userId: 'user_1', productId: PRODUCT_ID });

      expect(mockKafkaEmit).not.toHaveBeenCalled();
    });

    it('returns 409 when stock is 0 (out of stock)', async () => {
      await redis.set(REDIS_KEYS.stock(PRODUCT_ID), 0);

      const res = await request(app.getHttpServer())
        .post('/orders')
        .send({ userId: 'user_1', productId: PRODUCT_ID });

      expect(res.status).toBe(409);
      expect(res.body.message).toBe('Out of stock');
    });

    it('returns 409 when the same user tries to buy a second time', async () => {
      await request(app.getHttpServer())
        .post('/orders')
        .send({ userId: 'user_dup', productId: PRODUCT_ID });

      const res = await request(app.getHttpServer())
        .post('/orders')
        .send({ userId: 'user_dup', productId: PRODUCT_ID });

      expect(res.status).toBe(409);
      expect(res.body.message).toBe('Already purchased');
    });

    it('returns 400 when userId is missing', async () => {
      const res = await request(app.getHttpServer())
        .post('/orders')
        .send({ productId: PRODUCT_ID });

      expect(res.status).toBe(400);
    });

    it('returns 400 when productId is missing', async () => {
      const res = await request(app.getHttpServer())
        .post('/orders')
        .send({ userId: 'user_1' });

      expect(res.status).toBe(400);
    });

    it('returns 400 when body is empty', async () => {
      const res = await request(app.getHttpServer())
        .post('/orders')
        .send({});

      expect(res.status).toBe(400);
    });

    it('returns 400 when sale has not started yet', async () => {
      await productRepo.save({
        ...activeProduct(),
        saleStartDate: new Date(Date.now() + 3_600_000),
        saleEndDate: new Date(Date.now() + 7_200_000),
      });

      const res = await request(app.getHttpServer())
        .post('/orders')
        .send({ userId: 'user_1', productId: PRODUCT_ID });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Sale has not started yet');
    });

    it('returns 400 when sale has ended', async () => {
      await productRepo.save({
        ...activeProduct(),
        saleStartDate: new Date(Date.now() - 7_200_000),
        saleEndDate: new Date(Date.now() - 3_600_000),
      });

      const res = await request(app.getHttpServer())
        .post('/orders')
        .send({ userId: 'user_1', productId: PRODUCT_ID });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Sale has ended');
    });

    it('returns 201 when sale dates are null (always-open sale)', async () => {
      await productRepo.save({
        ...activeProduct(),
        saleStartDate: null,
        saleEndDate: null,
      });

      const res = await request(app.getHttpServer())
        .post('/orders')
        .send({ userId: 'user_open', productId: PRODUCT_ID });

      expect(res.status).toBe(201);
    });

    it('persists the order in MySQL with PENDING status', async () => {
      await request(app.getHttpServer())
        .post('/orders')
        .send({ userId: 'user_persist', productId: PRODUCT_ID });

      const order = await orderRepo.findOne({
        where: { userId: 'user_persist', productId: PRODUCT_ID },
      });

      expect(order).not.toBeNull();
      expect(order!.status).toBe(OrderStatus.PENDING);
    });

    it('decrements Redis stock by exactly 1 on success', async () => {
      const before = parseInt((await redis.get(REDIS_KEYS.stock(PRODUCT_ID)))!);

      await request(app.getHttpServer())
        .post('/orders')
        .send({ userId: 'user_stock', productId: PRODUCT_ID });

      const after = parseInt((await redis.get(REDIS_KEYS.stock(PRODUCT_ID)))!);

      expect(after).toBe(before - 1);
    });

    it('does not decrement Redis stock when the sale has ended', async () => {
      await productRepo.save({
        ...activeProduct(),
        saleStartDate: new Date(Date.now() - 7_200_000),
        saleEndDate: new Date(Date.now() - 3_600_000),
      });
      const before = parseInt((await redis.get(REDIS_KEYS.stock(PRODUCT_ID)))!);

      await request(app.getHttpServer())
        .post('/orders')
        .send({ userId: 'user_1', productId: PRODUCT_ID });

      const after = parseInt((await redis.get(REDIS_KEYS.stock(PRODUCT_ID)))!);

      expect(after).toBe(before);
    });
  });

  // ─── Redis rollback on MySQL failure ─────────────────────────────────────

  describe('Redis rollback when MySQL save fails', () => {
    it('restores Redis stock and buyers set when the DB write fails', async () => {
      const stockBefore = parseInt(
        (await redis.get(REDIS_KEYS.stock(PRODUCT_ID)))!,
      );
      const buyersBefore = await redis.smembers(REDIS_KEYS.buyers(PRODUCT_ID));

      jest
        .spyOn(orderRepo, 'save')
        .mockRejectedValueOnce(new Error('Simulated DB failure'));

      const res = await request(app.getHttpServer())
        .post('/orders')
        .send({ userId: 'user_rollback', productId: PRODUCT_ID });

      expect(res.status).toBe(500);

      const stockAfter = parseInt(
        (await redis.get(REDIS_KEYS.stock(PRODUCT_ID)))!,
      );
      const buyersAfter = await redis.smembers(REDIS_KEYS.buyers(PRODUCT_ID));

      expect(stockAfter).toBe(stockBefore);
      expect(buyersAfter).toEqual(buyersBefore);
    });
  });

  // ─── Concurrency ───────────────────────────────────────────────────────────

  describe('concurrency', () => {
    it('does not oversell: exactly N orders succeed for N stock units under burst load', async () => {
      const STOCK = 5;
      const CONCURRENT_USERS = 50;

      await redis.set(REDIS_KEYS.stock(PRODUCT_ID), STOCK);

      const responses = await Promise.all(
        Array.from({ length: CONCURRENT_USERS }, (_, i) =>
          request(app.getHttpServer())
            .post('/orders')
            .send({ userId: `burst_user_${i}`, productId: PRODUCT_ID }),
        ),
      );

      const successes = responses.filter((r) => r.status === 201);
      const conflicts = responses.filter((r) => r.status === 409);

      expect(successes.length).toBe(STOCK);
      expect(conflicts.length).toBe(CONCURRENT_USERS - STOCK);

      const finalStock = parseInt(
        (await redis.get(REDIS_KEYS.stock(PRODUCT_ID)))!,
      );
      expect(finalStock).toBe(0);
    });

    it('prevents duplicate purchases under concurrent requests from the same user', async () => {
      const ATTEMPTS = 20;

      const responses = await Promise.all(
        Array.from({ length: ATTEMPTS }, () =>
          request(app.getHttpServer())
            .post('/orders')
            .send({ userId: 'race_user', productId: PRODUCT_ID }),
        ),
      );

      const successes = responses.filter((r) => r.status === 201);

      expect(successes.length).toBe(1);
    });
  });

  // ─── GET /orders ──────────────────────────────────────────────────────────

  describe('GET /orders', () => {
    it('returns null when the user has no successful order for this product', async () => {
      const res = await request(app.getHttpServer())
        .get('/orders')
        .query({ userId: 'no_order_user', productId: PRODUCT_ID });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({});
    });

    it('returns null when the order exists but is still PENDING', async () => {
      await orderRepo.save(
        orderRepo.create({
          id: 'order-pending-get',
          userId: 'pending_user',
          productId: PRODUCT_ID,
          status: OrderStatus.PENDING,
          eventPublished: true,
        }),
      );

      const res = await request(app.getHttpServer())
        .get('/orders')
        .query({ userId: 'pending_user', productId: PRODUCT_ID });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({});
    });

    it('returns null when the order exists but FAILED (user can retry)', async () => {
      await orderRepo.save(
        orderRepo.create({
          id: 'order-failed-get',
          userId: 'failed_user',
          productId: PRODUCT_ID,
          status: OrderStatus.FAILED,
          eventPublished: true,
        }),
      );

      const res = await request(app.getHttpServer())
        .get('/orders')
        .query({ userId: 'failed_user', productId: PRODUCT_ID });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({});
    });

    it('returns the order when a successful purchase exists', async () => {
      await orderRepo.save(
        orderRepo.create({
          id: 'order-success-get',
          userId: 'success_user',
          productId: PRODUCT_ID,
          status: OrderStatus.SUCCESS,
          eventPublished: true,
        }),
      );

      const res = await request(app.getHttpServer())
        .get('/orders')
        .query({ userId: 'success_user', productId: PRODUCT_ID });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        userId: 'success_user',
        productId: PRODUCT_ID,
        status: OrderStatus.SUCCESS,
      });
    });
  });
});
