import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status as grpcStatus } from '@grpc/grpc-js';
import { CreateOrderDto } from './dto/create-order.dto.js';
import { OrderPaginationDto } from './dto/order-pagination.dto.js';
import { PrismaService } from '../prisma/prisma.service.ts';
import { OrderStatus } from '../generated/prisma/enums.ts';
import type { Order, OrderItem } from '../generated/prisma/client.ts';
import { OutboxService } from '../outbox/outbox.service.ts';
import { OutboxRelay } from '../outbox/outbox.relay.ts';
import {
  OrderEvents,
  type OrderCreatedEvent,
  type OrderProductsRejectedEvent,
  type OrderProductsValidatedEvent,
} from '../common/index.ts';

type OrderItemRow = Pick<OrderItem, 'productId' | 'quantity' | 'price' | 'name'>;
type OrderWithItems = Order & { OrderItem?: OrderItemRow[] };

const orderItemSelect = {
  productId: true,
  quantity: true,
  price: true,
  name: true,
} as const;

// Statuses owned by the order saga; they cannot be set or left through ChangeOrderStatus
const SAGA_STATUSES: OrderStatus[] = [OrderStatus.AWAITING_VALIDATION, OrderStatus.REJECTED];

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly outboxRelay: OutboxRelay,
  ) { }

  // Saga step 1: persist the order unpriced and announce it. products-ms answers
  // asynchronously with order.products.validated / order.products.rejected
  async create(createOrderDto: CreateOrderDto) {
    const items = createOrderDto.items.map(({ productId, quantity }) => ({ productId, quantity }));
    const totalItems = items.reduce((acc, item) => acc + item.quantity, 0);

    const order = await this.prisma.$transaction(async (tx) => {
      const createdOrder = await tx.order.create({
        data: {
          totalAmount: 0,
          totalItems,
          status: OrderStatus.AWAITING_VALIDATION,
          OrderItem: {
            createMany: { data: items },
          },
        },
        include: { OrderItem: { select: orderItemSelect } },
      });

      const event: OrderCreatedEvent = { orderId: createdOrder.id, items };
      await this.outbox.enqueue(tx, OrderEvents.Created, { ...event });

      return createdOrder;
    });

    this.outboxRelay.kick();

    return this.toOrderResponse(order);
  }

  async findAll(orderPaginationDto: OrderPaginationDto) {
    const { page, limit, status } = orderPaginationDto;

    const totalPage = await this.prisma.order.count({ where: { status } });

    const lastPage = Math.ceil(totalPage / limit!);

    const orders = await this.prisma.order.findMany({
      where: { status },
      take: limit,
      skip: (page! - 1) * limit!,
      orderBy: { createdAt: 'desc' },
    });

    return {
      data: orders.map((order) => this.toOrderResponse(order)),
      meta: {
        total: totalPage,
        page: page,
        lastPage: lastPage,
      }
    }
  }

  async findOne(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { OrderItem: { select: orderItemSelect } },
    });

    if (!order) {
      throw new RpcException({
        code: grpcStatus.NOT_FOUND,
        message: `Order with id: #${id} not found`,
      });
    }

    return this.toOrderResponse(order);
  }

  async changeOrderStatus(id: string, status: OrderStatus) {
    if (SAGA_STATUSES.includes(status)) {
      throw new RpcException({
        code: grpcStatus.FAILED_PRECONDITION,
        message: `Status ${status} is managed by the order saga`,
      });
    }

    const order = await this.findOne(id);

    if (SAGA_STATUSES.includes(order.status)) {
      throw new RpcException({
        code: grpcStatus.FAILED_PRECONDITION,
        message: `Order with id: #${id} is ${order.status} and its status cannot be changed`,
      });
    }

    if (order.status === status) {
      return order;
    }

    const updatedOrder = await this.prisma.order.update({
      where: { id },
      data: { status },
      include: { OrderItem: { select: orderItemSelect } },
    });

    return this.toOrderResponse(updatedOrder);
  }

  // Saga step 2 (success): price the items and move the order to PENDING.
  // Returns false when the order already left AWAITING_VALIDATION (duplicate
  // delivery or validation timeout), making redeliveries harmless
  async confirmValidatedOrder({ orderId, products }: OrderProductsValidatedEvent) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { OrderItem: { select: { id: true, productId: true, quantity: true } } },
      });

      if (!order) {
        throw new Error(`Order #${orderId} does not exist`);
      }
      if (order.status !== OrderStatus.AWAITING_VALIDATION) {
        this.logger.warn(`Ignoring validation of order #${orderId}: it is already ${order.status}`);
        return false;
      }

      const productsById = new Map(products.map((product) => [product.id, product]));
      const pricedItems = order.OrderItem.map((item) => {
        const product = productsById.get(item.productId);
        if (!product) {
          throw new Error(`Validated products for order #${orderId} miss product #${item.productId}`);
        }
        return { ...item, price: product.price, name: product.name };
      });

      const totalAmount = pricedItems.reduce((acc, item) => acc + item.price * item.quantity, 0);

      // Conditional update: loses cleanly against a concurrent timeout/rejection
      const { count } = await tx.order.updateMany({
        where: { id: orderId, status: OrderStatus.AWAITING_VALIDATION },
        data: { status: OrderStatus.PENDING, totalAmount },
      });
      if (count === 0) {
        this.logger.warn(`Ignoring validation of order #${orderId}: it changed status concurrently`);
        return false;
      }

      for (const item of pricedItems) {
        await tx.orderItem.update({
          where: { id: item.id },
          data: { price: item.price, name: item.name },
        });
      }

      this.logger.log(`Order #${orderId} validated (total ${totalAmount})`);
      return true;
    });
  }

  // Saga step 2 (failure). Idempotent for the same reasons as confirmValidatedOrder
  async rejectOrder({ orderId, reason }: OrderProductsRejectedEvent) {
    const { count } = await this.prisma.order.updateMany({
      where: { id: orderId, status: OrderStatus.AWAITING_VALIDATION },
      data: { status: OrderStatus.REJECTED, rejectionReason: reason },
    });

    if (count === 0) {
      this.logger.warn(`Ignoring rejection of order #${orderId}: it does not exist or was already processed`);
      return false;
    }

    this.logger.log(`Order #${orderId} rejected: ${reason}`);
    return true;
  }

  // proto-loader cannot serialize Date objects, so dates travel as ISO-8601 strings.
  // Nullable columns become undefined so the optional proto fields stay unset
  private toOrderResponse({ OrderItem: orderItems, ...order }: OrderWithItems) {
    return {
      ...order,
      rejectionReason: order.rejectionReason ?? undefined,
      paidAt: order.paidAt?.toISOString(),
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      items: orderItems?.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        price: item.price ?? undefined,
        name: item.name ?? undefined,
      })),
    };
  }
}
