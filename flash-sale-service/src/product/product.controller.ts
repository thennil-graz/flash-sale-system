import { Controller, Get, Patch, Param, Body } from '@nestjs/common';
import { ProductService } from './product.service';
import { Product } from './product.entity';
import { UpdateSaleScheduleDto } from './dto/update-sale-schedule.dto';
import { UpdateStockDto } from './dto/update-stock.dto';

@Controller('products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  // GET /products/:id
  @Get(':id')
  findOne(@Param('id') id: string): Promise<Product> {
    return this.productService.findOne(id);
  }

  // PATCH /products/:id/sale-schedule
  @Patch(':id/sale-schedule')
  updateSaleSchedule(
    @Param('id') id: string,
    @Body() dto: UpdateSaleScheduleDto,
  ): Promise<Product> {
    return this.productService.updateSaleSchedule(id, dto);
  }

  // PATCH /products/:id/stock
  @Patch(':id/stock')
  updateStock(
    @Param('id') id: string,
    @Body() dto: UpdateStockDto,
  ): Promise<Product> {
    return this.productService.updateStock(id, dto);
  }
}
