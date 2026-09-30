# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`orders-ms` is the purchase orders microservice of the **Syner** project (`PurchaseOrder`, table `ordenes_compra`). NestJS 12 **hybrid** app (no HTTP server): it serves its API over **gRPC** and takes part in the purchase order **saga** over **RabbitMQ**. It persists to PostgreSQL via Prisma 7 and never calls `products-ms` directly.

## Commands

Package manager is **pnpm**.

```bash
docker compose up -d --build  # from the syner/ root: whole stack (Postgres, RabbitMQ, all services in watch mode; see syner/README.md)
pnpm start:dev                # run with watch
pnpm build                    # nest build → dist/ (copies **/*.proto as assets)
pnpm lint                     # oxlint --type-aware src/ test/
pnpm format                   # prettier

pnpm test                     # vitest unit tests (**/*.spec.ts)
pnpm vitest run src/purchase-orders/purchase-orders.service.spec.ts   # single file
pnpm vitest run -t "should be defined"               # by test name
pnpm test:e2e                 # **/*.e2e-spec.ts via vitest.config.e2e.ts

pnpm proto:gen                # regenerate src/generated/proto/*.ts from src/proto/*.proto
pnpm prisma migrate dev       # apply/create migrations (config: prisma7.config.ts)
pnpm prisma generate          # regenerate src/generated/prisma (gitignored — run after clone/schema changes)
```

Env vars (see `.env.template`, validated with Joi in `src/config/envs.ts` at import time — the app throws on startup if missing): `PORT`, `DATABASE_URL` (the app role `orders_app`, no superuser, so RLS applies), `RABBITMQ_URL`, plus optional `OUTBOX_POLL_INTERVAL_MS` (1000), `ORDER_VALIDATION_TIMEOUT_MS` (300000) and `SAGA_TIMEOUT_CHECK_INTERVAL_MS` (60000).

## Architecture

**gRPC contract is the source of truth.** `src/proto/orders.proto` (package `orders`, service `PurchaseOrdersService`) is compiled by `ts-proto` (`nestJs=true`, `stringEnums=true`, `snakeToCamel=false`) into `src/generated/proto/orders.ts`; the client-gateway keeps an identical copy. Controllers use the generated `PURCHASE_ORDERS_SERVICE_NAME` / `ORDERS_PACKAGE_NAME` constants. After editing the `.proto`, run `pnpm proto:gen` and update DTOs/service to match. Never hand-edit files under `src/generated/`.

