import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { OpportunityStage, QuoteStatus } from '../generated/prisma/client';
import { PageQuery } from '../common/pagination';
export class SalesQuery extends PageQuery {
  @ValidateIf((_, value) => value !== undefined) @IsUUID() customerId?: string;
  @ValidateIf((_, value) => value !== undefined) @IsEnum(OpportunityStage) stage?: OpportunityStage;
  @ValidateIf((_, value) => value !== undefined) @IsString() @MaxLength(200) q?: string;
}
export class CreateOpportunityDto {
  @IsUUID() customerId: string;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  title: string;
  @IsString() @Matches(/^\d{1,12}(\.\d{1,2})?$/) value: string;
  @IsDateString() @Matches(/^\d{4}-\d{2}-\d{2}$/) expectedCloseAt: string;
  @IsDateString() nextActionAt: string;
}
export class UpdateOpportunityDto {
  @IsInt() @Min(1) version: number;
  @ValidateIf((_, value) => value !== undefined) @IsEnum(OpportunityStage) stage?: OpportunityStage;
  @ValidateIf((_, value) => value !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  title?: string;
  @ValidateIf((_, value) => value !== undefined) @IsString() @Matches(/^\d{1,12}(\.\d{1,2})?$/) value?: string;
  @ValidateIf((_, value) => value !== undefined)
  @IsDateString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  expectedCloseAt?: string;
  @ValidateIf((_, value) => value !== undefined) @IsDateString() nextActionAt?: string;
  @ValidateIf((_, value) => value !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  lossReason?: string;
}
export class QuoteLineDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  sku: string;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  productName: string;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  unit: string;
  @IsString() @Matches(/^\d{1,9}(\.\d{1,3})?$/) quantity: string;
  @IsString() @Matches(/^\d{1,12}(\.\d{1,2})?$/) unitPrice: string;
}
export class CreateQuoteDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => QuoteLineDto)
  items: QuoteLineDto[];
  @IsString() @Matches(/^\d{1,12}(\.\d{1,2})?$/) discountAmount: string;
  @IsString() @Matches(/^\d{1,3}(\.\d{1,2})?$/) vatPercent: string;
  @IsDateString() @Matches(/^\d{4}-\d{2}-\d{2}$/) validUntil: string;
  @IsDateString() followUpAt: string;
  @ValidateIf((_, value) => value !== undefined) @IsString() @MaxLength(4000) notes?: string;
}
export class QuoteStatusDto {
  @IsEnum(QuoteStatus) status: QuoteStatus;
}
