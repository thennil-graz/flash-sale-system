import { Test, TestingModule } from '@nestjs/testing';
import { firstValueFrom } from 'rxjs';
import { SseService } from './sse.service';
import { KafkaConsumerService } from '../kafka/kafka.consumer.service';
import { KAFKA_TOPICS, KAFKA_CONSUMER_GROUPS } from '../config/constants';

describe('SseService', () => {
  let service: SseService;
  let mockConsume: jest.Mock;

  type KafkaHandler = (args: { topic: string; message: any }) => Promise<void>;
  let kafkaHandler: KafkaHandler;

  const makeMessage = (topic: string, payload: object) => ({
    topic,
    message: { value: Buffer.from(JSON.stringify(payload)) },
  });

  beforeEach(async () => {
    mockConsume = jest.fn().mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SseService,
        { provide: KafkaConsumerService, useValue: { consume: mockConsume } },
      ],
    }).compile();

    service = module.get<SseService>(SseService);
    await service.onModuleInit();

    kafkaHandler = mockConsume.mock.calls[0][2] as KafkaHandler;
  });

  // ─── onModuleInit ─────────────────────────────────────────────────────────

  describe('onModuleInit', () => {
    it('registers exactly one consumer on the SSE consumer group listening to both PAYMENT_RESULT topics', () => {
      expect(mockConsume).toHaveBeenCalledTimes(1);
      expect(mockConsume).toHaveBeenCalledWith(
        KAFKA_CONSUMER_GROUPS.SSE,
        [KAFKA_TOPICS.PAYMENT_RESULT_SUCCESS, KAFKA_TOPICS.PAYMENT_RESULT_FAILED],
        expect.any(Function),
      );
    });
  });

  // ─── subscribe ────────────────────────────────────────────────────────────

  describe('subscribe', () => {
    it('returns an observable that emits events pushed for that userId', async () => {
      const observable = service.subscribe('user_1');
      const event = { data: { status: 'SUCCESS', orderId: 'order_1' } };

      const resultPromise = firstValueFrom(observable);
      service.push('user_1', event as any);

      expect(await resultPromise).toEqual(event);
    });

    it('calling subscribe twice for the same userId overwrites the previous subject — the second call is authoritative', async () => {
      service.subscribe('user_1');
      const second = service.subscribe('user_1');

      const resultPromise = firstValueFrom(second);
      service.push('user_1', { data: { status: 'SUCCESS', orderId: 'order_2' } } as any);

      const result = await resultPromise;
      expect((result as any).data.orderId).toBe('order_2');
    });
  });

  // ─── push ─────────────────────────────────────────────────────────────────

  describe('push', () => {
    it('delivers the event only to the matching userId — other subscribers receive nothing', async () => {
      const obs1 = service.subscribe('user_1');
      const obs2 = service.subscribe('user_2');

      const result1Promise = firstValueFrom(obs1);
      const result2Promise = firstValueFrom(obs2);

      service.push('user_1', { data: { status: 'SUCCESS', orderId: 'order_1' } } as any);
      service.push('user_2', { data: { status: 'FAILED', orderId: 'order_2' } } as any);

      expect(await result1Promise).toMatchObject({ data: { orderId: 'order_1' } });
      expect(await result2Promise).toMatchObject({ data: { orderId: 'order_2' } });
    });

    it('does not throw when pushing to a userId that has no active subscriber — the push is silently dropped', () => {
      expect(() =>
        service.push('nonexistent_user', { data: { status: 'SUCCESS', orderId: 'order_1' } } as any),
      ).not.toThrow();
    });
  });

  // ─── remove ───────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('completes the observable so the subscriber receives all events pushed before remove and then the stream closes', async () => {
      const observable = service.subscribe('user_1');
      const received: any[] = [];

      const completedPromise = new Promise<void>((resolve) => {
        observable.subscribe({
          next: (e) => received.push(e),
          complete: () => resolve(),
        });
      });

      service.push('user_1', { data: { status: 'SUCCESS', orderId: 'order_1' } } as any);
      service.remove('user_1');

      await completedPromise;
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({ data: { orderId: 'order_1' } });
    });

    it('drops any events pushed after remove is called — the subject is already completed', async () => {
      const observable = service.subscribe('user_1');
      const received: any[] = [];

      const completedPromise = new Promise<void>((resolve) => {
        observable.subscribe({
          next: (e) => received.push(e),
          complete: () => resolve(),
        });
      });

      service.remove('user_1');
      service.push('user_1', { data: { status: 'SUCCESS', orderId: 'order_1' } } as any);

      await completedPromise;
      expect(received).toHaveLength(0);
    });

    it('is a no-op for an unknown userId — does not throw when the userId was never subscribed', () => {
      expect(() => service.remove('nonexistent_user')).not.toThrow();
    });

    it('cleans up the internal subjects map — a push after remove is silently ignored rather than erroring', () => {
      service.subscribe('user_1');
      service.remove('user_1');

      expect(() =>
        service.push('user_1', { data: { status: 'SUCCESS', orderId: 'order_1' } } as any),
      ).not.toThrow();
    });
  });

  // ─── Kafka handler ────────────────────────────────────────────────────────

  describe('Kafka handler — PAYMENT_RESULT routing', () => {
    it('pushes data.status=SUCCESS when the incoming Kafka topic is PAYMENT_RESULT_SUCCESS', async () => {
      const observable = service.subscribe('user_1');
      const resultPromise = firstValueFrom(observable);

      await kafkaHandler(
        makeMessage(KAFKA_TOPICS.PAYMENT_RESULT_SUCCESS, {
          orderId: 'order_1',
          userId: 'user_1',
          productId: 'product_001',
        }),
      );

      const event = await resultPromise;
      expect((event as any).data).toEqual({ status: 'SUCCESS', orderId: 'order_1' });
    });

    it('pushes data.status=FAILED when the incoming Kafka topic is PAYMENT_RESULT_FAILED', async () => {
      const observable = service.subscribe('user_1');
      const resultPromise = firstValueFrom(observable);

      await kafkaHandler(
        makeMessage(KAFKA_TOPICS.PAYMENT_RESULT_FAILED, {
          orderId: 'order_2',
          userId: 'user_1',
          productId: 'product_001',
        }),
      );

      const event = await resultPromise;
      expect((event as any).data).toEqual({ status: 'FAILED', orderId: 'order_2' });
    });

    it('routes each event to the correct subscriber — user_1 does not receive user_2\'s payment result', async () => {
      const obs1 = service.subscribe('user_1');
      service.subscribe('user_2');

      const received: any[] = [];
      obs1.subscribe((e) => received.push(e));

      await kafkaHandler(
        makeMessage(KAFKA_TOPICS.PAYMENT_RESULT_SUCCESS, {
          orderId: 'order_1',
          userId: 'user_1',
          productId: 'product_001',
        }),
      );
      await kafkaHandler(
        makeMessage(KAFKA_TOPICS.PAYMENT_RESULT_SUCCESS, {
          orderId: 'order_2',
          userId: 'user_2',
          productId: 'product_001',
        }),
      );

      await new Promise((r) => setTimeout(r, 20));

      expect(received).toHaveLength(1);
      expect(received[0].data.orderId).toBe('order_1');
    });

    it('does not throw when a PAYMENT_RESULT arrives for a userId that has no active SSE subscriber', async () => {
      await expect(
        kafkaHandler(
          makeMessage(KAFKA_TOPICS.PAYMENT_RESULT_SUCCESS, {
            orderId: 'order_1',
            userId: 'disconnected_user',
            productId: 'product_001',
          }),
        ),
      ).resolves.not.toThrow();
    });
  });
});
