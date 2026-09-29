import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.ts';

@Injectable()
export class OutboxService {
  // Must receive the transaction client so the event commits (or rolls back)
  // together with the business change
  enqueue(tx: Prisma.TransactionClient, pattern: string, payload: Prisma.InputJsonValue) {
    return tx.outboxEvent.create({ data: { pattern, payload } });
  }
}
