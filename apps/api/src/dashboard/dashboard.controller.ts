import { Controller, Get, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/current-user';
import { DashboardService } from './dashboard.service';

class DashboardQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(7) @Max(365) period = 30;
}

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  get(@CurrentUser() user: AuthUser, @Query() q: DashboardQuery) {
    return this.dashboard.get(user, q.period);
  }
}
