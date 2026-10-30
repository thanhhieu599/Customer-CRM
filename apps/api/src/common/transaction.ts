import { ConflictException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
/** Serializable mutations reject stale concurrent writes instead of silently losing data. */
export async function atomic<T>(prisma: PrismaService, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(fn, { isolationLevel: 'Serializable', timeout: 15000 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(e.code)) {
      throw new ConflictException('Dữ liệu vừa thay đổi hoặc bị trùng. Hãy tải lại và thử lại.');
    }
    throw e;
  }
}
