import { Module } from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service.ts';
import { PurchaseOrdersController } from './purchase-orders.controller.ts';
import { PurchaseOrdersSagaController } from './purchase-orders-saga.controller.ts';
import { PurchaseOrderValidationTimeoutJob } from './purchase-order-validation-timeout.job.ts';
import { OutboxModule } from '../outbox/outbox.module.ts';

@Module({
  imports: [OutboxModule],
  controllers: [PurchaseOrdersController, PurchaseOrdersSagaController],
  providers: [PurchaseOrdersService, PurchaseOrderValidationTimeoutJob],
})
export class PurchaseOrdersModule {}
