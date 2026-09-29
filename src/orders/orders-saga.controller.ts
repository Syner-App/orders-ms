import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext, Transport } from '@nestjs/microservices';
import type { ClassConstructor } from 'class-transformer';
import { OrdersService } from './orders.service.js';
import {
  OrderEvents,
  OrderProductsRejectedEvent,
  OrderProductsValidatedEvent,
  parseEvent,
  rmqMessage,
} from '../common/index.ts';

// Order saga replies from products-ms. Handlers are idempotent, so a
// redelivered message is simply acked again
@Controller()
export class OrdersSagaController {
  private readonly logger = new Logger(OrdersSagaController.name);

  constructor(private readonly ordersService: OrdersService) { }

  // <string> selects the untyped overload; the typed one forbids a typed @Ctx() argument
  @EventPattern<string>(OrderEvents.ProductsValidated, Transport.RMQ)
  handleProductsValidated(@Payload() payload: unknown, @Ctx() context: RmqContext) {
    return this.process(OrderEvents.ProductsValidated, OrderProductsValidatedEvent, payload, context,
      (event) => this.ordersService.confirmValidatedOrder(event));
  }

  @EventPattern<string>(OrderEvents.ProductsRejected, Transport.RMQ)
  handleProductsRejected(@Payload() payload: unknown, @Ctx() context: RmqContext) {
    return this.process(OrderEvents.ProductsRejected, OrderProductsRejectedEvent, payload, context,
      (event) => this.ordersService.rejectOrder(event));
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
