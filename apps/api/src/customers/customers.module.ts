import { Module } from '@nestjs/common';
import { RetentionModule } from '../retention/retention.module';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

@Module({
  imports: [RetentionModule],
  controllers: [CustomersController],
  providers: [CustomersService],
})
export class CustomersModule {}
