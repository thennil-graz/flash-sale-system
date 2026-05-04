import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { SseService } from '../../src/sse/sse.service';
import { SseModule } from '../../src/sse/sse.module';
import { KafkaConsumerService } from '../../src/kafka/kafka.consumer.service';
import { KafkaProducerService } from '../../src/kafka/kafka.producer.service';
import {
  KAFKA_CLIENT,
  KAFKA_TOPICS,
  KAFKA_CONSUMER_GROUPS,
} from '../../src/config/constants';

// ─── helpers ────────────────────────────────────────────────────────────────

const PRODUCT_ID = 'product_001';
const USER_ID = 'user_sse_integration';
const ORDER_ID = 'order-uuid-sse-1';

const makeMessage = (topic: string, payload: object) => ({
  topic,
  message: { value: Buffer.from(JSON.stringify(payload)) },
});

// ─── suite ──────────────────────────────────────────────────────────────────

describe('SseService (integration)', () => {
  let app: INestApplication;
  let service: SseService;
  let mockConsume: jest.Mock;

  type KafkaHandler = (args: { topic: string; message: any }) => Promise<void>;
  let kafkaHandler: KafkaHandler;

  beforeAll(async () => {
    mockConsume = jest.fn().mockResolvedValue(undefined);

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), SseModule],
    })
      .overrideProvider(KAFKA_CLIENT)
      .useValue({
        connect: jest.fn().mockResolvedValue(undefined),
        close: jest.fn().mockResolvedValue(undefined),
      })
      .overrideProvider(KafkaProducerService)
      .useValue({ emit: jest.fn() })
      .overrideProvider(KafkaConsumerService)
      .useValue({ consume: mockConsume })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init(); // triggers onModuleInit — Kafka handler registered here

    service = moduleRef.get<SseService>(SseService);
    kafkaHandler = mockConsume.mock.calls[0][2] as KafkaHandler;
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    // Ensure no subscriber leaks between tests
    service.remove(USER_ID);
  });

  // ─── Consumer registration ────────────────────────────────────────────────

  describe('onModuleInit — consumer registration', () => {
    it('registers one consumer on the SSE group subscribed to PAYMENT_RESULT_SUCCESS and PAYMENT_RESULT_FAILED', () => {
      expect(mockConsume).toHaveBeenCalledWith(
        KAFKA_CONSUMER_GROUPS.SSE,
        [KAFKA_TOPICS.PAYMENT_RESULT_SUCCESS, KAFKA_TOPICS.PAYMENT_RESULT_FAILED],
        expect.any(Function),
      );
    });
  });

  // ─── Kafka → SSE delivery ─────────────────────────────────────────────────

  describe('Kafka → SSE event delivery', () => {
    it('delivers status=SUCCESS to the subscribed user when a PAYMENT_RESULT_SUCCESS message arrives', async () => {
      const observable = service.subscribe(USER_ID);
      const resultPromise = firstValueFrom(observable);

      await kafkaHandler(
        makeMessage(KAFKA_TOPICS.PAYMENT_RESULT_SUCCESS, {
          orderId: ORDER_ID,
          userId: USER_ID,
          productId: PRODUCT_ID,
        }),
      );

      const event = await resultPromise;
      expect((event as any).data).toEqual({ status: 'SUCCESS', orderId: ORDER_ID });
    });

    it('delivers status=FAILED to the subscribed user when a PAYMENT_RESULT_FAILED message arrives', async () => {
      const observable = service.subscribe(USER_ID);
      const resultPromise = firstValueFrom(observable);

      await kafkaHandler(
        makeMessage(KAFKA_TOPICS.PAYMENT_RESULT_FAILED, {
          orderId: ORDER_ID,
          userId: USER_ID,
          productId: PRODUCT_ID,
        }),
      );

      const event = await resultPromise;
      expect((event as any).data).toEqual({ status: 'FAILED', orderId: ORDER_ID });
    });

    it('does not deliver the event to a subscriber with a different userId — routing is per-user', async () => {
      const observable = service.subscribe(USER_ID);
      const received: any[] = [];
      observable.subscribe((e) => received.push(e));

      await kafkaHandler(
        makeMessage(KAFKA_TOPICS.PAYMENT_RESULT_SUCCESS, {
          orderId: ORDER_ID,
          userId: 'different_user',
          productId: PRODUCT_ID,
        }),
      );

      // Brief wait to confirm no spurious delivery arrives
      await new Promise((r) => setTimeout(r, 30));
      expect(received).toHaveLength(0);
    });

    it('silently discards a result event when the target userId has no active SSE subscriber — does not throw', async () => {
      await expect(
        kafkaHandler(
          makeMessage(KAFKA_TOPICS.PAYMENT_RESULT_SUCCESS, {
            orderId: ORDER_ID,
            userId: 'disconnected_user',
            productId: PRODUCT_ID,
          }),
        ),
      ).resolves.not.toThrow();
    });
  });

  // ─── subscribe / push / remove lifecycle ─────────────────────────────────

  describe('subscriber lifecycle', () => {
    it('the observable completes after remove — subscriber receives all prior events then the stream closes', async () => {
      const observable = service.subscribe(USER_ID);
      const received: any[] = [];

      const completedPromise = new Promise<void>((resolve) => {
        observable.subscribe({
          next: (e) => received.push(e),
          complete: () => resolve(),
        });
      });

      service.push(USER_ID, { data: { status: 'SUCCESS', orderId: ORDER_ID } } as any);
      service.remove(USER_ID);

      await completedPromise;
      expect(received).toHaveLength(1);
      expect((received[0] as any).data.orderId).toBe(ORDER_ID);
    });

    it('events pushed after remove are silently dropped — the subject is already completed', async () => {
      const observable = service.subscribe(USER_ID);
      const received: any[] = [];

      const completedPromise = new Promise<void>((resolve) => {
        observable.subscribe({
          next: (e) => received.push(e),
          complete: () => resolve(),
        });
      });

      service.remove(USER_ID);
      service.push(USER_ID, { data: { status: 'SUCCESS', orderId: ORDER_ID } } as any);

      await completedPromise;
      expect(received).toHaveLength(0);
    });
  });
});
