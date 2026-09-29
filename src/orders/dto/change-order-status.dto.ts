import { IsEnum, IsUUID } from 'class-validator';
import { OrderStatus } from '../../generated/prisma/enums.ts';

export class ChangeOrderStatusDto {
  @IsUUID(4)
  public id: string;

  @IsEnum(OrderStatus, {
    message: `Possible status values are ${Object.values(OrderStatus).join(', ')}`
  })
  public status: OrderStatus;
}
