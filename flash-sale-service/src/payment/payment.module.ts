import { Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { PaymentGatewayService } from './payment.gateway.service';
import { OrderModule } from '../order/order.module';
import { KafkaModule } from '../kafka/kafka.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [OrderModule, KafkaModule, RedisModule],
  controllers: [PaymentController],
  providers: [PaymentService, PaymentGatewayService],
})
export class PaymentModule {}
