import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import type { ClientGrpc } from '@nestjs/microservices';
import { status as grpcStatus } from '@grpc/grpc-js';
import { firstValueFrom } from 'rxjs';
import { CreateOrderDto } from './dto/create-order.dto.js';
import { OrderPaginationDto } from './dto/order-pagination.dto.js';
import { PrismaService } from '../prisma/prisma.service.ts';
import { OrderStatus } from '../generated/prisma/enums.ts';
import { PRODUCTS_SERVICE } from '../config/services.ts';
import {
  PRODUCTS_SERVICE_NAME,
  type Product,
  type ProductsServiceClient,
} from '../generated/proto/products.ts';
import type { Order, OrderItem } from '../generated/prisma/client.ts';

type OrderItemRow = Pick<OrderItem, 'productId' | 'quantity' | 'price'>;

const orderItemSelect = {
  productId: true,
  quantity: true,
  price: true,
} as const;

@Injectable()
export class OrdersService implements OnModuleInit {
  private productsService: ProductsServiceClient;

  constructor(
    private prisma: PrismaService,
    @Inject(PRODUCTS_SERVICE) private readonly productsClient: ClientGrpc,
  ) { }

  onModuleInit() {
    this.productsService =
      this.productsClient.getService<ProductsServiceClient>(PRODUCTS_SERVICE_NAME);
  }

  async create(createOrderDto: CreateOrderDto) {
    const { items } = createOrderDto;

    const products = await this.validateProducts(
      items.map((item) => item.productId),
    );
    const productsById = new Map(
      products.map((product) => [product.id, product]),
    );

    const orderItems = items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      price: productsById.get(item.productId)!.price,
    }));

    const totalAmount = orderItems.reduce(
      (acc, item) => acc + item.price * item.quantity,
      0,
    );
    const totalItems = orderItems.reduce((acc, item) => acc + item.quantity, 0);

    const order = await this.prisma.order.create({
      data: {
        totalAmount,
        totalItems,
        status: OrderStatus.PENDING,
        OrderItem: {
          createMany: { data: orderItems },
        },
      },
      include: { OrderItem: { select: orderItemSelect } },
    });

    const { OrderItem: orderItemRows, ...createdOrder } = order;

    return this.toOrderResponse({
      ...createdOrder,
      items: this.withProductNames(orderItemRows, productsById),
    });
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

    const { OrderItem: orderItemRows, ...foundOrder } = order;

    const products = orderItemRows.length
      ? await this.validateProducts(orderItemRows.map((item) => item.productId))
      : [];

    return this.toOrderResponse({
      ...foundOrder,
      items: this.withProductNames(
        orderItemRows,
        new Map(products.map((product) => [product.id, product])),
      ),
    });
  }

  async changeOrderStatus(id: string, status: OrderStatus) {
    const order = await this.findOne(id);

    if (order.status === status) {
      return order;
    }

    const updatedOrder = await this.prisma.order.update({
      where: { id },
      data: { status },
    });

    return this.toOrderResponse(updatedOrder);
  }

  // Re-throw client errors as RpcException so the original gRPC code
  // (e.g. INVALID_ARGUMENT) reaches the caller instead of UNKNOWN
  private async validateProducts(ids: number[]): Promise<Product[]> {
    try {
      const { data } = await firstValueFrom(
        this.productsService.validateProducts({ ids }),
      );
      return data;
    } catch (error: any) {
      throw new RpcException({
        code: error?.code ?? grpcStatus.INTERNAL,
        message: error?.details ?? error?.message ?? 'Error validating products',
      });
    }
  }

  // Orders MS only stores productId; the name comes from products-ms
  private withProductNames(
    orderItems: OrderItemRow[],
    productsById: Map<number, Product>,
  ) {
    return orderItems.map((orderItem) => ({
      ...orderItem,
      name: productsById.get(orderItem.productId)!.name,
    }));
  }

  // proto-loader cannot serialize Date objects, so dates travel as ISO-8601 strings
  private toOrderResponse<T extends Order>(order: T) {
    return {
      ...order,
      paidAt: order.paidAt?.toISOString(),
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    };
  }
}
