import { Test, TestingModule } from '@nestjs/testing';
import { RmqContext } from '@nestjs/microservices';
import { PurchaseOrdersSagaController } from './purchase-orders-saga.controller.ts';
import { PurchaseOrdersService } from './purchase-orders.service.ts';
import { AlertEvents, PurchaseOrderEvents } from '../common/index.ts';

const purchaseOrderId = '6f1c1c9e-2f5b-4c1a-9a47-6a2b1f3c8d10';
const organization_id = '6abd26a42d059ac027376ca1';

function createContext(pattern: string) {
  const channel = { ack: vi.fn(), nack: vi.fn() };
  const message = { fields: { redelivered: false } };
  return { channel, message, context: new RmqContext([message, channel, pattern]) };
}

describe('PurchaseOrdersSagaController', () => {
  let controller: PurchaseOrdersSagaController;
  const purchaseOrdersService = { confirmValidatedOrder: vi.fn(), rejectOrder: vi.fn(), createFromLowStockAlert: vi.fn() };

  beforeEach(async () => {
    vi.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PurchaseOrdersSagaController],
      providers: [{ provide: PurchaseOrdersService, useValue: purchaseOrdersService }],
    }).compile();

    controller = module.get(PurchaseOrdersSagaController);
  });

  it('confirms the order and acks purchase-order.product.validated', async () => {
    purchaseOrdersService.confirmValidatedOrder.mockResolvedValue(true);
    const { channel, message, context } = createContext(PurchaseOrderEvents.ProductValidated);
    const payload = { organization_id, purchaseOrderId, producto_id: 1 };

    await controller.handleProductValidated(payload, context);

    expect(purchaseOrdersService.confirmValidatedOrder).toHaveBeenCalledWith(payload);
    expect(channel.ack).toHaveBeenCalledWith(message);
  });

  it('acks a duplicated reply that the service ignores', async () => {
    purchaseOrdersService.confirmValidatedOrder.mockResolvedValue(false);
    const { channel, message, context } = createContext(PurchaseOrderEvents.ProductValidated);

    await controller.handleProductValidated({ organization_id, purchaseOrderId, producto_id: 1 }, context);

    expect(channel.ack).toHaveBeenCalledWith(message);
  });

  it('rejects the order and acks purchase-order.product.rejected', async () => {
    purchaseOrdersService.rejectOrder.mockResolvedValue(true);
    const { channel, message, context } = createContext(PurchaseOrderEvents.ProductRejected);

    await controller.handleProductRejected({ organization_id, purchaseOrderId, reason: 'Product #9 not found or inactive' }, context);

    expect(purchaseOrdersService.rejectOrder).toHaveBeenCalledWith({
      organization_id,
      purchaseOrderId,
      reason: 'Product #9 not found or inactive',
    });
    expect(channel.ack).toHaveBeenCalledWith(message);
  });

  it('dead-letters a reply without organization_id', async () => {
    const { channel, message, context } = createContext(PurchaseOrderEvents.ProductValidated);

    await controller.handleProductValidated({ purchaseOrderId, producto_id: 1 }, context);

    expect(purchaseOrdersService.confirmValidatedOrder).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(message, false, false);
  });

  it('dead-letters an invalid payload without calling the service', async () => {
    const { channel, message, context } = createContext(PurchaseOrderEvents.ProductValidated);

    await controller.handleProductValidated({ organization_id, purchaseOrderId, producto_id: 'x' }, context);

    expect(purchaseOrdersService.confirmValidatedOrder).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(message, false, false);
  });

  it('dead-letters the message when processing fails', async () => {
    purchaseOrdersService.rejectOrder.mockRejectedValue(new Error('db down'));
    const { channel, message, context } = createContext(PurchaseOrderEvents.ProductRejected);

    await controller.handleProductRejected({ organization_id, purchaseOrderId, reason: 'nope' }, context);

    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(message, false, false);
  });

  describe('alert.created', () => {
    const payload = {
      organization_id,
      alert: { id: '0b8e2f6a-3c1d-4e5f-8a9b-1c2d3e4f5a6b', product_id: 4, tipo: 'STOCK_BAJO', descripcion: 'Stock bajo' },
      product: { proveedor: 'Lácteos del Valle', stock_minimo: 25 },
    };

    it('opens the purchase order and acks', async () => {
      purchaseOrdersService.createFromLowStockAlert.mockResolvedValue({ id: purchaseOrderId });
      const { channel, message, context } = createContext(AlertEvents.Created);

      await controller.handleAlertCreated(payload, context);

      expect(purchaseOrdersService.createFromLowStockAlert).toHaveBeenCalledWith(payload);
      expect(channel.ack).toHaveBeenCalledWith(message);
    });

    it('dead-letters an alert without the product snapshot', async () => {
      const { channel, message, context } = createContext(AlertEvents.Created);

      await controller.handleAlertCreated({ organization_id, alert: payload.alert }, context);

      expect(purchaseOrdersService.createFromLowStockAlert).not.toHaveBeenCalled();
      expect(channel.nack).toHaveBeenCalledWith(message, false, false);
    });
  });
});
