# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`orders-ms` is the orders microservice of the **Syner** project. NestJS 12 **hybrid** app (no HTTP server): it serves its API over **gRPC** and takes part in the order **saga** over **RabbitMQ**. It persists to PostgreSQL via Prisma 7 and never calls `products-ms` directly.

## Commands

Package manager is **pnpm**.

```bash
docker compose up -d --build  # from the syner/ root: whole stack (Postgres, RabbitMQ, all services in watch mode; see syner/README.md)
pnpm start:dev                # run with watch
pnpm build                    # nest build → dist/ (copies **/*.proto as assets)
pnpm lint                     # oxlint --type-aware src/ test/
pnpm format                   # prettier

pnpm test                     # vitest unit tests (**/*.spec.ts)
pnpm vitest run src/orders/orders.service.spec.ts   # single file
pnpm vitest run -t "should be defined"               # by test name
pnpm test:e2e                 # **/*.e2e-spec.ts via vitest.config.e2e.ts

pnpm proto:gen                # regenerate src/generated/proto/*.ts from src/proto/*.proto
pnpm prisma migrate dev       # apply/create migrations (config: prisma7.config.ts)
pnpm prisma generate          # regenerate src/generated/prisma (gitignored — run after clone/schema changes)
```

Env vars (see `.env.template`, validated with Joi in `src/config/envs.ts` at import time — the app throws on startup if missing): `PORT`, `DATABASE_URL`, `RABBITMQ_URL`, plus optional `OUTBOX_POLL_INTERVAL_MS` (1000), `ORDER_VALIDATION_TIMEOUT_MS` (300000) and `SAGA_TIMEOUT_CHECK_INTERVAL_MS` (60000).

## Architecture

**gRPC contract is the source of truth.** `src/proto/orders.proto` is compiled by `ts-proto` (`nestJs=true`, `stringEnums=true`) into `src/generated/proto/orders.ts`; the client-gateway keeps an identical copy. Controllers use the generated `ORDERS_SERVICE_NAME` / `ORDERS_PACKAGE_NAME` constants. After editing the `.proto`, run `pnpm proto:gen` and update DTOs/service to match. Never hand-edit files under `src/generated/`.

**Bootstrap (`main.ts`):** `NestFactory.create` + two `connectMicroservice(..., { inheritAppConfig: true })` calls — gRPC (`loader: { enums: String }` so proto enums arrive as strings matching Prisma's `OrderStatus`) and RMQ (queue `orders.saga-replies`). Global pipes/filters are registered **before** connecting, and `app.init()` runs **before** `startAllMicroservices()` so no message is consumed before lifecycle hooks finish. A global `ValidationPipe` (whitelist + forbidNonWhitelisted + transform) converts failures into `RpcException` with `INVALID_ARGUMENT`. `PrismaExceptionFilter` maps Prisma `P2002` → `ALREADY_EXISTS` and `P2025` → `NOT_FOUND`. Errors must be thrown as `RpcException({ code: status.X, message })` using `@grpc/grpc-js` status codes.

**Order saga (choreography over RabbitMQ):**
1. `OrdersService.create` stores the order as `AWAITING_VALIDATION` (items without price/name, `totalAmount: 0`) and, **in the same `$transaction`**, an `OutboxEvent` `order.created`. The gateway answers 202.
2. `OutboxRelay` (`src/outbox/`) publishes pending outbox rows in id order to the topic exchange `syner.events` (poll interval + `kick()` after each commit). A row is marked `publishedAt` only after the broker confirms; on failure it records `attempts`/`lastError` and stops the batch to keep ordering. Delivery is at-least-once.
3. products-ms validates and replies `order.products.validated` (`{ orderId, products[{id,name,price}] }`) or `order.products.rejected` (`{ orderId, reason }`).
4. `OrdersSagaController` (`@EventPattern<string>(pattern, Transport.RMQ)`) calls `confirmValidatedOrder` (prices items, sets `totalAmount`, → `PENDING`) or `rejectOrder` (→ `REJECTED` + `rejectionReason`). Both only act while the order is still `AWAITING_VALIDATION` (conditional `updateMany`), so duplicates and late replies are no-ops.
5. `OrderValidationTimeoutJob` rejects orders stuck in `AWAITING_VALIDATION` longer than `ORDER_VALIDATION_TIMEOUT_MS` (reason `Product validation timed out`); the timeout wins over a late validation.

`AWAITING_VALIDATION` and `REJECTED` are saga-owned: `changeOrderStatus` throws `FAILED_PRECONDITION` when moving to or from them. Event names/contracts live in `src/common/events/order.events.ts` (duplicated in products-ms — keep them in sync).

**RMQ handler rules:** servers run with `noAck: false`; ack/nack through `rmqMessage(context)` (`src/common/rmq/`). Handlers take the payload as `unknown` and validate it themselves with `parseEvent()` (a failing global pipe would skip the handler and leave the message un-acked). Invalid payloads and processing errors are `nack`ed without requeue → dead-lettered to `orders.saga-replies.dlq` via `syner.dlx` (declared in `syner/rabbitmq/definitions.json`). Use `@EventPattern<string>(...)`: the typed overload in NestJS 12 rejects a typed `@Ctx()` argument.

**Read model:** order items store `price` and `name` as a snapshot taken at validation, so `findOne`/`findAll` never depend on products-ms. Both are `null` (sent as unset optional proto fields) until the order is validated.

**Serialization quirk:** proto-loader can't serialize `Date`, so all responses go through `toOrderResponse()` which converts `createdAt`/`updatedAt`/`paidAt` to ISO strings and nullable columns to `undefined`.

**Prisma 7 setup:** generator `prisma-client` outputs to `src/generated/prisma` (gitignored). `PrismaService` (provided by the global `PrismaModule`) extends `PrismaClient` using the `@prisma/adapter-pg` driver adapter. Datasource URL comes from `prisma7.config.ts`, not the schema.

## Conventions

- ESM project (`"type": "module"`, `module: nodenext`, `rewriteRelativeImportExtensions`). Relative imports must include an extension; both `.ts` and `.js` are used in the codebase. Use `import.meta.dirname` instead of `__dirname`.
- Unit tests use `@nestjs/testing` with mocked `PrismaService` (`$transaction` mocked to run the callback with the same mock), `OutboxService`/`OutboxRelay`, the `ORDERS_EVENTS_CLIENT` proxy, and `new RmqContext([message, channel, pattern])` for RMQ handlers (vitest globals enabled).
- `test/app.e2e-spec.ts` is still the Nest starter and does not typecheck (`supertest/types`).
- README and log messages are partly in Spanish.
