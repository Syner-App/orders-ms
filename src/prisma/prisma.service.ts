
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { envs } from '../config/envs.ts';

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
}
