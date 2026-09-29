import { IsInt, IsNotEmpty, IsPositive, IsString, IsUUID } from 'class-validator';

// Purchase order saga contract. Keep in sync with products-ms/src/common/events/purchase-order.events.ts
export const PurchaseOrderEvents = {
  Created: 'purchase-order.created',
  ProductValidated: 'purchase-order.product.validated',
  ProductRejected: 'purchase-order.product.rejected',
  Received: 'purchase-order.received',
} as const;

export interface PurchaseOrderCreatedEvent {
  purchaseOrderId: string;
  producto_id: number;
  cantidad_solicitada: number;
}

export interface PurchaseOrderReceivedEvent {
  purchaseOrderId: string;
  producto_id: number;
  cantidad: number;
}

export class PurchaseOrderProductValidatedEvent {
  @IsUUID()
  purchaseOrderId: string;

  @IsInt()
  @IsPositive()
  producto_id: number;
}

export class PurchaseOrderProductRejectedEvent {
  @IsUUID()
  purchaseOrderId: string;

  @IsString()
  @IsNotEmpty()
  reason: string;
}