**Bootstrap (`main.ts`):** `NestFactory.create` + two `connectMicroservice(..., { inheritAppConfig: true })` calls — gRPC (`loader: { keepCase: true, enums: String }` so fields stay snake_case and proto enums arrive as strings matching Prisma's `StatusPurchaseOrder`) and RMQ (queue `orders.saga-replies`). Global pipes/filters are registered **before** connecting, and `app.init()` runs **before** `startAllMicroservices()` so no message is consumed before lifecycle hooks finish. A global `ValidationPipe` (whitelist + forbidNonWhitelisted + transform) converts failures into `RpcException` with `INVALID_ARGUMENT`. `PrismaExceptionFilter` maps Prisma `P2002` → `ALREADY_EXISTS` and `P2025` → `NOT_FOUND`. Errors must be thrown as `RpcException({ code: status.X, message })` using `@grpc/grpc-js` status codes.

**Multitenancy:** every purchase order belongs to an auth-ms organization (`organization_id`, a 24-hex Mongo ObjectId). Every gRPC request and every saga event carries it (the gateway sets it from the verified token; DTOs and events validate it with `@IsMongoId()`). Two barriers:
- The service runs every tenant query through `PrismaService.withTenant(organization_id, tx => ...)`, a transaction that first runs `set_config('app.organization_id', ..., true)` (`src/prisma/tenant.ts`), and it also filters explicitly (`where: { id, organization_id, ... }`). An order of another organization is `NOT_FOUND`, like a missing one.
- The `tenant_isolation` RLS policy on `ordenes_compra` (migration `*_multitenancy`, `FORCE ROW LEVEL SECURITY`) hides and rejects rows of any other organization. Superusers bypass RLS, so the service must never connect as `postgres`; the Prisma CLI (`prisma7.config.ts`) prefers `MIGRATE_DATABASE_URL` (the owner). Prisma does not model policies or functions: keep them in hand-written migration SQL.
- `outbox_events` has no RLS (the relay publishes every organization's events; the payload carries the organization). The saga timeout spans all organizations through the `SECURITY DEFINER` function `expire_stale_purchase_orders(cutoff, reason)`, owned by the migration role.

**Purchase order saga (choreography over RabbitMQ):**
1. `PurchaseOrdersService.create` stores the order as `EN_VALIDACION` and, **in the same `$transaction`**, an `OutboxEvent` `purchase-order.created` (`{ organization_id, purchaseOrderId, producto_id, cantidad_solicitada }`). The gateway answers 202.
2. `OutboxRelay` (`src/outbox/`) publishes pending outbox rows in id order to the topic exchange `syner.events` (poll interval + `kick()` after each commit). A row is marked `publishedAt` only after the broker confirms; on failure it records `attempts`/`lastError` and stops the batch to keep ordering. Delivery is at-least-once.
3. products-ms validates that the product exists, is active and belongs to the same organization, and replies `purchase-order.product.validated` (`{ organization_id, purchaseOrderId, producto_id }`) or `purchase-order.product.rejected` (`{ organization_id, purchaseOrderId, reason }`).
4. `PurchaseOrdersSagaController` (`@EventPattern<string>(pattern, Transport.RMQ)`) calls `confirmValidatedOrder` (→ `PENDIENTE`) or `rejectOrder` (→ `RECHAZADA`, `motivo` = reason). Both only act while the order is still `EN_VALIDACION` (conditional `updateMany`), so duplicates and late replies are no-ops.
5. `PurchaseOrderValidationTimeoutJob` rejects orders of every organization stuck in `EN_VALIDACION` longer than `ORDER_VALIDATION_TIMEOUT_MS` (motivo `Product validation timed out`) by calling `expire_stale_purchase_orders`; the timeout wins over a late validation.
6. `updateStatus` handles the manual transitions `PENDIENTE → APROBADA | RECHAZADA` and `APROBADA → RECIBIDA` (map `STATUS_TRANSITIONS`, conditional `updateMany`; a wrong source state → `FAILED_PRECONDITION`, repeating the current state is a no-op). `UpdatePurchaseOrderStatusDto` only accepts those three targets and requires `motivo` for `RECHAZADA` (`@ValidateIf`). `RECIBIDA` enqueues `purchase-order.received` (`{ organization_id, purchaseOrderId, producto_id, cantidad }`) in the same transaction; products-ms adds the stock idempotently.

`EN_VALIDACION` and `PENDIENTE` are saga-owned targets. Event names/contracts live in `src/common/events/purchase-order.events.ts` (duplicated in products-ms — keep them in sync).

**RMQ handler rules:** servers run with `noAck: false`; ack/nack through `rmqMessage(context)` (`src/common/rmq/`). Handlers take the payload as `unknown` and validate it themselves with `parseEvent()` (a failing global pipe would skip the handler and leave the message un-acked). Invalid payloads and processing errors are `nack`ed without requeue → dead-lettered to `orders.saga-replies.dlq` via `syner.dlx` (declared in `syner/rabbitmq/definitions.json`). Use `@EventPattern<string>(...)`: the typed overload in NestJS 12 rejects a typed `@Ctx()` argument.

**Serialization quirk:** proto-loader can't serialize `Date`, so all responses go through `toPurchaseOrderResponse()` which converts `createdAt`/`updatedAt` to ISO strings and nullable columns (`motivo`, `updatedAt`) to `undefined`.

**Prisma 7 setup:** generator `prisma-client` outputs to `src/generated/prisma` (gitignored). `PrismaService` (`src/prisma/prisma.service.ts`, no `PrismaModule`: `OutboxModule` provides and exports it, so `PurchaseOrdersModule` shares the same instance through its `OutboxModule` import) extends `PrismaClient` using the `@prisma/adapter-pg` driver adapter. Datasource URL comes from `prisma7.config.ts`, not the schema.

## Conventions

- ESM project (`"type": "module"`, `module: nodenext`, `rewriteRelativeImportExtensions`). Relative imports must include an extension; both `.ts` and `.js` are used in the codebase. Use `import.meta.dirname` instead of `__dirname`.
- Unit tests use `@nestjs/testing` with mocked `PrismaService` (`withTenant` mocked to run the callback with the same mock), `OutboxService`/`OutboxRelay`, the `ORDERS_EVENTS_CLIENT` proxy, and `new RmqContext([message, channel, pattern])` for RMQ handlers (vitest globals enabled).
- `test/app.e2e-spec.ts` is still the Nest starter and does not typecheck (`supertest/types`).
- README and log messages are partly in Spanish.
