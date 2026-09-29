import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { envs } from '../config/envs.ts';
import { ORDERS_EVENTS_CLIENT, SYNER_EXCHANGE } from '../config/services.ts';

const rabbitMQClients = ClientsModule.register([
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
]);

@Module({
  imports: [rabbitMQClients],
  exports: [rabbitMQClients],
})
export class RabbitMQModule {}
