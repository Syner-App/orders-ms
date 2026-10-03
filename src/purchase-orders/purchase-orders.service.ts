import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status as grpcStatus } from '@grpc/grpc-js';
import {
  CreatePurchaseOrderDto,
  PurchaseOrderPaginationDto,
  UpdatePurchaseOrderStatusDto,
  type UpdatablePurchaseOrderStatus,
} from './dto/index.ts';
import { PrismaService } from '../prisma/prisma.service.ts';
import { StatusPurchaseOrder } from '../generated/prisma/enums.ts';
import type { Prisma, PurchaseOrder } from '../generated/prisma/client.ts';
import { OutboxService } from '../outbox/outbox.service.ts';
import { OutboxRelay } from '../outbox/outbox.relay.ts';
import {
  LOW_STOCK_ALERT,
  PurchaseOrderEvents,
  type AlertCreatedEvent,
  type PurchaseOrderCreatedEvent,
  type PurchaseOrderProductRejectedEvent,
  type PurchaseOrderProductValidatedEvent,
  type PurchaseOrderReceivedEvent,
} from '../common/index.ts';

// Manual transitions: target estado -> estado the order must be in
const STATUS_TRANSITIONS: Record<UpdatablePurchaseOrderStatus, StatusPurchaseOrder> = {
  [StatusPurchaseOrder.APROBADA]: StatusPurchaseOrder.PENDIENTE,
  [StatusPurchaseOrder.RECHAZADA]: StatusPurchaseOrder.PENDIENTE,
  [StatusPurchaseOrder.RECIBIDA]: StatusPurchaseOrder.APROBADA,
};

// Orders still on their way: a new low stock alert does not open another one for the product
const OPEN_STATUSES = [StatusPurchaseOrder.EN_VALIDACION, StatusPurchaseOrder.PENDIENTE, StatusPurchaseOrder.APROBADA];

// Automatic orders restock twice the minimum
const lowStockOrderQuantity = (stock_minimo: number) => Math.max(1, stock_minimo * 2);

type NewPurchaseOrder = Omit<Prisma.PurchaseOrderUncheckedCreateInput, 'estado'>;

@Injectable()
export class PurchaseOrdersService {
  private readonly logger = new Logger(PurchaseOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly outboxRelay: OutboxRelay,
  ) { }

  // Saga step 1: persist the order EN_VALIDACION and announce it. products-ms answers
  // asynchronously with purchase-order.product.validated / purchase-order.product.rejected
  async create({ organization_id, producto_id, proveedor, cantidad_solicitada, motivo }: CreatePurchaseOrderDto) {
    const purchaseOrder = await this.prisma.withTenant(organization_id, (tx) =>
      this.createInTx(tx, { organization_id, producto_id, proveedor, cantidad_solicitada, motivo }),
    );

    this.outboxRelay.kick();

    return this.toPurchaseOrderResponse(purchaseOrder);
  }

  // A new low stock alert opens a purchase order through the same saga as create().
  // Idempotent: a redelivered alert (alert_id is unique) or a product that already has an
  // open order creates nothing
  async createFromLowStockAlert({ organization_id, alert, product }: AlertCreatedEvent) {
    if (alert.tipo !== LOW_STOCK_ALERT) return null;

    const purchaseOrder = await this.prisma.withTenant(organization_id, async (tx) => {
      const existing = await tx.purchaseOrder.findFirst({
        where: {
          organization_id,
          OR: [{ alert_id: alert.id }, { producto_id: alert.product_id, estado: { in: OPEN_STATUSES } }],
        },
        select: { id: true },
      });
      if (existing) return null;

      return this.createInTx(tx, {
        organization_id,
        producto_id: alert.product_id,
        proveedor: product.proveedor,
        cantidad_solicitada: lowStockOrderQuantity(product.stock_minimo),
        motivo: `Generada automáticamente: ${alert.descripcion}`,
        alert_id: alert.id,
      });
    });

    if (!purchaseOrder) {
      this.logger.log(`Low stock alert ${alert.id}: product #${alert.product_id} already has an open purchase order`);
      return null;
    }

    this.outboxRelay.kick();
    this.logger.log(`Purchase order #${purchaseOrder.id} opened from low stock alert ${alert.id}`);
    return purchaseOrder;
  }

  async findAll({ organization_id, page, limit, estado }: PurchaseOrderPaginationDto) {
    const where = { organization_id, estado };

    const [total, purchaseOrders] = await this.prisma.withTenant(organization_id, async (tx) => [
      await tx.purchaseOrder.count({ where }),
      await tx.purchaseOrder.findMany({
        where,
        take: limit,
        skip: (page! - 1) * limit!,
        orderBy: { createdAt: 'desc' },
      }),
    ] as const);

    return {
      data: purchaseOrders.map((purchaseOrder) => this.toPurchaseOrderResponse(purchaseOrder)),
      meta: {
        total,
        page,
        lastPage: Math.ceil(total / limit!),
      },
    };
  }

