import { Test, TestingModule } from '@nestjs/testing';
import { RmqContext } from '@nestjs/microservices';
import { OrdersSagaController } from './orders-saga.controller.ts';
import { OrdersService } from './orders.service.js';
import { OrderEvents } from '../common/index.ts';

const orderId = '6f1c1c9e-2f5b-4c1a-9a47-6a2b1f3c8d10';

function createContext(pattern: string) {
  const channel = { ack: vi.fn(), nack: vi.fn() };
  const message = { fields: { redelivered: false } };
  return { channel, message, context: new RmqContext([message, channel, pattern]) };
}

describe('OrdersSagaController', () => {
  let controller: OrdersSagaController;
  const ordersService = { confirmValidatedOrder: vi.fn(), rejectOrder: vi.fn() };

  beforeEach(async () => {
    vi.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrdersSagaController],
      providers: [{ provide: OrdersService, useValue: ordersService }],
    }).compile();

    controller = module.get(OrdersSagaController);
  });

  it('confirms the order and acks order.products.validated', async () => {
    ordersService.confirmValidatedOrder.mockResolvedValue(true);
    const { channel, message, context } = createContext(OrderEvents.ProductsValidated);
    const payload = { orderId, products: [{ id: 1, name: 'Keyboard', price: 50 }] };

    await controller.handleProductsValidated(payload, context);

    expect(ordersService.confirmValidatedOrder).toHaveBeenCalledWith(payload);
    expect(channel.ack).toHaveBeenCalledWith(message);
  });

  it('acks a duplicated reply that the service ignores', async () => {
    ordersService.confirmValidatedOrder.mockResolvedValue(false);
    const { channel, message, context } = createContext(OrderEvents.ProductsValidated);

    await controller.handleProductsValidated(
      { orderId, products: [{ id: 1, name: 'Keyboard', price: 50 }] },
      context,
    );

    expect(channel.ack).toHaveBeenCalledWith(message);
  });

  it('rejects the order and acks order.products.rejected', async () => {
    ordersService.rejectOrder.mockResolvedValue(true);
    const { channel, message, context } = createContext(OrderEvents.ProductsRejected);

    await controller.handleProductsRejected({ orderId, reason: 'Products not found or unavailable: #9' }, context);

    expect(ordersService.rejectOrder).toHaveBeenCalledWith({
      orderId,
      reason: 'Products not found or unavailable: #9',
    });
    expect(channel.ack).toHaveBeenCalledWith(message);
  });

  it('dead-letters an invalid payload without calling the service', async () => {
    const { channel, message, context } = createContext(OrderEvents.ProductsValidated);

    await controller.handleProductsValidated({ orderId, products: [{ id: 'x' }] }, context);

    expect(ordersService.confirmValidatedOrder).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(message, false, false);
  });

  it('dead-letters the message when processing fails', async () => {
    ordersService.rejectOrder.mockRejectedValue(new Error('db down'));
    const { channel, message, context } = createContext(OrderEvents.ProductsRejected);

    await controller.handleProductsRejected({ orderId, reason: 'nope' }, context);

    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(message, false, false);
  });
});
