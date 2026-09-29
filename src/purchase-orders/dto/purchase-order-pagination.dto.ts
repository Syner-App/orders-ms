import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDto } from '../../common/index.ts';
import { StatusPurchaseOrder } from '../../generated/prisma/enums.ts';

export class PurchaseOrderPaginationDto extends PaginationDto {

  @IsEnum(StatusPurchaseOrder, {
    message: `Possible estado values are ${Object.values(StatusPurchaseOrder).join(', ')}`
  })
  @IsOptional()
  public estado?: StatusPurchaseOrder;
}
