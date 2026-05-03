import { Injectable, MessageEvent, OnModuleInit } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { KafkaConsumerService } from '../kafka/kafka.consumer.service';
import {
  KAFKA_CONSUMER_GROUPS,
  KAFKA_TOPICS,
  PaymentResultEvent,
} from '../config/constants';

@Injectable()
export class SseService implements OnModuleInit {
  private readonly subjects = new Map<string, Subject<MessageEvent>>();

  constructor(private readonly kafkaConsumer: KafkaConsumerService) {}

  async onModuleInit(): Promise<void> {
    // Independent consumer group — scales separately from Inventory and Payment.
    await this.kafkaConsumer.consume(
      KAFKA_CONSUMER_GROUPS.SSE,
      [KAFKA_TOPICS.PAYMENT_RESULT_SUCCESS, KAFKA_TOPICS.PAYMENT_RESULT_FAILED],
      async ({ topic, message }) => {
        const event = JSON.parse(
          message.value!.toString(),
        ) as PaymentResultEvent;
        const status =
          topic === KAFKA_TOPICS.PAYMENT_RESULT_SUCCESS ? 'SUCCESS' : 'FAILED';
        this.push(event.userId, {
          data: { status, orderId: event.orderId },
        });
      },
    );
  }

  subscribe(userId: string): Observable<MessageEvent> {
    const subject = new Subject<MessageEvent>();
    this.subjects.set(userId, subject);
    return subject.asObservable();
  }

  push(userId: string, event: MessageEvent): void {
    this.subjects.get(userId)?.next(event);
  }

  remove(userId: string): void {
    const subject = this.subjects.get(userId);
    if (subject) {
      subject.complete();
      this.subjects.delete(userId);
    }
  }
}
