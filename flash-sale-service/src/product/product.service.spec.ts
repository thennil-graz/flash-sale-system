import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ProductService } from './product.service';
import { Product } from './product.entity';
import { InventoryRedisService } from '../redis/inventory.redis.service';

const makeProduct = (overrides: Partial<Product> = {}): Product =>
  ({
    id: 'product_001',
    name: 'Test Product',
    description: null,
    stock: 100,
    price: 99.99,
    saleStartDate: null,
    saleEndDate: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }) as Product;

describe('ProductService', () => {
  let service: ProductService;
  let mockProductRepo: { findOne: jest.Mock; save: jest.Mock };
  let mockRedis: { setStock: jest.Mock };

  beforeEach(async () => {
    mockProductRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
    };
    mockRedis = {
      setStock: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductService,
        { provide: getRepositoryToken(Product), useValue: mockProductRepo },
        { provide: InventoryRedisService, useValue: mockRedis },
      ],
    }).compile();

    service = module.get<ProductService>(ProductService);
  });

  // ─── findOne ──────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('returns the product when it exists in the database', async () => {
      const product = makeProduct();
      mockProductRepo.findOne.mockResolvedValue(product);

      const result = await service.findOne('product_001');

      expect(result).toEqual(product);
    });

    it('throws NotFoundException when no product matches the given id', async () => {
      mockProductRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('includes the product id in the NotFoundException message so callers can identify what was missing', async () => {
      mockProductRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('product_xyz')).rejects.toThrow('product_xyz');
    });
  });

  // ─── updateSaleSchedule ───────────────────────────────────────────────────

  describe('updateSaleSchedule', () => {
    it('persists and returns the product with the new saleStartDate when only start is provided', async () => {
      const product = makeProduct();
      mockProductRepo.findOne.mockResolvedValue(product);
      mockProductRepo.save.mockImplementation(async (p) => p);

      const result = await service.updateSaleSchedule('product_001', {
        saleStartDate: '2026-06-01T00:00:00.000Z',
      });

      expect(result.saleStartDate).toEqual(new Date('2026-06-01T00:00:00.000Z'));
    });

    it('persists and returns the product with the new saleEndDate when only end is provided', async () => {
      const product = makeProduct({ saleStartDate: new Date('2026-06-01T00:00:00.000Z') });
      mockProductRepo.findOne.mockResolvedValue(product);
      mockProductRepo.save.mockImplementation(async (p) => p);

      const result = await service.updateSaleSchedule('product_001', {
        saleEndDate: '2026-06-02T00:00:00.000Z',
      });

      expect(result.saleEndDate).toEqual(new Date('2026-06-02T00:00:00.000Z'));
    });

    it('throws BadRequestException when the provided start date is after the provided end date', async () => {
      mockProductRepo.findOne.mockResolvedValue(makeProduct());

      await expect(
        service.updateSaleSchedule('product_001', {
          saleStartDate: '2026-06-10T00:00:00.000Z',
          saleEndDate: '2026-06-01T00:00:00.000Z',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when the new start date is after the already-saved end date', async () => {
      const product = makeProduct({ saleEndDate: new Date('2026-06-01T00:00:00.000Z') });
      mockProductRepo.findOne.mockResolvedValue(product);

      await expect(
        service.updateSaleSchedule('product_001', {
          saleStartDate: '2026-06-10T00:00:00.000Z',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when the new end date is before the already-saved start date', async () => {
      const product = makeProduct({ saleStartDate: new Date('2026-06-10T00:00:00.000Z') });
      mockProductRepo.findOne.mockResolvedValue(product);

      await expect(
        service.updateSaleSchedule('product_001', {
          saleEndDate: '2026-06-01T00:00:00.000Z',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts equal start and end date — a single-instant sale window is valid', async () => {
      mockProductRepo.findOne.mockResolvedValue(makeProduct());
      mockProductRepo.save.mockImplementation(async (p) => p);

      const isoDate = '2026-06-01T00:00:00.000Z';

      await expect(
        service.updateSaleSchedule('product_001', {
          saleStartDate: isoDate,
          saleEndDate: isoDate,
        }),
      ).resolves.not.toThrow();
    });

    it('throws NotFoundException before applying any changes when the product does not exist', async () => {
      mockProductRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updateSaleSchedule('nonexistent', {
          saleStartDate: '2026-06-01T00:00:00.000Z',
        }),
      ).rejects.toThrow(NotFoundException);

      expect(mockProductRepo.save).not.toHaveBeenCalled();
    });
  });

  // ─── updateStock ──────────────────────────────────────────────────────────

  describe('updateStock', () => {
    it('saves the new stock value to MySQL and returns the updated product', async () => {
      const product = makeProduct({ stock: 100 });
      mockProductRepo.findOne.mockResolvedValue(product);
      mockProductRepo.save.mockImplementation(async (p) => p);

      const result = await service.updateStock('product_001', { stock: 500 });

      expect(result.stock).toBe(500);
      expect(mockProductRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ stock: 500 }),
      );
    });

    it('syncs the new stock value to Redis after MySQL is updated so both sources of truth stay consistent', async () => {
      const product = makeProduct({ stock: 100 });
      mockProductRepo.findOne.mockResolvedValue(product);
      mockProductRepo.save.mockImplementation(async (p) => p);

      await service.updateStock('product_001', { stock: 500 });

      expect(mockRedis.setStock).toHaveBeenCalledWith('product_001', 500);
    });

    it('updates MySQL before Redis — if Redis setStock throws, MySQL is already committed and the error propagates', async () => {
      const callOrder: string[] = [];
      const product = makeProduct();
      mockProductRepo.findOne.mockResolvedValue(product);
      mockProductRepo.save.mockImplementation(async (p) => {
        callOrder.push('mysql');
        return p;
      });
      mockRedis.setStock.mockImplementation(async () => {
        callOrder.push('redis');
      });

      await service.updateStock('product_001', { stock: 250 });

      expect(callOrder).toEqual(['mysql', 'redis']);
    });

    it('does not call setStock when MySQL save fails — Redis is never updated so it stays in sync with the DB', async () => {
      const product = makeProduct();
      mockProductRepo.findOne.mockResolvedValue(product);
      mockProductRepo.save.mockRejectedValue(new Error('DB write failed'));

      await expect(service.updateStock('product_001', { stock: 500 })).rejects.toThrow();

      expect(mockRedis.setStock).not.toHaveBeenCalled();
    });

    it('handles stock set to 0 — closes the sale by zeroing both MySQL and Redis', async () => {
      const product = makeProduct({ stock: 100 });
      mockProductRepo.findOne.mockResolvedValue(product);
      mockProductRepo.save.mockImplementation(async (p) => p);

      const result = await service.updateStock('product_001', { stock: 0 });

      expect(result.stock).toBe(0);
      expect(mockRedis.setStock).toHaveBeenCalledWith('product_001', 0);
    });

    it('handles large flash-sale stock values (2 000 000 units) without truncation', async () => {
      const product = makeProduct();
      mockProductRepo.findOne.mockResolvedValue(product);
      mockProductRepo.save.mockImplementation(async (p) => p);

      await service.updateStock('product_001', { stock: 2_000_000 });

      expect(mockRedis.setStock).toHaveBeenCalledWith('product_001', 2_000_000);
    });

    it('throws NotFoundException before touching MySQL or Redis when the product does not exist', async () => {
      mockProductRepo.findOne.mockResolvedValue(null);

      await expect(service.updateStock('nonexistent', { stock: 100 })).rejects.toThrow(
        NotFoundException,
      );

      expect(mockProductRepo.save).not.toHaveBeenCalled();
      expect(mockRedis.setStock).not.toHaveBeenCalled();
    });
  });
});
