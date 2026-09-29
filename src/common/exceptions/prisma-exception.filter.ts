import { ArgumentsHost, Catch } from '@nestjs/common';
import { BaseRpcExceptionFilter, RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Prisma } from '../../generated/prisma/client.js';

interface UniqueConstraintMeta {
  modelName?: string;
  target?: string[];
  driverAdapterError?: { cause?: { constraint?: { fields?: string[] } } };
}

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter extends BaseRpcExceptionFilter {
  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    switch (exception.code) {
      case 'P2002': {
        const meta = exception.meta as UniqueConstraintMeta | undefined;
        const fields =
          meta?.driverAdapterError?.cause?.constraint?.fields ?? meta?.target ?? [];
        return super.catch(
          new RpcException({
            code: status.ALREADY_EXISTS,
            message: `${meta?.modelName ?? 'Record'} with the same ${fields.join(', ') || 'unique field'} already exists`,
          }),
          host,
        );
      }
      case 'P2025':
        return super.catch(
          new RpcException({ code: status.NOT_FOUND, message: 'Record not found' }),
          host,
        );
      default:
        return super.catch(exception, host);
    }
  }
}
