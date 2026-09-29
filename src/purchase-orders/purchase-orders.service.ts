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
import type { PurchaseOrder } from '../generated/prisma/client.ts';
import { OutboxService } from '../outbox/outbox.service.ts';
import { OutboxRelay } from '../outbox/outbox.relay.ts';
import {
  PurchaseOrderEvents,
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
  async create({ producto_id, proveedor, cantidad_solicitada, motivo }: CreatePurchaseOrderDto) {
    const purchaseOrder = await this.prisma.$transaction(async (tx) => {
      const created = await tx.purchaseOrder.create({
        data: { producto_id, proveedor, cantidad_solicitada, motivo, estado: StatusPurchaseOrder.EN_VALIDACION },
      });

      const event: PurchaseOrderCreatedEvent = {
        purchaseOrderId: created.id,
        producto_id: created.producto_id,
        cantidad_solicitada: created.cantidad_solicitada,
      };
      await this.outbox.enqueue(tx, PurchaseOrderEvents.Created, { ...event });

      return created;
    });

    this.outboxRelay.kick();

    return this.toPurchaseOrderResponse(purchaseOrder);
  }

  async findAll({ page, limit, estado }: PurchaseOrderPaginationDto) {
    const where = { estado };

    const total = await this.prisma.purchaseOrder.count({ where });

    const purchaseOrders = await this.prisma.purchaseOrder.findMany({
      where,
      take: limit,
      skip: (page! - 1) * limit!,
      orderBy: { createdAt: 'desc' },
    });

    return {
      data: purchaseOrders.map((purchaseOrder) => this.toPurchaseOrderResponse(purchaseOrder)),
      meta: {
        total,
        page,
        lastPage: Math.ceil(total / limit!),
      },
    };
  }

  async findOne(id: string) {
    const purchaseOrder = await this.prisma.purchaseOrder.findUnique({ where: { id } });

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
  async updateStatus({ id, estado, motivo }: UpdatePurchaseOrderStatusDto) {
    const requiredStatus = STATUS_TRANSITIONS[estado];

    const { purchaseOrder, received } = await this.prisma.$transaction(async (tx) => {
      // Conditional update: loses cleanly against a concurrent transition
      const { count } = await tx.purchaseOrder.updateMany({
        where: { id, estado: requiredStatus },
        data: { estado, ...(motivo !== undefined && { motivo }) },
      });

      const purchaseOrder = await tx.purchaseOrder.findUnique({ where: { id } });

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
  async confirmValidatedOrder({ purchaseOrderId }: PurchaseOrderProductValidatedEvent) {
    const { count } = await this.prisma.purchaseOrder.updateMany({
      where: { id: purchaseOrderId, estado: StatusPurchaseOrder.EN_VALIDACION },
      data: { estado: StatusPurchaseOrder.PENDIENTE },
    });

    if (count === 0) {
      this.logger.warn(`Ignoring validation of purchase order #${purchaseOrderId}: it does not exist or was already processed`);
      return false;
    }

    this.logger.log(`Purchase order #${purchaseOrderId} validated`);
    return true;
  }

  // Saga step 2 (failure). Idempotent for the same reasons as confirmValidatedOrder
  async rejectOrder({ purchaseOrderId, reason }: PurchaseOrderProductRejectedEvent) {
    const { count } = await this.prisma.purchaseOrder.updateMany({
      where: { id: purchaseOrderId, estado: StatusPurchaseOrder.EN_VALIDACION },
      data: { estado: StatusPurchaseOrder.RECHAZADA, motivo: reason },
    });

    if (count === 0) {
      this.logger.warn(`Ignoring rejection of purchase order #${purchaseOrderId}: it does not exist or was already processed`);
      return false;
    }

    this.logger.log(`Purchase order #${purchaseOrderId} rejected: ${reason}`);
    return true;
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