  // A purchase order of another organization is NOT_FOUND, like a missing one
  async findOne(organization_id: string, id: string) {
    const purchaseOrder = await this.prisma.withTenant(organization_id, (tx) =>
      tx.purchaseOrder.findUnique({ where: { id, organization_id } }),
    );

    if (!purchaseOrder) {
      throw new RpcException({
        code: grpcStatus.NOT_FOUND,
        message: `Purchase order with id: #${id} not found`,
      });
    }

    return this.toPurchaseOrderResponse(purchaseOrder);
  }

  // PENDIENTE -> APROBADA | RECHAZADA, APROBADA -> RECIBIDA. Receiving enqueues
  // purchase-order.received in the same transaction so products-ms adds the stock
  async updateStatus({ organization_id, id, estado, motivo }: UpdatePurchaseOrderStatusDto) {
    const requiredStatus = STATUS_TRANSITIONS[estado];

    const { purchaseOrder, received } = await this.prisma.withTenant(organization_id, async (tx) => {
      // Conditional update: loses cleanly against a concurrent transition
      const { count } = await tx.purchaseOrder.updateMany({
        where: { id, organization_id, estado: requiredStatus },
        data: { estado, ...(motivo !== undefined && { motivo }) },
      });

      const purchaseOrder = await tx.purchaseOrder.findUnique({ where: { id, organization_id } });

      if (!purchaseOrder) {
        throw new RpcException({
          code: grpcStatus.NOT_FOUND,
          message: `Purchase order with id: #${id} not found`,
        });
      }

      if (count === 0) {
        // Repeating the current estado is a no-op
        if (purchaseOrder.estado === estado) return { purchaseOrder, received: false };

        throw new RpcException({
          code: grpcStatus.FAILED_PRECONDITION,
          message: `Purchase order #${id} is ${purchaseOrder.estado} and cannot be moved to ${estado} (it must be ${requiredStatus})`,
        });
      }

      if (estado !== StatusPurchaseOrder.RECIBIDA) return { purchaseOrder, received: false };

      const event: PurchaseOrderReceivedEvent = {
        organization_id,
        purchaseOrderId: id,
        producto_id: purchaseOrder.producto_id,
        cantidad: purchaseOrder.cantidad_solicitada,
      };
      await this.outbox.enqueue(tx, PurchaseOrderEvents.Received, { ...event });

      return { purchaseOrder, received: true };
    });

    if (received) this.outboxRelay.kick();

    this.logger.log(`Purchase order #${id} is now ${purchaseOrder.estado}`);
    return this.toPurchaseOrderResponse(purchaseOrder);
  }

  // Saga step 2 (success). Only acts while the order is EN_VALIDACION, so
  // duplicate deliveries and replies arriving after the timeout are no-ops
  async confirmValidatedOrder({ organization_id, purchaseOrderId }: PurchaseOrderProductValidatedEvent) {
    const { count } = await this.prisma.withTenant(organization_id, (tx) =>
      tx.purchaseOrder.updateMany({
        where: { id: purchaseOrderId, organization_id, estado: StatusPurchaseOrder.EN_VALIDACION },
        data: { estado: StatusPurchaseOrder.PENDIENTE },
      }),
    );

    if (count === 0) {
      this.logger.warn(`Ignoring validation of purchase order #${purchaseOrderId}: it does not exist or was already processed`);
      return false;
    }

    this.logger.log(`Purchase order #${purchaseOrderId} validated`);
    return true;
  }

  // Saga step 2 (failure). Idempotent for the same reasons as confirmValidatedOrder
  async rejectOrder({ organization_id, purchaseOrderId, reason }: PurchaseOrderProductRejectedEvent) {
    const { count } = await this.prisma.withTenant(organization_id, (tx) =>
      tx.purchaseOrder.updateMany({
        where: { id: purchaseOrderId, organization_id, estado: StatusPurchaseOrder.EN_VALIDACION },
        data: { estado: StatusPurchaseOrder.RECHAZADA, motivo: reason },
      }),
    );

    if (count === 0) {
      this.logger.warn(`Ignoring rejection of purchase order #${purchaseOrderId}: it does not exist or was already processed`);
      return false;
    }

    this.logger.log(`Purchase order #${purchaseOrderId} rejected: ${reason}`);
    return true;
  }

  // Persists the order EN_VALIDACION and enqueues purchase-order.created in the caller's transaction
  private async createInTx(tx: Prisma.TransactionClient, data: NewPurchaseOrder) {
    const created = await tx.purchaseOrder.create({
      data: { ...data, estado: StatusPurchaseOrder.EN_VALIDACION },
    });

    const event: PurchaseOrderCreatedEvent = {
      organization_id: created.organization_id,
      purchaseOrderId: created.id,
      producto_id: created.producto_id,
      cantidad_solicitada: created.cantidad_solicitada,
    };
    await this.outbox.enqueue(tx, PurchaseOrderEvents.Created, { ...event });

    return created;
  }

  // proto-loader cannot serialize Date objects, so dates travel as ISO-8601 strings.
  // Nullable columns become undefined so the optional proto fields stay unset
  private toPurchaseOrderResponse(purchaseOrder: PurchaseOrder) {
    return {
      ...purchaseOrder,
      motivo: purchaseOrder.motivo ?? undefined,
      createdAt: purchaseOrder.createdAt.toISOString(),
      updatedAt: purchaseOrder.updatedAt?.toISOString(),
    };
  }
}
