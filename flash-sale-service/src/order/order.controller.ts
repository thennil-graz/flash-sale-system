import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { OrderService } from './order.service';
import { CreateOrderDto, GetOrderQueryDto } from './order.dto';
import { Order } from './order.entity';

// TODO: protect POST and GET with @UseGuards(JwtAuthGuard) once auth is added.
//       Extract userId from the JWT token with a @GetUser() decorator instead
//       of accepting it as a client-supplied value.
@Controller('orders')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  // POST /orders
  @Post()
  create(@Body() dto: CreateOrderDto): Promise<Order> {
    return this.orderService.create(dto);
  }

  // GET /orders?productId=X&userId=Y
  // Returns the user's successful order, or null when no purchase exists.
  // Frontend uses null to decide whether to show the "purchase exceeded" state.
  @Get()
  findSuccessfulOrder(@Query() query: GetOrderQueryDto): Promise<Order | null> {
    return this.orderService.findSuccessfulOrder(query.productId, query.userId);
  }
}
