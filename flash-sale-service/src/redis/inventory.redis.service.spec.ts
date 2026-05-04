import { Test, TestingModule } from '@nestjs/testing';
import { InventoryRedisService } from './inventory.redis.service';
import { REDIS_CLIENT, REDIS_KEYS } from '../config/constants';

describe('InventoryRedisService', () => {
  let service: InventoryRedisService;
  let mockRedis: {
    eval: jest.Mock;
    incr: jest.Mock;
    srem: jest.Mock;
    set: jest.Mock;
  };

  beforeEach(async () => {
    mockRedis = {
      eval: jest.fn(),
      incr: jest.fn(),
      srem: jest.fn(),
      set: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryRedisService,
        { provide: REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();

    service = module.get<InventoryRedisService>(InventoryRedisService);
  });

  describe('claimStock', () => {
    const productId = 'product_001';
    const userId = 'user_1';

    it('passes the correct Lua script arguments for the given product and user', async () => {
      mockRedis.eval.mockResolvedValue(1);

      await service.claimStock(productId, userId);

      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.any(String),
        2,
        REDIS_KEYS.stock(productId),
        REDIS_KEYS.buyers(productId),
        userId,
      );
    });

    it('returns 1 when stock is available and the user is new', async () => {
      mockRedis.eval.mockResolvedValue(1);

      const result = await service.claimStock(productId, userId);

      expect(result).toBe(1);
    });

    it('returns 0 when stock is exhausted', async () => {
      mockRedis.eval.mockResolvedValue(0);

      const result = await service.claimStock(productId, userId);

      expect(result).toBe(0);
    });

    it('returns -1 when the user has already purchased', async () => {
      mockRedis.eval.mockResolvedValue(-1);

      const result = await service.claimStock(productId, userId);

      expect(result).toBe(-1);
    });

    it('uses the stock key pattern stock:{productId}', async () => {
      mockRedis.eval.mockResolvedValue(1);

      await service.claimStock('product_abc', userId);

      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.any(String),
        2,
        'stock:product_abc',
        expect.any(String),
        userId,
      );
    });

    it('uses the buyers key pattern product:{productId}:buyers', async () => {
      mockRedis.eval.mockResolvedValue(1);

      await service.claimStock('product_abc', userId);

      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.any(String),
        2,
        expect.any(String),
        'product:product_abc:buyers',
        userId,
      );
    });
  });

  describe('revertClaim', () => {
    const productId = 'product_001';
    const userId = 'user_1';

    it('issues a single atomic Lua eval — not two separate incr/srem calls — so INCR and SREM cannot be split by a concurrent claim', async () => {
      mockRedis.eval.mockResolvedValue(1);

      await service.revertClaim(productId, userId);

      expect(mockRedis.eval).toHaveBeenCalledTimes(1);
      expect(mockRedis.incr).not.toHaveBeenCalled();
      expect(mockRedis.srem).not.toHaveBeenCalled();
    });

    it('passes stock:{productId}, product:{productId}:buyers, and the userId as Lua KEYS and ARGV so the script targets the correct product and user', async () => {
      mockRedis.eval.mockResolvedValue(1);

      await service.revertClaim(productId, userId);

      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.any(String),
        2,
        REDIS_KEYS.stock(productId),
        REDIS_KEYS.buyers(productId),
        userId,
      );
    });

    it('the Lua script runs INCR before SREM so the user stays in the buyers set until stock is restored — a concurrent claim between the two would get -1 (already purchased) rather than consuming a freed slot', async () => {
      mockRedis.eval.mockResolvedValue(1);

      await service.revertClaim(productId, userId);

      const script = mockRedis.eval.mock.calls[0][0] as string;
      expect(script.indexOf('INCR')).toBeGreaterThan(-1);
      expect(script.indexOf('SREM')).toBeGreaterThan(-1);
      expect(script.indexOf('INCR')).toBeLessThan(script.indexOf('SREM'));
    });
  });

  describe('setStock', () => {
    it('sets the stock key with the given value', async () => {
      mockRedis.set.mockResolvedValue('OK');

      await service.setStock('product_001', 500);

      expect(mockRedis.set).toHaveBeenCalledWith(
        REDIS_KEYS.stock('product_001'),
        500,
      );
    });

    it('handles a stock value of 0', async () => {
      mockRedis.set.mockResolvedValue('OK');

      await service.setStock('product_001', 0);

      expect(mockRedis.set).toHaveBeenCalledWith('stock:product_001', 0);
    });

    it('handles large stock values (flash sale scale)', async () => {
      mockRedis.set.mockResolvedValue('OK');

      await service.setStock('product_001', 2_000_000);

      expect(mockRedis.set).toHaveBeenCalledWith('stock:product_001', 2_000_000);
    });
  });
});
