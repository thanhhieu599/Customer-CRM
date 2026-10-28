import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { Roles } from '../common/decorators';
import { AuthUser, CurrentUser } from '../common/current-user';
import { AuditService } from '../audit/audit.service';
import { UserRole } from '../generated/prisma/client';

class CreateUserDto {
  @IsEmail() email: string;
  @IsString() name: string;
  @IsString() @MinLength(8) password: string;
  @IsEnum(UserRole) role: UserRole;
}

class UpdateUserDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsEnum(UserRole) role?: UserRole;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() @MinLength(8) password?: string;
}

const publicFields = { id: true, email: true, name: true, role: true, isActive: true, createdAt: true } as const;

@Controller('users')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Everyone can list users (to assign tasks / owners). */
  @Get()
  list() {
    return this.prisma.user.findMany({ select: publicFields, orderBy: { name: 'asc' } });
  }

  @Post()
  @Roles('ADMIN')
  async create(@Body() dto: CreateUserDto, @CurrentUser() me: AuthUser) {
    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase().trim(),
        name: dto.name,
        role: dto.role,
        passwordHash: await bcrypt.hash(dto.password, 10),
      },
      select: publicFields,
    });
    await this.audit.log({ userId: me.id, action: 'create', entityType: 'User', entityId: user.id, changes: { email: user.email, role: user.role } });
    return user;
  }

  @Patch(':id')
  @Roles('ADMIN')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto, @CurrentUser() me: AuthUser) {
    const { password, ...rest } = dto;
    const user = await this.prisma.user.update({
      where: { id },
      data: { ...rest, ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}) },
      select: publicFields,
    });
    await this.audit.log({ userId: me.id, action: 'update', entityType: 'User', entityId: id, changes: { ...rest, password: password ? '***' : undefined } });
    return user;
  }
}
