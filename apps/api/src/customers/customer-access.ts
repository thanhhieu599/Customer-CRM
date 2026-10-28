import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, seesAll } from '../common/current-user';
import { Prisma } from '../generated/prisma/client';

/** Where-clause limiting customers to what the user may see. */
export function customerScope(user: AuthUser): Prisma.CustomerWhereInput {
  return seesAll(user) ? { deletedAt: null } : { deletedAt: null, ownerId: user.id };
}

/** Loads a customer id the user may access, or throws 404 / 403. */
export async function assertCustomerAccess(prisma: PrismaService, user: AuthUser, customerId: string) {
  const c = await prisma.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: { id: true, ownerId: true, name: true },
  });
  if (!c) throw new NotFoundException('Không tìm thấy khách hàng');
  if (!seesAll(user) && c.ownerId !== user.id) throw new ForbiddenException('Khách hàng không thuộc phụ trách của bạn');
  return c;
}
