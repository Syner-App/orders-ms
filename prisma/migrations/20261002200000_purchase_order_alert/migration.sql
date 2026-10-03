-- Purchase orders opened automatically from a low stock alert (alert.created from products-ms)

-- AlterTable
ALTER TABLE "ordenes_compra" ADD COLUMN     "alert_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "ordenes_compra_alert_id_key" ON "ordenes_compra"("alert_id");
