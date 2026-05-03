import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from '../product/product.entity';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { RedisModule } from '../redis/redis.module';
import { KafkaModule } from '../kafka/kafka.module';

@Module({
  imports: [TypeOrmModule.forFeature([Product]), RedisModule, KafkaModule],
  controllers: [InventoryController],
  providers: [InventoryService],
})
export class InventoryModule {}
