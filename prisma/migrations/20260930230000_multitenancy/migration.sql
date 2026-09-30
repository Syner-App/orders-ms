-- Multitenancy: every purchase order belongs to an organization (auth-ms). The table is
-- empty when this runs (the stack starts from clean volumes), so the NOT NULL column needs
-- no backfill

-- AlterTable
ALTER TABLE "ordenes_compra" ADD COLUMN     "organization_id" VARCHAR(24) NOT NULL;

-- CreateIndex
CREATE INDEX "ordenes_compra_organization_id_estado_createdAt_idx" ON "ordenes_compra"("organization_id", "estado", "createdAt");

-- Row Level Security: the second barrier behind the organization_id filters in the service.
-- PrismaService.withTenant() runs every query inside a transaction that sets
-- app.organization_id; without it (or for another organization) no row is visible or
-- writable. FORCE applies the policy to the table owner too; superusers still bypass it,
-- so the service connects with a dedicated role (postgres-init/app-role.sh in the syner root).
-- outbox_events has no RLS: OutboxRelay publishes the events of every organization
ALTER TABLE "ordenes_compra" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ordenes_compra" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ordenes_compra"
    USING ("organization_id" = current_setting('app.organization_id', true))
    WITH CHECK ("organization_id" = current_setting('app.organization_id', true));

-- Purchase order saga timeout (PurchaseOrderValidationTimeoutJob): rejects the orders of
-- every organization stuck in EN_VALIDACION since before `cutoff`. SECURITY DEFINER runs it
-- as the owner (the migration role, a superuser), which bypasses RLS, so the service needs
-- no cross-tenant access of its own. It can only apply this one transition
CREATE FUNCTION "expire_stale_purchase_orders"("cutoff" TIMESTAMP, "reason" TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    expired INTEGER;
BEGIN
    UPDATE "ordenes_compra"
    SET "estado" = 'RECHAZADA', "motivo" = "reason", "updatedAt" = CURRENT_TIMESTAMP
    WHERE "estado" = 'EN_VALIDACION' AND "createdAt" < "cutoff";
    GET DIAGNOSTICS expired = ROW_COUNT;
    RETURN expired;
END;
$$;
