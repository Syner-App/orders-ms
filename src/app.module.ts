import { Module } from '@nestjs/common';
import { OrdersModule } from './orders/orders.module.js';
import { PrismaModule } from './prisma/prisma.module.ts';

@Module({
  imports: [PrismaModule, OrdersModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
