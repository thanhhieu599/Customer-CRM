import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuthUser, CurrentUser } from '../common/current-user';
import { SalesService } from './sales.service';
import { CreateOpportunityDto, CreateQuoteDto, QuoteStatusDto, SalesQuery, UpdateOpportunityDto } from './sales.dto';
import { quotePdf } from './quote-pdf';
@Controller()
export class SalesController {
  constructor(private readonly sales: SalesService) {}
  @Get('opportunities') list(@CurrentUser() user: AuthUser, @Query() q: SalesQuery) {
    return this.sales.list(user, q);
  }
  @Post('opportunities') create(@CurrentUser() user: AuthUser, @Body() dto: CreateOpportunityDto) {
    return this.sales.create(user, dto);
  }
  @Get('opportunities/:id') get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sales.get(user, id);
  }
  @Patch('opportunities/:id') update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOpportunityDto,
  ) {
    return this.sales.update(user, id, dto);
  }
  @Post('opportunities/:id/quotes') quote(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateQuoteDto,
  ) {
    return this.sales.createQuote(user, id, dto);
  }
  @Patch('quotes/:id/status') status(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: QuoteStatusDto,
  ) {
    return this.sales.quoteStatus(user, id, dto);
  }
  @Get('quotes/:id/pdf') async pdf(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const quote = await this.sales.quote(user, id);
    const pdf = await quotePdf(quote);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${quote.number}.pdf"`,
      'Cache-Control': 'private, no-store',
    });
    res.send(pdf);
  }
}
