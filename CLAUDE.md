# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`orders-ms` is the orders microservice of the **Syner** project. NestJS 12 app that exposes its API **only over gRPC** (no HTTP server), persists to PostgreSQL via Prisma 7, and calls `products-ms` over gRPC as a client.

## Commands

Package manager is **pnpm**.

```bash
docker compose up -d          # Postgres on :5432 (db: ordersdb, data in ./postgres)
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

Env vars (see `.env.template`, validated with Joi in `src/config/envs.ts` at import time — the app throws on startup if missing): `PORT`, `DATABASE_URL`, `PRODUCTS_MICROSERVICE_HOST`, `PRODUCTS_MICROSERVICE_PORT`.

## Architecture

**gRPC contract is the source of truth.** `src/proto/orders.proto` (served) and `src/proto/products.proto` (consumed) are compiled by `ts-proto` (`nestJs=true`, `stringEnums=true`) into `src/generated/proto/`. Controllers use the generated `ORDERS_SERVICE_NAME` / `PRODUCTS_SERVICE_NAME` / `*_PACKAGE_NAME` constants and client interfaces. After editing a `.proto`, run `pnpm proto:gen` and update DTOs/service to match. Never hand-edit files under `src/generated/`.

**Request flow:** `main.ts` creates a gRPC microservice (`loader: { enums: String }` so proto enums arrive as strings matching Prisma's `OrderStatus`). A global `ValidationPipe` (whitelist + forbidNonWhitelisted + transform) validates payloads against class-validator DTOs in `src/orders/dto/` and converts failures into `RpcException` with `INVALID_ARGUMENT`. `PrismaExceptionFilter` (global) maps Prisma `P2002` → `ALREADY_EXISTS` and `P2025` → `NOT_FOUND`. Errors must be thrown as `RpcException({ code: status.X, message })` using `@grpc/grpc-js` status codes.

**Cross-service dependency:** `OrdersModule` registers a gRPC client under the `PRODUCTS_SERVICE` token (`src/config/services.ts`). `OrdersService.validateProducts()` calls products-ms to validate IDs and fetch price/name; it re-wraps client errors as `RpcException` so the original gRPC code propagates. Orders store only `productId`, `quantity`, and `price` — product `name` is fetched from products-ms at read time (`withProductNames`), so `findOne` also calls products-ms.

**Serialization quirk:** proto-loader can't serialize `Date`, so all responses go through `toOrderResponse()` which converts `createdAt`/`updatedAt`/`paidAt` to ISO strings (proto fields are `string`).

**Prisma 7 setup:** generator `prisma-client` outputs to `src/generated/prisma` (gitignored). `PrismaService` extends `PrismaClient` using the `@prisma/adapter-pg` driver adapter. Datasource URL comes from `prisma7.config.ts`, not the schema.

## Conventions

- ESM project (`"type": "module"`, `module: nodenext`, `rewriteRelativeImportExtensions`). Relative imports must include an extension; both `.ts` and `.js` are used in the codebase. Use `import.meta.dirname` instead of `__dirname`.
- Unit tests use `@nestjs/testing` with mocked `PrismaService` and `PRODUCTS_SERVICE` providers (vitest globals enabled).
- README and log messages are partly in Spanish.
