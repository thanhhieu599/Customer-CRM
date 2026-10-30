import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsIn,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CustomerQuery } from '../customers/customers.dto';
export class SaveFilterDto {
  @IsString() @MinLength(1) @MaxLength(80) name: string;
  @ValidateNested() @Type(() => CustomerQuery) filters: CustomerQuery;
}
export class BulkCustomersDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique() @IsUUID('all', { each: true }) ids: string[];
  @IsIn(['assign', 'tag', 'task']) action: 'assign' | 'tag' | 'task';
  @ValidateIf((_, value) => value !== undefined) @IsUUID() assigneeId?: string;
  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  tags?: string[];
  @ValidateIf((_, value) => value !== undefined) @IsString() @MinLength(3) @MaxLength(255) title?: string;
  @ValidateIf((_, value) => value !== undefined) @IsDateString() dueAt?: string;
}
export class MergePreviewDto {
  @IsUUID() sourceId: string;
  @IsUUID() targetId: string;
}
export class MergeCustomersDto extends MergePreviewDto {
  @IsString() @MinLength(64) @MaxLength(64) token: string;
}
