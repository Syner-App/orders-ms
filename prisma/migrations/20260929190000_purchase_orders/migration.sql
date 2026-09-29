-- CreateEnum
CREATE TYPE "StatusPurchaseOrder" AS ENUM ('EN_VALIDACION', 'PENDIENTE', 'APROBADA', 'RECHAZADA', 'RECIBIDA');

-- DropForeignKey
ALTER TABLE "OrderItem" DROP CONSTRAINT "OrderItem_orderId_fkey";

-- DropTable
DROP TABLE "Order";

-- DropTable
DROP TABLE "OrderItem";

-- DropEnum
DROP TYPE "OrderStatus";

-- CreateTable
CREATE TABLE "ordenes_compra" (
    "id" TEXT NOT NULL,
    "estado" "StatusPurchaseOrder" NOT NULL DEFAULT 'EN_VALIDACION',
    "proveedor" VARCHAR NOT NULL,
    "cantidad_solicitada" INTEGER NOT NULL,
    "motivo" VARCHAR,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP,
    "producto_id" INTEGER NOT NULL,

    CONSTRAINT "ordenes_compra_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ordenes_compra_estado_createdAt_idx" ON "ordenes_compra"("estado", "createdAt");

