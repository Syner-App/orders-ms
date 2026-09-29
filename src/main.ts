import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.ts';
import { envs } from './config/envs.ts';
import { Logger, ValidationPipe } from '@nestjs/common';
import { MicroserviceOptions, RpcException, Transport } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { join } from 'path';
import { ORDERS_PACKAGE_NAME } from './generated/proto/orders.ts';
import { PrismaExceptionFilter } from './common/index.ts';

async function bootstrap() {
  const logger = new Logger(`Orders-Ms`)
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
    transport: Transport.GRPC,
    options: {
      package: ORDERS_PACKAGE_NAME,
      protoPath: join(import.meta.dirname, 'proto/orders.proto'),
      url: `0.0.0.0:${envs.port}`,
      loader: { enums: String },
    }
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) =>
        new RpcException({
          code: status.INVALID_ARGUMENT,
          message: errors
            .flatMap((error) => Object.values(error.constraints ?? {}))
            .join(', '),
        }),
    })
  )
  app.useGlobalFilters(new PrismaExceptionFilter());

  await app.listen();
  logger.log(`Orders MS (gRPC) listening on port ${envs.port}`)
}
await bootstrap();
