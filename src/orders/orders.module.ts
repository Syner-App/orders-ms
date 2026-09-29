import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service.js';
import { OrdersController } from './orders.controller.js';
import { OrdersSagaController } from './orders-saga.controller.ts';
import { OrderValidationTimeoutJob } from './order-validation-timeout.job.ts';
import { OutboxModule } from '../outbox/outbox.module.ts';

@Module({
  imports: [OutboxModule],
  controllers: [OrdersController, OrdersSagaController],
  providers: [OrdersService, OrderValidationTimeoutJob],
})
export class OrdersModule {}
