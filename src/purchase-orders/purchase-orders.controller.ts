import { Controller } from '@nestjs/common';
import { GrpcMethod, Payload } from '@nestjs/microservices';
import { PurchaseOrdersService } from './purchase-orders.service.ts';
import {
  CreatePurchaseOrderDto,
  PurchaseOrderByIdDto,
  PurchaseOrderPaginationDto,
  UpdatePurchaseOrderStatusDto,
} from './dto/index.ts';
import { PURCHASE_ORDERS_SERVICE_NAME } from '../generated/proto/orders.ts';

@Controller()
export class PurchaseOrdersController {
  constructor(private readonly purchaseOrdersService: PurchaseOrdersService) {}

  @GrpcMethod(PURCHASE_ORDERS_SERVICE_NAME, 'Create')
  create(@Payload() createPurchaseOrderDto: CreatePurchaseOrderDto) {
    return this.purchaseOrdersService.create(createPurchaseOrderDto);
  }

  @GrpcMethod(PURCHASE_ORDERS_SERVICE_NAME, 'FindAll')
  findAll(@Payload() purchaseOrderPaginationDto: PurchaseOrderPaginationDto) {
    return this.purchaseOrdersService.findAll(purchaseOrderPaginationDto);
  }

  @GrpcMethod(PURCHASE_ORDERS_SERVICE_NAME, 'FindOne')
  findOne(@Payload() { id }: PurchaseOrderByIdDto) {
    return this.purchaseOrdersService.findOne(id);
  }

  @GrpcMethod(PURCHASE_ORDERS_SERVICE_NAME, 'UpdateStatus')
  updateStatus(@Payload() updatePurchaseOrderStatusDto: UpdatePurchaseOrderStatusDto) {
    return this.purchaseOrdersService.updateStatus(updatePurchaseOrderStatusDto);
  }
}
