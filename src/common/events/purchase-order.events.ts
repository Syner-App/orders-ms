import { IsInt, IsMongoId, IsNotEmpty, IsPositive, IsString, IsUUID } from 'class-validator';

// Purchase order saga contract. Keep in sync with products-ms/src/common/events/purchase-order.events.ts.
// Every event carries the organization of the purchase order, so each step runs scoped to it
export const PurchaseOrderEvents = {
  Created: 'purchase-order.created',
  ProductValidated: 'purchase-order.product.validated',
  ProductRejected: 'purchase-order.product.rejected',
  Received: 'purchase-order.received',
} as const;

export interface PurchaseOrderCreatedEvent {
  organization_id: string;
  purchaseOrderId: string;
  producto_id: number;
  cantidad_solicitada: number;
}

export interface PurchaseOrderReceivedEvent {
  organization_id: string;
  purchaseOrderId: string;
  producto_id: number;
  cantidad: number;
}

export class PurchaseOrderProductValidatedEvent {
  @IsMongoId()
  organization_id: string;

  @IsUUID()
  purchaseOrderId: string;

  @IsInt()
  @IsPositive()
  producto_id: number;
}

export class PurchaseOrderProductRejectedEvent {
  @IsMongoId()
  organization_id: string;

  @IsUUID()
  purchaseOrderId: string;

  @IsString()
  @IsNotEmpty()
  reason: string;
}
