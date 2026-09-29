import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { OutboxService } from './outbox.service.ts';
import { OutboxRelay } from './outbox.relay.ts';
import { envs } from '../config/envs.ts';
import { ORDERS_EVENTS_CLIENT, SYNER_EXCHANGE } from '../config/services.ts';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: ORDERS_EVENTS_CLIENT,
        transport: Transport.RMQ,
        options: {
          urls: [envs.rabbitmqUrl],
          exchange: SYNER_EXCHANGE,
          exchangeType: 'topic',
          // Publish to the exchange using the event pattern as routing key
          wildcards: true,
          persistent: true,
        },
      },
    ]),
  ],
  providers: [OutboxService, OutboxRelay],
  exports: [OutboxService, OutboxRelay],
})
export class OutboxModule {}
