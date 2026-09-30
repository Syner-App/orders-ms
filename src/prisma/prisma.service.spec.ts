import { Test, TestingModule } from '@nestjs/testing';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { PrismaService } from './prisma.service.ts';

const organization_id = '6abd26a42d059ac027376ca1';

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();

    service = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('withTenant', () => {
    const tx = { $queryRaw: vi.fn() };
    let transaction: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      vi.resetAllMocks();
      transaction = vi.spyOn(service, '$transaction').mockImplementation(((callback: (tx: unknown) => unknown) =>
        callback(tx)) as never);
    });

    it('scopes the transaction to the organization before running the callback', async () => {
      const callback = vi.fn().mockResolvedValue('result');

      await expect(service.withTenant(organization_id, callback)).resolves.toBe('result');

      const [strings, value] = tx.$queryRaw.mock.calls[0];
      expect(strings.join('?')).toContain("set_config('app.organization_id', ?, true)");
      expect(value).toBe(organization_id);
      expect(callback).toHaveBeenCalledWith(tx);
      expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(callback.mock.invocationCallOrder[0]);
    });

    it.each(['', 'not-an-id', '6ABD26A42D059AC027376CA1', undefined])(
      'rejects the organization id %j with FAILED_PRECONDITION',
      async (invalid) => {
        const error = await service.withTenant(invalid as string, vi.fn()).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(RpcException);
        expect((error as RpcException).getError()).toMatchObject({ code: status.FAILED_PRECONDITION });
        expect(transaction).not.toHaveBeenCalled();
      },
    );
  });
});
