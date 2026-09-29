import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { lastValueFrom, timeout } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service.ts';
import { envs } from '../config/envs.ts';
import { ORDERS_EVENTS_CLIENT, PUBLISH_TIMEOUT_MS } from '../config/services.ts';

const BATCH_SIZE = 50;
const PURGE_EVERY_MS = 60 * 60 * 1000;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

// Publishes pending OutboxEvent rows to RabbitMQ in insertion order.
// At-least-once: an event is marked as published only after the broker confirms it
@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelay.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private rerun = false;
  private lastPurgeAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ORDERS_EVENTS_CLIENT) private readonly eventsClient: ClientProxy,
  ) { }

  onApplicationBootstrap() {
    this.timer = setInterval(() => this.kick(), envs.outboxPollIntervalMs);
    this.kick();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  // Fire-and-forget flush, called right after a transaction that enqueued events
  kick() {
    void this.flush();
  }

  async flush(): Promise<number> {
    if (this.running) {
      this.rerun = true;
      return 0;
    }

    this.running = true;
    let published = 0;
    try {
      let keepGoing: boolean;
      do {
        this.rerun = false;
        const { count, complete } = await this.publishBatch();
        published += count;
        keepGoing = complete && (this.rerun || count === BATCH_SIZE);
      } while (keepGoing);

      await this.purgePublished();
    } catch (error) {
      this.logger.error(`Outbox flush failed: ${(error as Error)?.message ?? error}`);
    } finally {
      this.running = false;
    }
    return published;
  }

  // Stops at the first failure to keep events ordered; it is retried on the next tick
  private async publishBatch(): Promise<{ count: number; complete: boolean }> {
    const events = await this.prisma.outboxEvent.findMany({
      where: { publishedAt: null },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
    });

    let count = 0;
    for (const event of events) {
      try {
        await lastValueFrom(
          this.eventsClient.emit(event.pattern, event.payload).pipe(timeout(PUBLISH_TIMEOUT_MS)),
          { defaultValue: undefined },
        );
      } catch (error) {
        const lastError = (error as Error)?.message ?? String(error);
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: { attempts: { increment: 1 }, lastError },
        });
        this.logger.warn(`Could not publish outbox event #${event.id} (${event.pattern}): ${lastError}`);
        return { count, complete: false };
      }

      await this.prisma.outboxEvent.update({
        where: { id: event.id },
        data: { publishedAt: new Date() },
      });
      count++;
    }
    return { count, complete: true };
  }

  private async purgePublished() {
    const now = Date.now();
    if (now - this.lastPurgeAt < PURGE_EVERY_MS) return;

    this.lastPurgeAt = now;
    const { count } = await this.prisma.outboxEvent.deleteMany({
      where: { publishedAt: { lt: new Date(now - RETENTION_MS) } },
    });
    if (count) this.logger.log(`Purged ${count} published outbox events`);
  }
}
