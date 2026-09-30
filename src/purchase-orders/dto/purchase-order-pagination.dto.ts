import { IsEnum, IsMongoId, IsOptional } from 'class-validator';
import { PaginationDto } from '../../common/index.ts';
import { StatusPurchaseOrder } from '../../generated/prisma/enums.ts';

export class PurchaseOrderPaginationDto extends PaginationDto {
  // Organization of the authenticated caller, set by client-gateway from the verified token
  @IsMongoId()
  public organization_id: string;


  @IsEnum(StatusPurchaseOrder, {
    message: `Possible estado values are ${Object.values(StatusPurchaseOrder).join(', ')}`
  })
  @IsOptional()
  public estado?: StatusPurchaseOrder;
}
