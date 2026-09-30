import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../generated/prisma/client.js';
import { envs } from '../config/envs.ts';
import { isOrganizationId, setTenant } from './tenant.ts';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy {

  private readonly logger = new Logger(`PrismaService`);
  constructor() {
    const adapter = new PrismaPg({
      connectionString: envs.databaseUrl,
    });
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log(`Database connected`);
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log(`Database disconnect`);
  }

  // Runs `fn` in a transaction scoped to the organization (RLS). Every tenant query goes
  // through here; the service still filters by organization_id explicitly as well
  async withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    if (!isOrganizationId(organizationId)) {
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message: 'A valid organization_id is required',
      });
    }

    return this.$transaction(async (tx) => {
      await setTenant(tx, organizationId);
      return fn(tx);
    });
  }
}
