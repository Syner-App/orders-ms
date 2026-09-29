import { Controller } from '@nestjs/common';
import { GrpcMethod, Payload } from '@nestjs/microservices';
import { OrdersService } from './orders.service.js';
import { CreateOrderDto } from './dto/create-order.dto.js';
import { OrderPaginationDto } from './dto/order-pagination.dto.js';
import { OrderByIdDto } from './dto/order-by-id.dto.js';
import { ChangeOrderStatusDto } from './dto/change-order-status.dto.js';
import { ORDERS_SERVICE_NAME } from '../generated/proto/orders.ts';

@Controller()
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @GrpcMethod(ORDERS_SERVICE_NAME, 'Create')
  create(@Payload() createOrderDto: CreateOrderDto) {
    return this.ordersService.create(createOrderDto);
  }

  @GrpcMethod(ORDERS_SERVICE_NAME, 'FindAll')
  findAll(@Payload() orderPaginationDto: OrderPaginationDto) {
    return this.ordersService.findAll(orderPaginationDto);
  }

  @GrpcMethod(ORDERS_SERVICE_NAME, 'FindOne')
  findOne(@Payload() { id }: OrderByIdDto) {
    return this.ordersService.findOne(id);
  }

  @GrpcMethod(ORDERS_SERVICE_NAME, 'ChangeOrderStatus')
  changeOrderStatus(@Payload() { id, status }: ChangeOrderStatusDto) {
    return this.ordersService.changeOrderStatus(id, status);
  }

}
