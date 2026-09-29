import { Test, TestingModule } from '@nestjs/testing';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { OrdersService } from './orders.service.js';
import { PrismaService } from '../prisma/prisma.service.ts';
import { OutboxService } from '../outbox/outbox.service.ts';
import { OutboxRelay } from '../outbox/outbox.relay.ts';
import { OrderStatus } from '../generated/prisma/enums.ts';
import { OrderEvents } from '../common/index.ts';

const orderId = '6f1c1c9e-2f5b-4c1a-9a47-6a2b1f3c8d10';
const now = new Date('2026-09-28T12:00:00.000Z');

const buildOrder = (overrides: Record<string, unknown> = {}) => ({
  id: orderId,
  totalAmount: 0,
  totalItems: 3,
  status: OrderStatus.AWAITING_VALIDATION,
  paid: false,
  paidAt: null,
  rejectionReason: null,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

describe('OrdersService', () => {
  let service: OrdersService;

  const prisma = {
    order: {
      create: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    orderItem: { update: vi.fn() },
    $transaction: vi.fn(),
  };
  const outbox = { enqueue: vi.fn() };
  const outboxRelay = { kick: vi.fn() };

  beforeEach(async () => {
    vi.resetAllMocks();
    // Interactive transactions run the callback against the same mocked client
    prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: prisma },
        { provide: OutboxService, useValue: outbox },
        { provide: OutboxRelay, useValue: outboxRelay },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  describe('create', () => {
    it('stores the order unpriced and enqueues order.created in the same transaction', async () => {
      prisma.order.create.mockResolvedValue({
        ...buildOrder(),
        OrderItem: [
          { productId: 1, quantity: 2, price: null, name: null },
          { productId: 2, quantity: 1, price: null, name: null },
        ],
      });

      const result = await service.create({
        items: [{ productId: 1, quantity: 2 }, { productId: 2, quantity: 1 }],
      });

      expect(prisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            totalAmount: 0,
            totalItems: 3,
            status: OrderStatus.AWAITING_VALIDATION,
          }),
        }),
      );
      expect(outbox.enqueue).toHaveBeenCalledWith(prisma, OrderEvents.Created, {
        orderId,
        items: [{ productId: 1, quantity: 2 }, { productId: 2, quantity: 1 }],
      });
      expect(outboxRelay.kick).toHaveBeenCalled();
      expect(result).toMatchObject({
        id: orderId,
        status: OrderStatus.AWAITING_VALIDATION,
        createdAt: now.toISOString(),
        items: [
          { productId: 1, quantity: 2, price: undefined, name: undefined },
          { productId: 2, quantity: 1, price: undefined, name: undefined },
        ],
      });
    });

    it('does not kick the relay when the transaction fails', async () => {
      prisma.order.create.mockRejectedValue(new Error('db down'));

      await expect(service.create({ items: [{ productId: 1, quantity: 1 }] })).rejects.toThrow('db down');
      expect(outboxRelay.kick).not.toHaveBeenCalled();
    });
  });

  describe('confirmValidatedOrder', () => {
    const products = [
      { id: 1, name: 'Keyboard', price: 50 },
      { id: 2, name: 'Mouse', price: 20 },
    ];

    it('prices the items, computes the total and moves the order to PENDING', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...buildOrder(),
        OrderItem: [
          { id: 'item-1', productId: 1, quantity: 2 },
          { id: 'item-2', productId: 2, quantity: 1 },
        ],
      });
      prisma.order.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.confirmValidatedOrder({ orderId, products })).resolves.toBe(true);

      expect(prisma.order.updateMany).toHaveBeenCalledWith({
        where: { id: orderId, status: OrderStatus.AWAITING_VALIDATION },
        data: { status: OrderStatus.PENDING, totalAmount: 120 },
      });
      expect(prisma.orderItem.update).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: { price: 50, name: 'Keyboard' },
      });
      expect(prisma.orderItem.update).toHaveBeenCalledWith({
        where: { id: 'item-2' },
        data: { price: 20, name: 'Mouse' },
      });
    });

    it('is a no-op when the order was already processed', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...buildOrder({ status: OrderStatus.REJECTED }),
        OrderItem: [],
      });

      await expect(service.confirmValidatedOrder({ orderId, products })).resolves.toBe(false);
      expect(prisma.order.updateMany).not.toHaveBeenCalled();
      expect(prisma.orderItem.update).not.toHaveBeenCalled();
    });

    it('does not price the items when it loses the race against the timeout', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...buildOrder(),
        OrderItem: [{ id: 'item-1', productId: 1, quantity: 1 }],
      });
      prisma.order.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.confirmValidatedOrder({ orderId, products })).resolves.toBe(false);
      expect(prisma.orderItem.update).not.toHaveBeenCalled();
    });

    it('fails when a product of the order is missing from the reply', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...buildOrder(),
        OrderItem: [{ id: 'item-3', productId: 3, quantity: 1 }],
      });

      await expect(service.confirmValidatedOrder({ orderId, products })).rejects.toThrow(/miss product #3/);
    });

    it('fails when the order does not exist', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(service.confirmValidatedOrder({ orderId, products })).rejects.toThrow(/does not exist/);
    });
  });

  describe('rejectOrder', () => {
    it('marks an order awaiting validation as REJECTED with the reason', async () => {
      prisma.order.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.rejectOrder({ orderId, reason: 'Products not found or unavailable: #9' })).resolves.toBe(true);
      expect(prisma.order.updateMany).toHaveBeenCalledWith({
        where: { id: orderId, status: OrderStatus.AWAITING_VALIDATION },
        data: { status: OrderStatus.REJECTED, rejectionReason: 'Products not found or unavailable: #9' },
      });
    });

    it('is a no-op when the order was already processed', async () => {
      prisma.order.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.rejectOrder({ orderId, reason: 'late' })).resolves.toBe(false);
    });
  });

  describe('findOne', () => {
    it('returns the stored item snapshot without calling other services', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...buildOrder({ status: OrderStatus.PENDING, totalAmount: 50 }),
        OrderItem: [{ productId: 1, quantity: 1, price: 50, name: 'Keyboard' }],
      });

      await expect(service.findOne(orderId)).resolves.toMatchObject({
        status: OrderStatus.PENDING,
        items: [{ productId: 1, quantity: 1, price: 50, name: 'Keyboard' }],
      });
    });

    it('throws NOT_FOUND when the order does not exist', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      const error = await service.findOne(orderId).catch((e: unknown) => e);
      expect((error as RpcException).getError()).toMatchObject({ code: status.NOT_FOUND });
    });
  });

  describe('changeOrderStatus', () => {
    it.each([OrderStatus.AWAITING_VALIDATION, OrderStatus.REJECTED])(
      'refuses to move an order to the saga status %s',
      async (target) => {
        const error = await service.changeOrderStatus(orderId, target).catch((e: unknown) => e);

        expect((error as RpcException).getError()).toMatchObject({ code: status.FAILED_PRECONDITION });
        expect(prisma.order.findUnique).not.toHaveBeenCalled();
      },
    );

    it.each([OrderStatus.AWAITING_VALIDATION, OrderStatus.REJECTED])(
      'refuses to change an order that is %s',
      async (current) => {
        prisma.order.findUnique.mockResolvedValue({ ...buildOrder({ status: current }), OrderItem: [] });

        const error = await service.changeOrderStatus(orderId, OrderStatus.DELIVERED).catch((e: unknown) => e);

        expect((error as RpcException).getError()).toMatchObject({ code: status.FAILED_PRECONDITION });
        expect(prisma.order.update).not.toHaveBeenCalled();
      },
    );

    it('updates a validated order', async () => {
      prisma.order.findUnique.mockResolvedValue({ ...buildOrder({ status: OrderStatus.PENDING }), OrderItem: [] });
      prisma.order.update.mockResolvedValue({ ...buildOrder({ status: OrderStatus.DELIVERED }), OrderItem: [] });

      await expect(service.changeOrderStatus(orderId, OrderStatus.DELIVERED)).resolves.toMatchObject({
        status: OrderStatus.DELIVERED,
      });
    });
  });
});
