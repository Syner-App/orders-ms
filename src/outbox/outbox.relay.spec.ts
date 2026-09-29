import { Test, TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import { OutboxRelay } from './outbox.relay.ts';
import { PrismaService } from '../prisma/prisma.service.ts';
import { ORDERS_EVENTS_CLIENT } from '../config/services.ts';

const outboxEvent = (id: number) => ({
  id,
  pattern: 'order.created',
  payload: { orderId: `order-${id}` },
  attempts: 0,
  lastError: null,
  createdAt: new Date(),
  publishedAt: null,
});

describe('OutboxRelay', () => {
  let relay: OutboxRelay;

  const prisma = {
    outboxEvent: {
      findMany: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
  const eventsClient = { emit: vi.fn() };

  beforeEach(async () => {
    vi.resetAllMocks();
    prisma.outboxEvent.deleteMany.mockResolvedValue({ count: 0 });
    eventsClient.emit.mockReturnValue(of(undefined));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OutboxRelay,
        { provide: PrismaService, useValue: prisma },
        { provide: ORDERS_EVENTS_CLIENT, useValue: eventsClient },
      ],
    }).compile();

    relay = module.get(OutboxRelay);
  });

  it('publishes pending events in order and marks them as published', async () => {
    prisma.outboxEvent.findMany.mockResolvedValueOnce([outboxEvent(1), outboxEvent(2)]);

    await expect(relay.flush()).resolves.toBe(2);

    expect(prisma.outboxEvent.findMany).toHaveBeenCalledWith({
      where: { publishedAt: null },
      orderBy: { id: 'asc' },
      take: 50,
    });
    expect(eventsClient.emit.mock.calls).toEqual([
      ['order.created', { orderId: 'order-1' }],
      ['order.created', { orderId: 'order-2' }],
    ]);
    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { publishedAt: expect.any(Date) },
    });
    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: 2 },
      data: { publishedAt: expect.any(Date) },
    });
  });

  it('records the failure and stops the batch to preserve ordering', async () => {
    prisma.outboxEvent.findMany.mockResolvedValueOnce([outboxEvent(1), outboxEvent(2)]);
    eventsClient.emit.mockReturnValueOnce(throwError(() => new Error('broker down')));

    await expect(relay.flush()).resolves.toBe(0);

    expect(eventsClient.emit).toHaveBeenCalledTimes(1);
    expect(prisma.outboxEvent.update).toHaveBeenCalledTimes(1);
    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { attempts: { increment: 1 }, lastError: 'broker down' },
    });
  });

  it('does not overlap flushes and runs again when kicked while busy', async () => {
    let releaseFirstBatch!: (events: unknown[]) => void;
    prisma.outboxEvent.findMany
      .mockReturnValueOnce(new Promise((resolve) => { releaseFirstBatch = resolve; }))
      .mockResolvedValueOnce([outboxEvent(2)]);

    const first = relay.flush();
    await expect(relay.flush()).resolves.toBe(0); // busy: only flags a rerun

    releaseFirstBatch([outboxEvent(1)]);
    await expect(first).resolves.toBe(2);
    expect(prisma.outboxEvent.findMany).toHaveBeenCalledTimes(2);
  });

  it('purges old published events', async () => {
    prisma.outboxEvent.findMany.mockResolvedValueOnce([]);

    await relay.flush();

    expect(prisma.outboxEvent.deleteMany).toHaveBeenCalledWith({
      where: { publishedAt: { lt: expect.any(Date) } },
    });
  });
});
