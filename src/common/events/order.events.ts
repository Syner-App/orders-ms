import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

// Order saga contract. Keep in sync with products-ms/src/common/events/order.events.ts
export const OrderEvents = {
  Created: 'order.created',
  ProductsValidated: 'order.products.validated',
  ProductsRejected: 'order.products.rejected',
} as const;

export interface OrderCreatedEvent {
  orderId: string;
  items: { productId: number; quantity: number }[];
}

export class ValidatedProduct {
  @IsInt()
  @IsPositive()
  id: number;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsNumber()
  @Min(0)
  price: number;
}

export class OrderProductsValidatedEvent {
  @IsUUID()
  orderId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ValidatedProduct)
  products: ValidatedProduct[];
}

export class OrderProductsRejectedEvent {
  @IsUUID()
  orderId: string;

  @IsString()
  @IsNotEmpty()
  reason: string;
}
