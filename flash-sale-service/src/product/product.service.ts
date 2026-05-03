import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from './product.entity';
import { UpdateSaleScheduleDto } from './dto/update-sale-schedule.dto';
import { UpdateStockDto } from './dto/update-stock.dto';
import { InventoryRedisService } from '../redis/inventory.redis.service';

@Injectable()
export class ProductService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    private readonly inventoryRedis: InventoryRedisService,
  ) {}

  async findOne(id: string): Promise<Product> {
    const product = await this.productRepo.findOne({ where: { id } });
    if (!product) throw new NotFoundException(`Product ${id} not found`);
    return product;
  }

  async updateSaleSchedule(
    id: string,
    dto: UpdateSaleScheduleDto,
  ): Promise<Product> {
    const product = await this.findOne(id);

    const incomingStart = dto.saleStartDate
      ? new Date(dto.saleStartDate)
      : null;
    const incomingEnd = dto.saleEndDate ? new Date(dto.saleEndDate) : null;

    // Resolve the effective start and end after the update
    const effectiveStart = incomingStart ?? product.saleStartDate;
    const effectiveEnd = incomingEnd ?? product.saleEndDate;

    if (effectiveStart && effectiveEnd && effectiveStart > effectiveEnd) {
      throw new BadRequestException(
        'Sale start date must not be after the sale end date',
      );
    }

    if (incomingStart) product.saleStartDate = incomingStart;
    if (incomingEnd) product.saleEndDate = incomingEnd;

    return this.productRepo.save(product);
  }

  async updateStock(id: string, dto: UpdateStockDto): Promise<Product> {
    const product = await this.findOne(id);
    product.stock = dto.stock;
    const saved = await this.productRepo.save(product);
    await this.inventoryRedis.setStock(id, dto.stock);
    return saved;
  }
}
