import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/current-user';
import { WorkspaceService } from './workspace.service';
import { BulkCustomersDto, MergeCustomersDto, MergePreviewDto, SaveFilterDto } from './workspace.dto';
@Controller()
export class WorkspaceController {
  constructor(private readonly workspace: WorkspaceService) {}
  @Get('workbench') day(@CurrentUser() user: AuthUser) {
    return this.workspace.day(user);
  }
  @Get('saved-filters') filters(@CurrentUser() user: AuthUser) {
    return this.workspace.filters(user);
  }
  @Post('saved-filters') save(@CurrentUser() user: AuthUser, @Body() dto: SaveFilterDto) {
    return this.workspace.saveFilter(user, dto);
  }
  @Delete('saved-filters/:id') remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.workspace.removeFilter(user, id);
  }
  @Post('customers/bulk') bulk(@CurrentUser() user: AuthUser, @Body() dto: BulkCustomersDto) {
    return this.workspace.bulk(user, dto);
  }
  @Get('customer-duplicates') duplicates(@CurrentUser() user: AuthUser) {
    return this.workspace.duplicates(user);
  }
  @Post('customer-duplicates/preview') preview(@CurrentUser() user: AuthUser, @Body() dto: MergePreviewDto) {
    return this.workspace.preview(user, dto);
  }
  @Post('customer-duplicates/merge') merge(@CurrentUser() user: AuthUser, @Body() dto: MergeCustomersDto) {
    return this.workspace.merge(user, dto);
  }
}
