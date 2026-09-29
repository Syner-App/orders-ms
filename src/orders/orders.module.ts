import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { join } from 'path';
import { OrdersService } from './orders.service.js';
import { OrdersController } from './orders.controller.js';
import { PrismaService } from '../prisma/prisma.service.ts';
import { envs } from '../config/envs.ts';
import { PRODUCTS_SERVICE } from '../config/services.ts';
import { PRODUCTS_PACKAGE_NAME } from '../generated/proto/products.ts';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: PRODUCTS_SERVICE,
        transport: Transport.GRPC,
        options: {
          package: PRODUCTS_PACKAGE_NAME,
          protoPath: join(import.meta.dirname, '../proto/products.proto'),
          url: `${envs.productsMicroserviceHost}:${envs.productsMicroservicePort}`,
        },
      },
    ]),
  ],
  controllers: [OrdersController],
  providers: [OrdersService, PrismaService],
})
export class OrdersModule {}
