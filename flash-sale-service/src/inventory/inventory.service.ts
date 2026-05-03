import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../product/product.entity';
import { InventoryRedisService } from '../redis/inventory.redis.service';
import { KafkaConsumerService } from '../kafka/kafka.consumer.service';
import { KafkaProducerService } from '../kafka/kafka.producer.service';
import {
  KAFKA_CONSUMER_GROUPS,
  KAFKA_TOPICS,
  OrderCreatedEvent,
  PaymentResultEvent,
} from '../config/constants';

@Injectable()
export class InventoryService implements OnModuleInit {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    private readonly redisService: InventoryRedisService,
    private readonly kafkaConsumer: KafkaConsumerService,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Independent consumer group — gets every ORDER_CREATED and PAYMENT_RESULT_FAILED
    // regardless of how Payment module consumes the same topics.
    await this.kafkaConsumer.consume(
      KAFKA_CONSUMER_GROUPS.INVENTORY,
      [KAFKA_TOPICS.ORDER_CREATED, KAFKA_TOPICS.PAYMENT_RESULT_FAILED],
      async ({ topic, message }) => {
        const event = JSON.parse(message.value!.toString());
        try {
          if (topic === KAFKA_TOPICS.ORDER_CREATED) {
            await this.decrementStock((event as OrderCreatedEvent).productId);
          } else {
            const { productId, userId } = event as PaymentResultEvent;
            await this.revertDBStock(productId, userId);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(
            `Inventory handler failed [${topic}] — routing to DLQ. ${msg}`,
          );
          this.kafkaProducer.emit(KAFKA_TOPICS.INVENTORY_DLQ, event);
        }
      },
    );

    // Reconciliation consumer — reads from INVENTORY_DLQ and re-applies the
    // failed stock decrement. Uses a separate group so it never interferes
    // with the main consumer offset.
    await this.kafkaConsumer.consume(
      KAFKA_CONSUMER_GROUPS.INVENTORY_DLQ,
      [KAFKA_TOPICS.INVENTORY_DLQ],
      async ({ message }) => {
        const event = JSON.parse(message.value!.toString()) as OrderCreatedEvent;
        this.logger.warn(
          `Reconciling inventory for order ${event.orderId} (product ${event.productId})`,
        );
        try {
          await this.decrementStock(event.productId);
          this.logger.log(`Reconciliation succeeded for order ${event.orderId}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(
            `Reconciliation failed for order ${event.orderId} — manual intervention required. ${msg}`,
          );
        }
      },
    );
  }

  async decrementStock(productId: string): Promise<void> {
    await this.productRepo.decrement({ id: productId }, 'stock', 1);
  }

  async revertDBStock(productId: string, userId: string): Promise<void> {
    await this.productRepo.increment({ id: productId }, 'stock', 1);
    // Re-sync Redis as a safety net in case PaymentService revert failed.
    await this.redisService.revertClaim(productId, userId);
  }
}
