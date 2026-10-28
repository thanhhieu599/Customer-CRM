import { Module } from '@nestjs/common';
import { RetentionModule } from '../retention/retention.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

@Module({ imports: [RetentionModule], controllers: [ImportsController], providers: [ImportsService] })
export class ImportsModule {}
