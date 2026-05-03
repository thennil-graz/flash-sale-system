import {
  Injectable,
  ConflictException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Order, OrderStatus } from './order.entity';
import { CreateOrderDto } from './order.dto';
import { InventoryRedisService } from '../redis/inventory.redis.service';
import { KafkaProducerService } from '../kafka/kafka.producer.service';
import { KAFKA_TOPICS } from '../config/constants';

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    private readonly redisService: InventoryRedisService,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

  async create(dto: CreateOrderDto): Promise<Order> {
    const { userId, productId } = dto;

    const claim = await this.redisService.claimStock(productId, userId);
    if (claim === 0) throw new ConflictException('Out of stock');
    if (claim === -1) throw new ConflictException('Already purchased');

    const order = this.orderRepo.create({
      id: uuidv4(),
      userId,
      productId,
      status: OrderStatus.PENDING,
      eventPublished: false,
    });

    try {
      await this.orderRepo.save(order);
    } catch(e) {
      console.log('ERROr!', e)
      await this.redisService.revertClaim(productId, userId);
      throw new InternalServerErrorException('Failed to persist order');
    }

    try {
      await this.kafkaProducer.emit(KAFKA_TOPICS.ORDER_CREATED, {
        orderId: order.id,
        userId,
        productId,
      });
      await this.orderRepo.update(order.id, { eventPublished: true });
      order.eventPublished = true;
    } catch {
      // Sweeper will retry on next cycle
    }

    return order;
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async retryUnpublishedOrders(): Promise<void> {
    const orders = await this.orderRepo.find({
      where: { status: OrderStatus.PENDING, eventPublished: false },
    });

    for (const order of orders) {
      try {
        await this.kafkaProducer.emit(KAFKA_TOPICS.ORDER_CREATED, {
          orderId: order.id,
          userId: order.userId,
          productId: order.productId,
        });
        await this.orderRepo.update(order.id, { eventPublished: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Sweeper failed to re-emit order ${order.id}: ${msg}`);
      }
    }
  }

  // Returns the user's successful order for a product, or null if none exists.
  // A FAILED order is treated as "not purchased" — null is returned so the
  // user can retry.
  async findSuccessfulOrder(
    productId: string,
    userId: string,
  ): Promise<Order | null> {
    return this.orderRepo.findOne({
      where: { productId, userId, status: OrderStatus.SUCCESS },
    });
  }

  async updateStatus(orderId: string, status: OrderStatus): Promise<void> {
    await this.orderRepo.update(orderId, { status });
  }
}
