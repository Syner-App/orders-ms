import { Module } from '@nestjs/common';
import { OutboxService } from './outbox.service.ts';
import { OutboxRelay } from './outbox.relay.ts';
import { RabbitMQModule } from '../transport/rabbitmq.module.ts';
import { PrismaService } from '../prisma/prisma.service.ts';

@Module({
  imports: [RabbitMQModule],
  providers: [OutboxService, OutboxRelay, PrismaService],
  exports: [OutboxService, OutboxRelay, PrismaService],
})
export class OutboxModule {}
