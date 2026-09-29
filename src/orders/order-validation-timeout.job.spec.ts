import { Test, TestingModule } from '@nestjs/testing';
import { OrderValidationTimeoutJob, VALIDATION_TIMEOUT_REASON } from './order-validation-timeout.job.ts';
import { PrismaService } from '../prisma/prisma.service.ts';
import { OrderStatus } from '../generated/prisma/enums.ts';
import { envs } from '../config/envs.ts';

describe('OrderValidationTimeoutJob', () => {
  let job: OrderValidationTimeoutJob;
  const prisma = { order: { updateMany: vi.fn() } };

  beforeEach(async () => {
    vi.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [OrderValidationTimeoutJob, { provide: PrismaService, useValue: prisma }],
    }).compile();

    job = module.get(OrderValidationTimeoutJob);
  });

  it('rejects orders awaiting validation for longer than the timeout', async () => {
    prisma.order.updateMany.mockResolvedValue({ count: 2 });
    const now = new Date('2026-09-28T12:00:00.000Z');

    await expect(job.expireStaleOrders(now)).resolves.toBe(2);

    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: {
        status: OrderStatus.AWAITING_VALIDATION,
        createdAt: { lt: new Date(now.getTime() - envs.orderValidationTimeoutMs) },
      },
      data: { status: OrderStatus.REJECTED, rejectionReason: VALIDATION_TIMEOUT_REASON },
    });
  });

  it('does not overlap runs', async () => {
    let release!: (value: { count: number }) => void;
    prisma.order.updateMany.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));

    const first = job.expireStaleOrders();
    await expect(job.expireStaleOrders()).resolves.toBe(0);

    release({ count: 1 });
    await expect(first).resolves.toBe(1);
    expect(prisma.order.updateMany).toHaveBeenCalledTimes(1);
  });

  it('swallows database errors so the interval keeps running', async () => {
    prisma.order.updateMany.mockRejectedValue(new Error('db down'));

    await expect(job.expireStaleOrders()).resolves.toBe(0);
  });
});
