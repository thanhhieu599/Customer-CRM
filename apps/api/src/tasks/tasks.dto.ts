import { IsBoolean, IsDateString, IsEnum, IsIn, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { PageQuery } from '../common/pagination';
import { ActivityOutcome, Priority, TaskStatus, TaskType } from '../generated/prisma/client';

export class TaskQuery extends PageQuery {
  /** mine (default for agents) | all (managers) | <userId> */
  @IsOptional() @IsString() assignee?: string;
  @IsOptional() @IsEnum(TaskStatus) status?: TaskStatus;
  @IsOptional() @IsIn(['overdue', 'today', 'week', 'open']) view?: 'overdue' | 'today' | 'week' | 'open';
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsEnum(TaskType) type?: TaskType;
}

export class CreateTaskDto {
  @IsString() @MinLength(3) title: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsEnum(TaskType) type?: TaskType;
  @IsOptional() @IsEnum(Priority) priority?: Priority;
  @IsDateString() dueAt: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() ticketId?: string;
  @IsOptional() @IsUUID() assigneeId?: string;
}

export class UpdateTaskDto {
  @IsOptional() @IsString() @MinLength(3) title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsEnum(Priority) priority?: Priority;
  @IsOptional() @IsEnum(TaskStatus) status?: TaskStatus;
  @IsOptional() @IsDateString() dueAt?: string;
  @IsOptional() @IsUUID() assigneeId?: string;
}

export class CompleteTaskDto {
  @IsString() @MinLength(3) result: string;
  /** Also log the result on the customer timeline (default true). */
  @IsOptional() @Transform(({ value }) => value !== false && value !== 'false') @IsBoolean() logActivity?: boolean = true;
  @IsOptional() @IsIn(['CALL', 'EMAIL', 'ZALO', 'MEETING', 'VISIT', 'NOTE']) activityType?: 'CALL' | 'EMAIL' | 'ZALO' | 'MEETING' | 'VISIT' | 'NOTE';
  @IsOptional() @IsEnum(ActivityOutcome) outcome?: ActivityOutcome;
}
