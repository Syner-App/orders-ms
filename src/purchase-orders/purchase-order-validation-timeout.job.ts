import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.ts';
import { envs } from '../config/envs.ts';

export const VALIDATION_TIMEOUT_REASON = 'Product validation timed out';

// Purchase order saga timeout: rejects orders stuck in EN_VALIDACION (e.g. products-ms
// down for too long). A late validation reply is then ignored by PurchaseOrdersService.
// It spans every organization, which RLS forbids to the service's own role, so it goes
// through the SECURITY DEFINER function expire_stale_purchase_orders (multitenancy migration)
@Injectable()
export class PurchaseOrderValidationTimeoutJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PurchaseOrderValidationTimeoutJob.name);
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
      const cutoff = new Date(now.getTime() - envs.orderValidationTimeoutMs);
      const [{ count }] = await this.prisma.$queryRaw<[{ count: number }]>`
        SELECT expire_stale_purchase_orders(${cutoff}::timestamp, ${VALIDATION_TIMEOUT_REASON}) AS count`;

      if (count) this.logger.warn(`Rejected ${count} purchase order(s) awaiting validation for too long`);
      return count;
    } catch (error) {
      this.logger.error(`Saga timeout check failed: ${(error as Error)?.message ?? error}`);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
