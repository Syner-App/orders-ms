import type { Prisma } from '../generated/prisma/client.ts';

// auth-ms organization ids are MongoDB ObjectIds
const ORGANIZATION_ID = /^[0-9a-f]{24}$/;

export const isOrganizationId = (value: unknown): value is string =>
  typeof value === 'string' && ORGANIZATION_ID.test(value);

// Scopes the transaction to the organization: the tenant_isolation RLS policies only let
// it see and write rows whose organization_id matches. `true` = local to the transaction,
// so a pooled connection never keeps another request's organization
export async function setTenant(tx: Prisma.TransactionClient, organizationId: string) {
  await tx.$queryRaw`SELECT set_config('app.organization_id', ${organizationId}, true)`;
}
