import { IsIn, IsNotEmpty, IsString, IsUUID, ValidateIf } from 'class-validator';
import { StatusPurchaseOrder } from '../../generated/prisma/enums.ts';

// EN_VALIDACION and PENDIENTE are set by the purchase order saga only
export const UPDATABLE_PURCHASE_ORDER_STATUSES = [
  StatusPurchaseOrder.APROBADA,
  StatusPurchaseOrder.RECHAZADA,
  StatusPurchaseOrder.RECIBIDA,
] as const;

export type UpdatablePurchaseOrderStatus = (typeof UPDATABLE_PURCHASE_ORDER_STATUSES)[number];

export class UpdatePurchaseOrderStatusDto {
  @IsUUID(4)
  public id: string;

  @IsIn(UPDATABLE_PURCHASE_ORDER_STATUSES, {
    message: `Possible estado values are ${UPDATABLE_PURCHASE_ORDER_STATUSES.join(', ')}`,
  })
  public estado: UpdatablePurchaseOrderStatus;

  // Required when rejecting, optional otherwise
  @ValidateIf((dto: UpdatePurchaseOrderStatusDto) => dto.estado === StatusPurchaseOrder.RECHAZADA || dto.motivo !== undefined)
  @IsString()
  @IsNotEmpty({ message: 'motivo is required when estado is RECHAZADA' })
  public motivo?: string;
}
