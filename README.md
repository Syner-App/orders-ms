<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

<h1 align="center">orders-ms</h1>

<p align="center">Microservicio de ordenes del proyecto <strong>Syner</strong>, construido con NestJS, gRPC y RabbitMQ.</p>

## Descripción

`orders-ms` es el microservicio de **órdenes de compra** (`PurchaseOrder`, tabla `ordenes_compra`) de Syner. Expone su API mediante **gRPC** (sin servidor HTTP), persiste los datos con **Prisma** sobre **PostgreSQL** y valida el producto con `products-ms` mediante una **saga asíncrona** por **RabbitMQ**. No hay llamadas directas entre los dos servicios: `producto_id` apunta a otra base, así que no tiene `@relation`.

El contrato está en [`src/proto/orders.proto`](src/proto/orders.proto) (`orders.PurchaseOrdersService`): `Create`, `FindAll` (filtro opcional `estado`), `FindOne` y `UpdateStatus`.

## Estados

```
EN_VALIDACION ─(saga: producto válido)──▶ PENDIENTE ─(APROBADA)─▶ APROBADA ─(RECIBIDA)─▶ RECIBIDA
      │                                      │
      └─(saga: producto inválido o timeout)──┴─(RECHAZADA + motivo)─▶ RECHAZADA
```

`UpdateStatus` (`{ id, estado, motivo? }`) solo acepta `APROBADA`, `RECHAZADA` y `RECIBIDA`. `motivo` es obligatorio al rechazar. Una transición que no parte del estado esperado responde `FAILED_PRECONDITION`; repetir el estado actual no hace nada.

## Saga de órdenes de compra

1. `Create` guarda la orden en `EN_VALIDACION`, junto con el evento `purchase-order.created` en la tabla `OutboxEvent` (misma transacción), y responde enseguida.
2. `OutboxRelay` publica los eventos pendientes en el exchange `syner.events`. Si RabbitMQ está caído, los reintenta sin perderlos.
3. `products-ms` responde con `purchase-order.product.validated` o `purchase-order.product.rejected`.
4. La orden pasa a `PENDIENTE` o a `RECHAZADA` (con el `motivo` del rechazo).
5. Si no llega respuesta en `ORDER_VALIDATION_TIMEOUT_MS` (5 min por defecto), la orden pasa a `RECHAZADA` por timeout.
6. Al pasar a `RECIBIDA` se guarda `purchase-order.received` en el outbox (misma transacción) y `products-ms` suma `cantidad_solicitada` al stock.

Los mensajes que no se pueden procesar terminan en `orders.saga-replies.dlq`.

## Puesta en marcha

```bash
docker compose up -d --build   # en la raíz de syner/: todo el stack (ver ../README.md)
# o, para correr este servicio fuera de Docker:
docker compose stop orders-ms
pnpm install
cp .env.template .env       # PORT, DATABASE_URL, RABBITMQ_URL
pnpm prisma migrate dev
pnpm start:dev
```

