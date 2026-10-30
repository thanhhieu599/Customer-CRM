import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PageQuery } from '../common/pagination';
import { ContactRole, CustomerSegment, CustomerType, HealthLevel } from '../generated/prisma/client';

export class CustomerQuery extends PageQuery {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsEnum(CustomerSegment) segment?: CustomerSegment;
  @IsOptional() @IsEnum(HealthLevel) healthLevel?: HealthLevel;
  @IsOptional() @IsUUID() ownerId?: string;
  @IsOptional() @IsString() tag?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(3650) lastContactDays?: number;
  @IsOptional() @IsIn(['name', 'healthScore', 'lastOrderAt', 'revenue12m', 'createdAt']) sort?: string;
  @IsOptional() @IsIn(['asc', 'desc']) order?: 'asc' | 'desc';
}

export class CreateCustomerDto {
  @IsString() @MaxLength(50) code: string;
  @IsString() @MaxLength(255) name: string;
  @IsOptional() @IsEnum(CustomerType) type?: CustomerType;
  @IsOptional() @IsString() taxCode?: string;
  @IsOptional() @IsString() industry?: string;
  @IsOptional() @IsIn(['A', 'B', 'C']) tier?: string;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsUUID() ownerId?: string;
  @IsOptional() @IsBoolean() marketingConsent?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) overdueDebtDays?: number;
}

export class UpdateCustomerDto {
  @IsOptional() @IsString() @MaxLength(255) name?: string;
  @IsOptional() @IsEnum(CustomerType) type?: CustomerType;
  @IsOptional() @IsString() taxCode?: string;
  @IsOptional() @IsString() industry?: string;
  @IsOptional() @IsIn(['A', 'B', 'C', null]) tier?: string | null;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsUUID() ownerId?: string | null;
  @IsOptional() @IsBoolean() marketingConsent?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) overdueDebtDays?: number | null;
  @IsOptional() @IsString({ each: true }) tags?: string[];
}

export class ContactDto {
  @IsString() name: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsEnum(ContactRole) role?: ContactRole;
  @IsOptional() @IsBoolean() isDecisionMaker?: boolean;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() zaloId?: string;
  @IsOptional() @IsBoolean() marketingOptOut?: boolean;
}

export class UpdateContactDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsEnum(ContactRole) role?: ContactRole;
  @IsOptional() @IsBoolean() isDecisionMaker?: boolean;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() zaloId?: string;
  @IsOptional() @IsBoolean() marketingOptOut?: boolean;
  /** Mark the contact as having left the customer company. */
  @IsOptional() @IsBoolean() leftCompany?: boolean;
}
