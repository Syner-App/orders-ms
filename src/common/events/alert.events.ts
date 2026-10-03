import { Type } from 'class-transformer';
import { IsDefined, IsInt, IsMongoId, IsNotEmpty, IsPositive, IsString, IsUUID, Min, ValidateNested } from 'class-validator';

// Stock alert contract. Keep in sync with products-ms/src/common/events/alert.events.ts.
// products-ms publishes alert.created after committing a new alert; orders-ms opens a
// purchase order for low stock alerts (see PurchaseOrdersService.createFromLowStockAlert)
export const AlertEvents = {
  Created: 'alert.created',
} as const;

export const LOW_STOCK_ALERT = 'STOCK_BAJO';

export class AlertCreatedAlert {
  @IsUUID()
  id: string;

  @IsInt()
  @IsPositive()
  product_id: number;

  @IsString()
  @IsNotEmpty()
  tipo: string;

  @IsString()
  @IsNotEmpty()
  descripcion: string;
}

export class AlertCreatedProduct {
  @IsString()
  @IsNotEmpty()
  proveedor: string;

  @IsInt()
  @Min(0)
  stock_minimo: number;
}

export class AlertCreatedEvent {
  @IsMongoId()
  organization_id: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => AlertCreatedAlert)
  alert: AlertCreatedAlert;

  @IsDefined()
  @ValidateNested()
  @Type(() => AlertCreatedProduct)
  product: AlertCreatedProduct;
}
