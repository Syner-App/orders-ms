import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext, Transport } from '@nestjs/microservices';
import type { ClassConstructor } from 'class-transformer';
import { PurchaseOrdersService } from './purchase-orders.service.ts';
import {
  parseEvent,
  PurchaseOrderEvents,
  PurchaseOrderProductRejectedEvent,
  PurchaseOrderProductValidatedEvent,
  rmqMessage,
} from '../common/index.ts';

// Purchase order saga replies from products-ms. Handlers are idempotent, so a
// redelivered message is simply acked again
@Controller()
export class PurchaseOrdersSagaController {
  private readonly logger = new Logger(PurchaseOrdersSagaController.name);

  constructor(private readonly purchaseOrdersService: PurchaseOrdersService) { }

  // <string> selects the untyped overload; the typed one forbids a typed @Ctx() argument
  @EventPattern<string>(PurchaseOrderEvents.ProductValidated, Transport.RMQ)
  handleProductValidated(@Payload() payload: unknown, @Ctx() context: RmqContext) {
    return this.process(PurchaseOrderEvents.ProductValidated, PurchaseOrderProductValidatedEvent, payload, context,
      (event) => this.purchaseOrdersService.confirmValidatedOrder(event));
  }

  @EventPattern<string>(PurchaseOrderEvents.ProductRejected, Transport.RMQ)
  handleProductRejected(@Payload() payload: unknown, @Ctx() context: RmqContext) {
    return this.process(PurchaseOrderEvents.ProductRejected, PurchaseOrderProductRejectedEvent, payload, context,
      (event) => this.purchaseOrdersService.rejectOrder(event));
  }

  // Invalid payloads and processing errors are dead-lettered (orders.saga-replies.dlq)
  private async process<T extends object>(
    pattern: string,
    cls: ClassConstructor<T>,
    payload: unknown,
    context: RmqContext,
    handler: (event: T) => Promise<unknown>,
  ) {
    const message = rmqMessage(context);

    const parsed = await parseEvent(cls, payload);
    if ('errors' in parsed) {
      this.logger.error(`Invalid ${pattern} payload, dead-lettering: ${parsed.errors}`);
      message.nack(false);
      return;
    }

    try {
      await handler(parsed.event);
      message.ack();
    } catch (error) {
      this.logger.error(`Failed to process ${pattern}, dead-lettering: ${(error as Error)?.message ?? error}`);
      message.nack(false);
    }
  }
}
