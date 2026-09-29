import { Module } from '@nestjs/common';
import { PurchaseOrdersModule } from './purchase-orders/purchase-orders.module.ts';

@Module({
  imports: [PurchaseOrdersModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
