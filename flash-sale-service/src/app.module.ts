import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { Product } from './product/product.entity';
import { Order } from './order/order.entity';
import { ProductModule } from './product/product.module';
import { OrderModule } from './order/order.module';
import { InventoryModule } from './inventory/inventory.module';
import { PaymentModule } from './payment/payment.module';
import { SseModule } from './sse/sse.module';
import { RedisModule } from './redis/redis.module';
import { KafkaModule } from './kafka/kafka.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    TypeOrmModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        type: 'mysql',
        host: config.get<string>('MYSQL_HOST', 'localhost'),
        port: config.get<number>('MYSQL_PORT', 3306),
        username: config.get<string>('MYSQL_USER', 'appuser'),
        password: config.get<string>('MYSQL_PASSWORD', 'apppassword'),
        database: config.get<string>('MYSQL_DATABASE', 'flashsale'),
        entities: [Product, Order],
        synchronize: false, // schema managed by db-init.sql
        timezone: 'Z',
      }),
      inject: [ConfigService],
    }),

    ScheduleModule.forRoot(),
    ProductModule,
    OrderModule,
    InventoryModule,
    PaymentModule,
    SseModule,
    RedisModule,
    KafkaModule,
  ],
})
export class AppModule {}
