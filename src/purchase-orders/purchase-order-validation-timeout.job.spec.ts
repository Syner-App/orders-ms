import { Test, TestingModule } from '@nestjs/testing';
import { PurchaseOrderValidationTimeoutJob, VALIDATION_TIMEOUT_REASON } from './purchase-order-validation-timeout.job.ts';
import { PrismaService } from '../prisma/prisma.service.ts';
import { StatusPurchaseOrder } from '../generated/prisma/enums.ts';
import { envs } from '../config/envs.ts';

describe('PurchaseOrderValidationTimeoutJob', () => {
  let job: PurchaseOrderValidationTimeoutJob;
  const prisma = { purchaseOrder: { updateMany: vi.fn() } };

  beforeEach(async () => {
    vi.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [PurchaseOrderValidationTimeoutJob, { provide: PrismaService, useValue: prisma }],
    }).compile();

    job = module.get(PurchaseOrderValidationTimeoutJob);
  });

  it('rejects purchase orders in validation for longer than the timeout', async () => {
    prisma.purchaseOrder.updateMany.mockResolvedValue({ count: 2 });
    const now = new Date('2026-09-28T12:00:00.000Z');

    await expect(job.expireStaleOrders(now)).resolves.toBe(2);

    expect(prisma.purchaseOrder.updateMany).toHaveBeenCalledWith({
      where: {
        estado: StatusPurchaseOrder.EN_VALIDACION,
        createdAt: { lt: new Date(now.getTime() - envs.orderValidationTimeoutMs) },
      },
      data: { estado: StatusPurchaseOrder.RECHAZADA, motivo: VALIDATION_TIMEOUT_REASON },
    });
  });

  it('does not overlap runs', async () => {
    let release!: (value: { count: number }) => void;
    prisma.purchaseOrder.updateMany.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));

    const first = job.expireStaleOrders();
    await expect(job.expireStaleOrders()).resolves.toBe(0);

    release({ count: 1 });
    await expect(first).resolves.toBe(1);
    expect(prisma.purchaseOrder.updateMany).toHaveBeenCalledTimes(1);
  });

  it('swallows database errors so the interval keeps running', async () => {
    prisma.purchaseOrder.updateMany.mockRejectedValue(new Error('db down'));

    await expect(job.expireStaleOrders()).resolves.toBe(0);
  });
});
