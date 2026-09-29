import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDto } from '../../common/index.ts';
import { OrderStatus } from '../../generated/prisma/enums.ts';

export class OrderPaginationDto extends PaginationDto {

  @IsEnum(OrderStatus, {
    message: `Possible status values are ${Object.values(OrderStatus).join(', ')}`
  })
  @IsOptional()
  public status?: OrderStatus;
}
