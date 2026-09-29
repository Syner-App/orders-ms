<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

<h1 align="center">orders-ms</h1>

<p align="center">Microservicio de ordenes del proyecto <strong>Syner</strong>, construido con NestJS, gRPC y RabbitMQ.</p>

## Descripción

`orders-ms` es el microservicio encargado de la gestión de órdenes dentro de la arquitectura de microservicios de Syner. Expone su API mediante **gRPC** (sin servidor HTTP), persiste los datos con **Prisma** sobre **PostgreSQL** y valida los productos con `products-ms` mediante una **saga asíncrona** por **RabbitMQ**. No hay llamadas directas entre los dos servicios.

## Saga de órdenes

1. `Create` guarda la orden en `AWAITING_VALIDATION`, junto con el evento `order.created` en la tabla `OutboxEvent` (misma transacción), y responde enseguida.
2. `OutboxRelay` publica los eventos pendientes en el exchange `syner.events`. Si RabbitMQ está caído, los reintenta sin perderlos.
3. `products-ms` responde con `order.products.validated` u `order.products.rejected`.
4. La orden pasa a `PENDING` (con `price`, `name` y `totalAmount`) o a `REJECTED` (con `rejectionReason`).
5. Si no llega respuesta en `ORDER_VALIDATION_TIMEOUT_MS` (5 min por defecto), la orden pasa a `REJECTED` por timeout.

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

