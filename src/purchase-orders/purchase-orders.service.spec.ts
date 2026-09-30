import { Test, TestingModule } from '@nestjs/testing';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PurchaseOrdersService } from './purchase-orders.service.ts';
import { UpdatePurchaseOrderStatusDto } from './dto/index.ts';
import { PrismaService } from '../prisma/prisma.service.ts';
import { OutboxService } from '../outbox/outbox.service.ts';
import { OutboxRelay } from '../outbox/outbox.relay.ts';
import { StatusPurchaseOrder } from '../generated/prisma/enums.ts';
import { PurchaseOrderEvents } from '../common/index.ts';

const purchaseOrderId = '6f1c1c9e-2f5b-4c1a-9a47-6a2b1f3c8d10';
const organization_id = '6abd26a42d059ac027376ca1';
const now = new Date('2026-09-28T12:00:00.000Z');

const buildPurchaseOrder = (overrides: Record<string, unknown> = {}) => ({
  id: purchaseOrderId,
  organization_id,
  estado: StatusPurchaseOrder.EN_VALIDACION,
  proveedor: 'Lácteos del Valle',
  cantidad_solicitada: 40,
  motivo: null,
  producto_id: 4,
  createdAt: now,
  updatedAt: null,
  ...overrides,
});

describe('PurchaseOrdersService', () => {
  let service: PurchaseOrdersService;

  const prisma = {
    purchaseOrder: {
      create: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    withTenant: vi.fn(),
  };
  const outbox = { enqueue: vi.fn() };
  const outboxRelay = { kick: vi.fn() };

  beforeEach(async () => {
    vi.resetAllMocks();
    // Tenant transactions run the callback against the same mocked client
    prisma.withTenant.mockImplementation((_organizationId: string, fn: (tx: typeof prisma) => unknown) => fn(prisma));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseOrdersService,
        { provide: PrismaService, useValue: prisma },
        { provide: OutboxService, useValue: outbox },
        { provide: OutboxRelay, useValue: outboxRelay },
      ],
    }).compile();

    service = module.get(PurchaseOrdersService);
  });

  describe('create', () => {
    it('stores the order EN_VALIDACION and enqueues purchase-order.created in the same transaction', async () => {
      prisma.purchaseOrder.create.mockResolvedValue(buildPurchaseOrder());

      const result = await service.create({ organization_id, producto_id: 4, proveedor: 'Lácteos del Valle', cantidad_solicitada: 40 });

      expect(prisma.withTenant).toHaveBeenCalledWith(organization_id, expect.any(Function));
      expect(prisma.purchaseOrder.create).toHaveBeenCalledWith({
        data: {
          organization_id,
          producto_id: 4,
          proveedor: 'Lácteos del Valle',
          cantidad_solicitada: 40,
          motivo: undefined,
          estado: StatusPurchaseOrder.EN_VALIDACION,
        },
      });
      expect(outbox.enqueue).toHaveBeenCalledWith(prisma, PurchaseOrderEvents.Created, {
        organization_id,
        purchaseOrderId,
        producto_id: 4,
        cantidad_solicitada: 40,
      });
      expect(outboxRelay.kick).toHaveBeenCalled();
      expect(result).toMatchObject({
        estado: StatusPurchaseOrder.EN_VALIDACION,
        motivo: undefined,
        createdAt: now.toISOString(),
        updatedAt: undefined,
      });
    });
  });

  describe('findOne', () => {
    it('throws NOT_FOUND for a missing order or one of another organization', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue(null);

      const error = await service.findOne(organization_id, purchaseOrderId).catch((e: unknown) => e);

      expect(prisma.purchaseOrder.findUnique).toHaveBeenCalledWith({ where: { id: purchaseOrderId, organization_id } });
      expect((error as RpcException).getError()).toMatchObject({ code: status.NOT_FOUND });
    });
  });

  describe('updateStatus', () => {
    it('approves a PENDIENTE order', async () => {
      prisma.purchaseOrder.updateMany.mockResolvedValue({ count: 1 });
      prisma.purchaseOrder.findUnique.mockResolvedValue(buildPurchaseOrder({ estado: StatusPurchaseOrder.APROBADA }));

      const result = await service.updateStatus({ organization_id, id: purchaseOrderId, estado: StatusPurchaseOrder.APROBADA });

      expect(prisma.purchaseOrder.updateMany).toHaveBeenCalledWith({
        where: { id: purchaseOrderId, organization_id, estado: StatusPurchaseOrder.PENDIENTE },
        data: { estado: StatusPurchaseOrder.APROBADA },
      });
      expect(outbox.enqueue).not.toHaveBeenCalled();
      expect(result.estado).toBe(StatusPurchaseOrder.APROBADA);
    });

    it('rejects a PENDIENTE order storing the motivo', async () => {
      prisma.purchaseOrder.updateMany.mockResolvedValue({ count: 1 });
      prisma.purchaseOrder.findUnique.mockResolvedValue(
        buildPurchaseOrder({ estado: StatusPurchaseOrder.RECHAZADA, motivo: 'Precio fuera de presupuesto' }),
      );

      await service.updateStatus({
        organization_id,
        id: purchaseOrderId,
        estado: StatusPurchaseOrder.RECHAZADA,
        motivo: 'Precio fuera de presupuesto',
      });

      expect(prisma.purchaseOrder.updateMany).toHaveBeenCalledWith({
        where: { id: purchaseOrderId, organization_id, estado: StatusPurchaseOrder.PENDIENTE },
        data: { estado: StatusPurchaseOrder.RECHAZADA, motivo: 'Precio fuera de presupuesto' },
      });
    });

    it('receives an APROBADA order and enqueues purchase-order.received', async () => {
      prisma.purchaseOrder.updateMany.mockResolvedValue({ count: 1 });
      prisma.purchaseOrder.findUnique.mockResolvedValue(buildPurchaseOrder({ estado: StatusPurchaseOrder.RECIBIDA }));

      await service.updateStatus({ organization_id, id: purchaseOrderId, estado: StatusPurchaseOrder.RECIBIDA });

      expect(prisma.purchaseOrder.updateMany).toHaveBeenCalledWith({
        where: { id: purchaseOrderId, organization_id, estado: StatusPurchaseOrder.APROBADA },
        data: { estado: StatusPurchaseOrder.RECIBIDA },
      });
      expect(outbox.enqueue).toHaveBeenCalledWith(prisma, PurchaseOrderEvents.Received, {
        organization_id,
        purchaseOrderId,
        producto_id: 4,
        cantidad: 40,
      });
      expect(outboxRelay.kick).toHaveBeenCalled();
    });

    it('throws FAILED_PRECONDITION for an invalid transition', async () => {
      prisma.purchaseOrder.updateMany.mockResolvedValue({ count: 0 });
      prisma.purchaseOrder.findUnique.mockResolvedValue(buildPurchaseOrder({ estado: StatusPurchaseOrder.RECIBIDA }));

      const error = await service
        .updateStatus({ organization_id, id: purchaseOrderId, estado: StatusPurchaseOrder.APROBADA })
        .catch((e: unknown) => e);

      expect((error as RpcException).getError()).toMatchObject({ code: status.FAILED_PRECONDITION });
      expect(outbox.enqueue).not.toHaveBeenCalled();
    });

    it('throws FAILED_PRECONDITION while the order is still EN_VALIDACION', async () => {
      prisma.purchaseOrder.updateMany.mockResolvedValue({ count: 0 });
      prisma.purchaseOrder.findUnique.mockResolvedValue(buildPurchaseOrder());

      const error = await service
        .updateStatus({ organization_id, id: purchaseOrderId, estado: StatusPurchaseOrder.APROBADA })
        .catch((e: unknown) => e);

      expect((error as RpcException).getError()).toMatchObject({ code: status.FAILED_PRECONDITION });
    });

    it('does not receive twice when the order is already RECIBIDA', async () => {
      prisma.purchaseOrder.updateMany.mockResolvedValue({ count: 0 });
      prisma.purchaseOrder.findUnique.mockResolvedValue(buildPurchaseOrder({ estado: StatusPurchaseOrder.RECIBIDA }));

      await service.updateStatus({ organization_id, id: purchaseOrderId, estado: StatusPurchaseOrder.RECIBIDA });

      expect(outbox.enqueue).not.toHaveBeenCalled();
      expect(outboxRelay.kick).not.toHaveBeenCalled();
    });

    it('throws NOT_FOUND for a missing order', async () => {
      prisma.purchaseOrder.updateMany.mockResolvedValue({ count: 0 });
      prisma.purchaseOrder.findUnique.mockResolvedValue(null);

      const error = await service
        .updateStatus({ organization_id, id: purchaseOrderId, estado: StatusPurchaseOrder.APROBADA })
        .catch((e: unknown) => e);

      expect((error as RpcException).getError()).toMatchObject({ code: status.NOT_FOUND });
    });
  });

  describe('UpdatePurchaseOrderStatusDto', () => {
    const errorsFor = async (payload: object) =>
      (await validate(plainToInstance(UpdatePurchaseOrderStatusDto, payload))).map((error) => error.property);

    it('requires motivo when estado is RECHAZADA', async () => {
      await expect(errorsFor({ organization_id, id: purchaseOrderId, estado: 'RECHAZADA' })).resolves.toEqual(['motivo']);
      await expect(errorsFor({ organization_id, id: purchaseOrderId, estado: 'RECHAZADA', motivo: '' })).resolves.toEqual(['motivo']);
      await expect(errorsFor({ organization_id, id: purchaseOrderId, estado: 'RECHAZADA', motivo: 'Sin presupuesto' })).resolves.toEqual([]);
    });

    it('does not require motivo for the other estados', async () => {
      await expect(errorsFor({ organization_id, id: purchaseOrderId, estado: 'APROBADA' })).resolves.toEqual([]);
      await expect(errorsFor({ organization_id, id: purchaseOrderId, estado: 'RECIBIDA' })).resolves.toEqual([]);
    });

    it('requires the organization_id', async () => {
      await expect(errorsFor({ id: purchaseOrderId, estado: 'APROBADA' })).resolves.toEqual(['organization_id']);
    });

    it('rejects the estados owned by the saga', async () => {
      await expect(errorsFor({ organization_id, id: purchaseOrderId, estado: 'EN_VALIDACION' })).resolves.toEqual(['estado']);
      await expect(errorsFor({ organization_id, id: purchaseOrderId, estado: 'PENDIENTE' })).resolves.toEqual(['estado']);
    });
  });

  describe('saga replies', () => {
    it('confirmValidatedOrder moves EN_VALIDACION to PENDIENTE', async () => {
      prisma.purchaseOrder.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.confirmValidatedOrder({ organization_id, purchaseOrderId, producto_id: 4 })).resolves.toBe(true);

      expect(prisma.purchaseOrder.updateMany).toHaveBeenCalledWith({
        where: { id: purchaseOrderId, organization_id, estado: StatusPurchaseOrder.EN_VALIDACION },
        data: { estado: StatusPurchaseOrder.PENDIENTE },
      });
    });

    it('confirmValidatedOrder ignores an order that already left EN_VALIDACION', async () => {
      prisma.purchaseOrder.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.confirmValidatedOrder({ organization_id, purchaseOrderId, producto_id: 4 })).resolves.toBe(false);
    });

    it('rejectOrder stores the reason as motivo', async () => {
      prisma.purchaseOrder.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.rejectOrder({ organization_id, purchaseOrderId, reason: 'Product #4 not found or inactive' })).resolves.toBe(true);

      expect(prisma.purchaseOrder.updateMany).toHaveBeenCalledWith({
        where: { id: purchaseOrderId, organization_id, estado: StatusPurchaseOrder.EN_VALIDACION },
        data: { estado: StatusPurchaseOrder.RECHAZADA, motivo: 'Product #4 not found or inactive' },
      });
    });
  });
});
