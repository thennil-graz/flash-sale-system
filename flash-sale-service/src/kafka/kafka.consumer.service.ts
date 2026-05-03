import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Consumer, EachMessagePayload, Kafka } from 'kafkajs';

@Injectable()
export class KafkaConsumerService implements OnModuleDestroy {
  private readonly kafka: Kafka;
  private readonly consumers: Consumer[] = [];

  constructor(private readonly config: ConfigService) {
    this.kafka = new Kafka({
      brokers: config
        .get<string>('KAFKA_BROKERS', 'localhost:29092')
        .split(','),
    });
  }

  async consume(
    groupId: string,
    topics: string[],
    handler: (payload: EachMessagePayload) => Promise<void>,
  ): Promise<void> {
    const consumer = this.kafka.consumer({ groupId });
    this.consumers.push(consumer);
    await consumer.connect();
    for (const topic of topics) {
      await consumer.subscribe({ topic, fromBeginning: false });
    }
    await consumer.run({ eachMessage: handler });
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.consumers.map((c) => c.disconnect()));
  }
}
