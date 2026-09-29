import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.ts';
import { OrderStatus } from '../generated/prisma/enums.ts';
import { envs } from '../config/envs.ts';

export const VALIDATION_TIMEOUT_REASON = 'Product validation timed out';

// Order saga timeout: rejects orders stuck in AWAITING_VALIDATION (e.g. products-ms
// down for too long). A late validation reply is then ignored by OrdersService
@Injectable()
export class OrderValidationTimeoutJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OrderValidationTimeoutJob.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly prisma: PrismaService) { }

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.expireStaleOrders(), envs.sagaTimeoutCheckIntervalMs);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async expireStaleOrders(now = new Date()): Promise<number> {
    if (this.running) return 0;

    this.running = true;
    try {
      const { count } = await this.prisma.order.updateMany({
        where: {
          status: OrderStatus.AWAITING_VALIDATION,
          createdAt: { lt: new Date(now.getTime() - envs.orderValidationTimeoutMs) },
        },
        data: { status: OrderStatus.REJECTED, rejectionReason: VALIDATION_TIMEOUT_REASON },
      });

      if (count) this.logger.warn(`Rejected ${count} order(s) awaiting validation for too long`);
      return count;
    } catch (error) {
      this.logger.error(`Saga timeout check failed: ${(error as Error)?.message ?? error}`);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
