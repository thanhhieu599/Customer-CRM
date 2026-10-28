import { Controller, Get, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Roles } from '../common/decorators';
import { PageQuery, paged, skipTake } from '../common/pagination';

@Controller('audit-logs')
@Roles('ADMIN')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Query() q: PageQuery) {
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, name: true } } },
        ...skipTake(q),
      }),
      this.prisma.auditLog.count(),
    ]);
    return paged(items, total, q);
  }
}
