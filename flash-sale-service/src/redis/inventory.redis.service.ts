import { Injectable, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_CLIENT, REDIS_KEYS } from '../config/constants';

// Atomic stock claim:
//   returns  1 = claimed successfully
//            0 = out of stock
//           -1 = user already purchased
const CLAIM_SCRIPT = `
local stock_key  = KEYS[1]
local buyers_key = KEYS[2]
local user_id    = ARGV[1]

if redis.call('SISMEMBER', buyers_key, user_id) == 1 then
  return -1
end

local stock = tonumber(redis.call('GET', stock_key))
if not stock or stock <= 0 then
  return 0
end

redis.call('DECR', stock_key)
redis.call('SADD', buyers_key, user_id)
return 1
`;

@Injectable()
export class InventoryRedisService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async claimStock(productId: string, userId: string): Promise<number> {
    return this.redis.eval(
      CLAIM_SCRIPT,
      2,
      REDIS_KEYS.stock(productId),
      REDIS_KEYS.buyers(productId),
      userId,
    ) as Promise<number>;
  }

  // Used to undo a claim — call on MySQL write failure OR payment failure.
  async revertClaim(productId: string, userId: string): Promise<void> {
    await this.redis.incr(REDIS_KEYS.stock(productId));
    await this.redis.srem(REDIS_KEYS.buyers(productId), userId);
  }

  async setStock(productId: string, stock: number): Promise<void> {
    await this.redis.set(REDIS_KEYS.stock(productId), stock);
  }
}
