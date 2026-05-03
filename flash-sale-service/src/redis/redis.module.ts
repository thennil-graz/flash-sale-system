import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../config/constants';
import { InventoryRedisService } from './inventory.redis.service';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (config: ConfigService) =>
        new Redis({
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
        }),
      inject: [ConfigService],
    },
    InventoryRedisService,
  ],
  exports: [REDIS_CLIENT, InventoryRedisService],
})
export class RedisModule {}
