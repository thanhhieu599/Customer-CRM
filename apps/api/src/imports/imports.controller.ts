import { BadRequestException, Controller, Get, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsIn, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { PrismaService } from '../prisma/prisma.service';
import { Roles } from '../common/decorators';
import { AuthUser, CurrentUser } from '../common/current-user';
import { RetentionEngine } from '../retention/retention.engine';
import { ImportsService } from './imports.service';

class ImportQuery {
  /** Source system of the codes in the file. */
  @IsOptional() @IsIn(['csv', 'misa', 'sapo']) system: string = 'csv';
  /** Re-run the retention engine after an orders import. */
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) runEngine?: boolean;
}

const upload = FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } });

@Controller('imports')
@Roles('ADMIN', 'MANAGER')
export class ImportsController {
  constructor(
    private readonly imports: ImportsService,
    private readonly prisma: PrismaService,
    private readonly engine: RetentionEngine,
  ) {}

  @Post('customers')
  @UseInterceptors(upload)
  customers(@UploadedFile() file: Express.Multer.File | undefined, @Query() q: ImportQuery, @CurrentUser() user: AuthUser) {
    return this.imports.importCustomers(this.text(file), q.system, user.id);
  }

  @Post('orders')
  @UseInterceptors(upload)
  async orders(@UploadedFile() file: Express.Multer.File | undefined, @Query() q: ImportQuery, @CurrentUser() user: AuthUser) {
    const report = await this.imports.importOrders(this.text(file), q.system, user.id);
    const engine = q.runEngine ? await this.engine.runDaily() : undefined;
    return { ...report, engine };
  }

  @Get('logs')
  logs() {
    return this.prisma.syncLog.findMany({ orderBy: { startedAt: 'desc' }, take: 50 });
  }

  private text(file?: Express.Multer.File): string {
    if (!file) throw new BadRequestException('Thiếu file CSV (field "file")');
    return file.buffer.toString('utf8');
  }
}
