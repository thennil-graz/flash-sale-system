import { IsDateString, IsOptional } from 'class-validator';

export class UpdateSaleScheduleDto {
  @IsOptional()
  @IsDateString()
  saleStartDate?: string;

  @IsOptional()
  @IsDateString()
  saleEndDate?: string;
}
