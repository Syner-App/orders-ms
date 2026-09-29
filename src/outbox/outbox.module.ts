import { Module } from '@nestjs/common';
import { OutboxService } from './outbox.service.ts';
import { OutboxRelay } from './outbox.relay.ts';
import { RabbitMQModule } from '../transport/rabbitmq.module.ts';

@Module({
  imports: [RabbitMQModule],
  providers: [OutboxService, OutboxRelay],
  exports: [OutboxService, OutboxRelay],
})
export class OutboxModule {}
