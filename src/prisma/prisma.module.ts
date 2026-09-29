import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.ts';

// Global so OrdersModule and OutboxModule share one connection pool
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
