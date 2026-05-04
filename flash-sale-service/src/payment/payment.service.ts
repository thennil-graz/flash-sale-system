import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OrderService } from '../order/order.service';
import { OrderStatus } from '../order/order.entity';
import { KafkaProducerService } from '../kafka/kafka.producer.service';
import { KafkaConsumerService } from '../kafka/kafka.consumer.service';
import { InventoryRedisService } from '../redis/inventory.redis.service';
import { PaymentGatewayService } from './payment.gateway.service';
import {
  KAFKA_CONSUMER_GROUPS,
  KAFKA_TOPICS,
  OrderCreatedEvent,
} from '../config/constants';

@Injectable()
export class PaymentService implements OnModuleInit {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly orderService: OrderService,
    private readonly kafkaProducer: KafkaProducerService,
    private readonly kafkaConsumer: KafkaConsumerService,
    private readonly redisService: InventoryRedisService,
    private readonly paymentGateway: PaymentGatewayService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Independent consumer group — gets every ORDER_CREATED in parallel
    // with the Inventory consumer. Neither blocks nor waits for the other.
    await this.kafkaConsumer.consume(
      KAFKA_CONSUMER_GROUPS.PAYMENT,
      [KAFKA_TOPICS.ORDER_CREATED],
      async ({ message }) => {
        const event = JSON.parse(message.value!.toString()) as OrderCreatedEvent;
        try {
          await this.processPayment(event);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(
            `Payment handler failed for order ${event.orderId} — routing to DLQ. ${msg}`,
          );
          this.kafkaProducer.emit(KAFKA_TOPICS.PAYMENT_DLQ, event as unknown as Record<string, unknown>);
        }
      },
    );
  }

  async processPayment(event: OrderCreatedEvent): Promise<void> {
    const { orderId, userId, productId } = event;
    const success = await this.paymentGateway.charge(userId);

    this.logger.log(`Payment processed: orderId=${orderId} success=${success}`);
    if (success) {
      await this.orderService.updateStatus(orderId, OrderStatus.SUCCESS);
      this.kafkaProducer.emit(KAFKA_TOPICS.PAYMENT_RESULT_SUCCESS, {
        orderId,
        userId,
        productId,
      });
    } else {
      await this.orderService.updateStatus(orderId, OrderStatus.FAILED);
      await this.redisService.revertClaim(productId, userId);
      this.kafkaProducer.emit(KAFKA_TOPICS.PAYMENT_RESULT_FAILED, {
        orderId,
        userId,
        productId,
      });
    }
  }

}
