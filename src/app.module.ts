import { Module } from '@nestjs/common';
import { PurchaseOrdersModule } from './purchase-orders/purchase-orders.module.ts';
import { PrismaModule } from './prisma/prisma.module.ts';

@Module({
  imports: [PrismaModule, PurchaseOrdersModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
