import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Never throws – an audit failure must not break the business action. */
  async log(params: {
    userId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    changes?: unknown;
    ip?: string | null;
  }): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: params.userId ?? null,
          action: params.action,
          entityType: params.entityType,
          entityId: params.entityId ?? null,
          changes: (params.changes ?? undefined) as Prisma.InputJsonValue | undefined,
          ip: params.ip ?? null,
        },
      });
    } catch (e) {
      this.logger.error(`audit log failed: ${(e as Error).message}`);
    }
  }
}
