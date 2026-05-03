import { IsNotEmpty, IsString } from 'class-validator';

export class CreateOrderDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsNotEmpty()
  productId: string;
}

// TODO: once auth is added, remove userId from here and extract it from the
//       JWT token via a @GetUser() decorator (e.g. @UseGuards(JwtAuthGuard)).
export class GetOrderQueryDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  @IsString()
  @IsNotEmpty()
  userId: string;
}
