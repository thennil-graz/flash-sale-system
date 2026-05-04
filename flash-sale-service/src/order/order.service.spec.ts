import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { OrderService } from './order.service';
import { Order, OrderStatus } from './order.entity';
import { InventoryRedisService } from '../redis/inventory.redis.service';
import { KafkaProducerService } from '../kafka/kafka.producer.service';
import { ProductService } from '../product/product.service';
import { Product } from '../product/product.entity';
import { KAFKA_TOPICS } from '../config/constants';

const makeProduct = (overrides: Partial<Product> = {}): Product =>
  ({
    id: 'product_001',
    name: 'Flash Product',
    description: null,
    stock: 100,
    price: 99.99,
    saleStartDate: new Date(Date.now() - 3_600_000),
    saleEndDate: new Date(Date.now() + 3_600_000),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as Product;

const makeOrder = (overrides: Partial<Order> = {}): Order =>
  ({
    id: 'order-uuid-1',
    userId: 'user_1',
    productId: 'product_001',
    status: OrderStatus.PENDING,
    eventPublished: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as Order;

describe('OrderService', () => {
  let service: OrderService;
  let orderRepo: jest.Mocked<{
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
  }>;
  let redisService: jest.Mocked<InventoryRedisService>;
  let kafkaProducer: jest.Mocked<KafkaProducerService>;
  let productService: jest.Mocked<ProductService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderService,
        {
          provide: getRepositoryToken(Order),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            update: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
          },
        },
        {
          provide: InventoryRedisService,
          useValue: {
            claimStock: jest.fn(),
            revertClaim: jest.fn(),
          },
        },
        {
          provide: KafkaProducerService,
          useValue: { emit: jest.fn() },
        },
        {
          provide: ProductService,
          useValue: { findOne: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<OrderService>(OrderService);
    orderRepo = module.get(getRepositoryToken(Order));
    redisService = module.get(InventoryRedisService);
    kafkaProducer = module.get(KafkaProducerService);
    productService = module.get(ProductService);
  });

  describe('create', () => {
    const dto = { userId: 'user_1', productId: 'product_001' };

    describe('sale period validation', () => {
      it('throws BadRequestException when sale has not started yet', async () => {
        productService.findOne.mockResolvedValue(
          makeProduct({
            saleStartDate: new Date(Date.now() + 3_600_000),
            saleEndDate: new Date(Date.now() + 7_200_000),
          }),
        );

        await expect(service.create(dto)).rejects.toThrow(
          new BadRequestException('Sale has not started yet'),
        );

        expect(redisService.claimStock).not.toHaveBeenCalled();
      });

      it('throws BadRequestException when sale has ended', async () => {
        productService.findOne.mockResolvedValue(
          makeProduct({
            saleStartDate: new Date(Date.now() - 7_200_000),
            saleEndDate: new Date(Date.now() - 3_600_000),
          }),
        );

        await expect(service.create(dto)).rejects.toThrow(
          new BadRequestException('Sale has ended'),
        );

        expect(redisService.claimStock).not.toHaveBeenCalled();
      });

      it('proceeds when both sale dates are null (always open)', async () => {
        const savedOrder = makeOrder();
        productService.findOne.mockResolvedValue(
          makeProduct({ saleStartDate: null, saleEndDate: null }),
        );
        redisService.claimStock.mockResolvedValue(1);
        orderRepo.create.mockReturnValue(savedOrder);
        orderRepo.save.mockResolvedValue(savedOrder);
        kafkaProducer.emit.mockResolvedValue(undefined);
        orderRepo.update.mockResolvedValue({ affected: 1 });

        const result = await service.create(dto);

        expect(result).toBeDefined();
        expect(redisService.claimStock).toHaveBeenCalled();
      });

      it('proceeds when only saleStartDate is set and it has passed', async () => {
        const savedOrder = makeOrder();
        productService.findOne.mockResolvedValue(
          makeProduct({
            saleStartDate: new Date(Date.now() - 3_600_000),
            saleEndDate: null,
          }),
        );
        redisService.claimStock.mockResolvedValue(1);
        orderRepo.create.mockReturnValue(savedOrder);
        orderRepo.save.mockResolvedValue(savedOrder);
        kafkaProducer.emit.mockResolvedValue(undefined);
        orderRepo.update.mockResolvedValue({ affected: 1 });

        const result = await service.create(dto);

        expect(result).toBeDefined();
      });
    });

    describe('stock claim', () => {
      beforeEach(() => {
        productService.findOne.mockResolvedValue(makeProduct());
      });

      it('throws ConflictException("Out of stock") when claim returns 0', async () => {
        redisService.claimStock.mockResolvedValue(0);

        await expect(service.create(dto)).rejects.toThrow(
          new ConflictException('Out of stock'),
        );
      });

      it('throws ConflictException("Already purchased") when claim returns -1', async () => {
        redisService.claimStock.mockResolvedValue(-1);

        await expect(service.create(dto)).rejects.toThrow(
          new ConflictException('Already purchased'),
        );
      });
    });

    describe('happy path', () => {
      it('creates a PENDING order, publishes to Kafka, and returns order with eventPublished=true', async () => {
        const savedOrder = makeOrder();
        productService.findOne.mockResolvedValue(makeProduct());
        redisService.claimStock.mockResolvedValue(1);
        orderRepo.create.mockReturnValue(savedOrder);
        orderRepo.save.mockResolvedValue(savedOrder);
        kafkaProducer.emit.mockResolvedValue(undefined);
        orderRepo.update.mockResolvedValue({ affected: 1 });

        const result = await service.create(dto);

        expect(result.status).toBe(OrderStatus.PENDING);
        expect(result.eventPublished).toBe(true);
        expect(kafkaProducer.emit).toHaveBeenCalledWith(
          KAFKA_TOPICS.ORDER_CREATED,
          {
            orderId: savedOrder.id,
            userId: dto.userId,
            productId: dto.productId,
          },
        );
      });

      it('creates the order with the correct userId and productId', async () => {
        const savedOrder = makeOrder();
        productService.findOne.mockResolvedValue(makeProduct());
        redisService.claimStock.mockResolvedValue(1);
        orderRepo.create.mockReturnValue(savedOrder);
        orderRepo.save.mockResolvedValue(savedOrder);
        kafkaProducer.emit.mockResolvedValue(undefined);
        orderRepo.update.mockResolvedValue({ affected: 1 });

        await service.create(dto);

        expect(orderRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: dto.userId,
            productId: dto.productId,
            status: OrderStatus.PENDING,
            eventPublished: false,
          }),
        );
      });
    });

    describe('MySQL failure', () => {
      it('reverts the Redis claim and throws InternalServerErrorException when save fails', async () => {
        const savedOrder = makeOrder();
        productService.findOne.mockResolvedValue(makeProduct());
        redisService.claimStock.mockResolvedValue(1);
        orderRepo.create.mockReturnValue(savedOrder);
        orderRepo.save.mockRejectedValue(new Error('DB connection lost'));

        await expect(service.create(dto)).rejects.toThrow(
          InternalServerErrorException,
        );

        expect(redisService.revertClaim).toHaveBeenCalledWith(
          dto.productId,
          dto.userId,
        );
      });

      it('does not publish to Kafka when MySQL save fails', async () => {
        const savedOrder = makeOrder();
        productService.findOne.mockResolvedValue(makeProduct());
        redisService.claimStock.mockResolvedValue(1);
        orderRepo.create.mockReturnValue(savedOrder);
        orderRepo.save.mockRejectedValue(new Error('DB error'));

        await expect(service.create(dto)).rejects.toThrow();

        expect(kafkaProducer.emit).not.toHaveBeenCalled();
      });
    });

    describe('Kafka failure', () => {
      it('returns order with eventPublished=false and does not throw when Kafka emit fails', async () => {
        const savedOrder = makeOrder();
        productService.findOne.mockResolvedValue(makeProduct());
        redisService.claimStock.mockResolvedValue(1);
        orderRepo.create.mockReturnValue(savedOrder);
        orderRepo.save.mockResolvedValue(savedOrder);
        kafkaProducer.emit.mockRejectedValue(new Error('Kafka broker down'));

        const result = await service.create(dto);

        expect(result.eventPublished).toBe(false);
      });

      it('does not revert Redis claim when only Kafka fails', async () => {
        const savedOrder = makeOrder();
        productService.findOne.mockResolvedValue(makeProduct());
        redisService.claimStock.mockResolvedValue(1);
        orderRepo.create.mockReturnValue(savedOrder);
        orderRepo.save.mockResolvedValue(savedOrder);
        kafkaProducer.emit.mockRejectedValue(new Error('Kafka broker down'));

        await service.create(dto);

        expect(redisService.revertClaim).not.toHaveBeenCalled();
      });
    });
  });

  describe('retryUnpublishedOrders', () => {
    it('does nothing when there are no unpublished pending orders', async () => {
      orderRepo.find.mockResolvedValue([]);

      await service.retryUnpublishedOrders();

      expect(kafkaProducer.emit).not.toHaveBeenCalled();
      expect(orderRepo.update).not.toHaveBeenCalled();
    });

    it('re-emits each order and marks eventPublished=true on success', async () => {
      const order = makeOrder({ id: 'order-1', eventPublished: false });
      orderRepo.find.mockResolvedValue([order]);
      kafkaProducer.emit.mockResolvedValue(undefined);
      orderRepo.update.mockResolvedValue({ affected: 1 });

      await service.retryUnpublishedOrders();

      expect(kafkaProducer.emit).toHaveBeenCalledWith(KAFKA_TOPICS.ORDER_CREATED, {
        orderId: order.id,
        userId: order.userId,
        productId: order.productId,
      });
      expect(orderRepo.update).toHaveBeenCalledWith(order.id, {
        eventPublished: true,
      });
    });

    it('continues processing remaining orders when one Kafka emit fails', async () => {
      const order1 = makeOrder({ id: 'order-1', userId: 'user_1' });
      const order2 = makeOrder({ id: 'order-2', userId: 'user_2' });
      orderRepo.find.mockResolvedValue([order1, order2]);
      kafkaProducer.emit
        .mockRejectedValueOnce(new Error('Kafka down'))
        .mockResolvedValueOnce(undefined);
      orderRepo.update.mockResolvedValue({ affected: 1 });

      await service.retryUnpublishedOrders();

      expect(kafkaProducer.emit).toHaveBeenCalledTimes(2);
      expect(orderRepo.update).toHaveBeenCalledTimes(1);
      expect(orderRepo.update).toHaveBeenCalledWith('order-2', {
        eventPublished: true,
      });
    });

    it('queries only PENDING orders where eventPublished is false', async () => {
      orderRepo.find.mockResolvedValue([]);

      await service.retryUnpublishedOrders();

      expect(orderRepo.find).toHaveBeenCalledWith({
        where: { status: OrderStatus.PENDING, eventPublished: false },
      });
    });
  });

  describe('findSuccessfulOrder', () => {
    it('returns the order when a successful purchase exists for the user and product', async () => {
      const order = makeOrder({ status: OrderStatus.SUCCESS });
      orderRepo.findOne.mockResolvedValue(order);

      const result = await service.findSuccessfulOrder('product_001', 'user_1');

      expect(result).toEqual(order);
      expect(orderRepo.findOne).toHaveBeenCalledWith({
        where: {
          productId: 'product_001',
          userId: 'user_1',
          status: OrderStatus.SUCCESS,
        },
      });
    });

    it('returns null when the user has no successful order for this product', async () => {
      orderRepo.findOne.mockResolvedValue(null);

      const result = await service.findSuccessfulOrder('product_001', 'user_1');

      expect(result).toBeNull();
    });

    it('returns null for PENDING orders (not treated as a completed purchase)', async () => {
      orderRepo.findOne.mockResolvedValue(null);

      const result = await service.findSuccessfulOrder('product_001', 'user_1');

      expect(result).toBeNull();
    });

    it('returns null for FAILED orders (user may retry)', async () => {
      orderRepo.findOne.mockResolvedValue(null);

      const result = await service.findSuccessfulOrder('product_001', 'user_1');

      expect(result).toBeNull();
    });
  });

  describe('updateStatus', () => {
    it('calls repo.update with the correct orderId and status', async () => {
      orderRepo.update.mockResolvedValue({ affected: 1 });

      await service.updateStatus('order-1', OrderStatus.SUCCESS);

      expect(orderRepo.update).toHaveBeenCalledWith('order-1', {
        status: OrderStatus.SUCCESS,
      });
    });

    it('updates to FAILED status correctly', async () => {
      orderRepo.update.mockResolvedValue({ affected: 1 });

      await service.updateStatus('order-2', OrderStatus.FAILED);

      expect(orderRepo.update).toHaveBeenCalledWith('order-2', {
        status: OrderStatus.FAILED,
      });
    });
  });
});
