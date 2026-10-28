import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { IsBoolean, IsObject, IsOptional } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { Roles } from '../common/decorators';
import { AuthUser, CurrentUser } from '../common/current-user';
import { AuditService } from '../audit/audit.service';
import { PageQuery, paged, skipTake } from '../common/pagination';
import { Prisma } from '../generated/prisma/client';
import { RetentionEngine } from './retention.engine';

class UpdateRuleDto {
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsObject() config?: Record<string, unknown>;
}

@Controller('retention')
@Roles('ADMIN', 'MANAGER')
export class RetentionController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: RetentionEngine,
    private readonly audit: AuditService,
  ) {}

  /** Run the daily engine now (e.g. right after importing data). */
  @Post('run')
  async run(@CurrentUser() user: AuthUser) {
    const summary = await this.engine.runDaily();
    const sla = await this.engine.runSlaCheck();
    await this.audit.log({ userId: user.id, action: 'run', entityType: 'RetentionEngine', changes: { summary, sla } });
    return { ...summary, sla };
  }

  @Get('rules')
  async rules() {
    await this.engine.ensureRules();
    return this.prisma.automationRule.findMany({
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { executions: true } } },
    });
  }

  @Patch('rules/:key')
  @Roles('ADMIN')
  async updateRule(@CurrentUser() user: AuthUser, @Param('key') key: string, @Body() dto: UpdateRuleDto) {
    const rule = await this.prisma.automationRule.findUnique({ where: { key } });
    if (!rule) throw new NotFoundException();
    const updated = await this.prisma.automationRule.update({
      where: { key },
      data: {
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.config && { config: { ...(rule.config as object), ...dto.config } as Prisma.InputJsonValue }),
      },
    });
    await this.audit.log({ userId: user.id, action: 'update', entityType: 'AutomationRule', entityId: rule.id, changes: dto });
    return updated;
  }

  @Get('executions')
  async executions(@Query() q: PageQuery) {
    const [items, total] = await Promise.all([
      this.prisma.automationExecution.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          rule: { select: { key: true, name: true } },
          customer: { select: { id: true, name: true } },
          task: { select: { id: true, title: true, status: true } },
        },
        ...skipTake(q),
      }),
      this.prisma.automationExecution.count(),
    ]);
    return paged(items, total, q);
  }
}
