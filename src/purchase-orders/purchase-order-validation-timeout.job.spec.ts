import { Test, TestingModule } from '@nestjs/testing';
import { PurchaseOrderValidationTimeoutJob, VALIDATION_TIMEOUT_REASON } from './purchase-order-validation-timeout.job.ts';
import { PrismaService } from '../prisma/prisma.service.ts';
import { envs } from '../config/envs.ts';

describe('PurchaseOrderValidationTimeoutJob', () => {
  let job: PurchaseOrderValidationTimeoutJob;
  const prisma = { $queryRaw: vi.fn() };

  beforeEach(async () => {
    vi.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [PurchaseOrderValidationTimeoutJob, { provide: PrismaService, useValue: prisma }],
    }).compile();

    job = module.get(PurchaseOrderValidationTimeoutJob);
  });

  it('rejects purchase orders of every organization in validation for longer than the timeout', async () => {
    prisma.$queryRaw.mockResolvedValue([{ count: 2 }]);
    const now = new Date('2026-09-28T12:00:00.000Z');

    await expect(job.expireStaleOrders(now)).resolves.toBe(2);

    const [strings, cutoff, reason] = prisma.$queryRaw.mock.calls[0];
    expect(strings.join('?')).toContain('expire_stale_purchase_orders(?::timestamp, ?)');
    expect(cutoff).toEqual(new Date(now.getTime() - envs.orderValidationTimeoutMs));
    expect(reason).toBe(VALIDATION_TIMEOUT_REASON);
  });

  it('does not overlap runs', async () => {
    let release!: (value: [{ count: number }]) => void;
    prisma.$queryRaw.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));

    const first = job.expireStaleOrders();
    await expect(job.expireStaleOrders()).resolves.toBe(0);

    release([{ count: 1 }]);
    await expect(first).resolves.toBe(1);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('swallows database errors so the interval keeps running', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('db down'));

    await expect(job.expireStaleOrders()).resolves.toBe(0);
  });
});
