import { Test, TestingModule } from '@nestjs/testing';
import { OrdersService } from './orders.service.js';
import { PrismaService } from '../prisma/prisma.service.ts';
import { PRODUCTS_SERVICE } from '../config/services.ts';

describe('OrdersService', () => {
  let service: OrdersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: {} },
        { provide: PRODUCTS_SERVICE, useValue: { getService: () => ({}) } },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
