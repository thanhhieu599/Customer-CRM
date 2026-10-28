import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ReorderService } from './reorder.service';
import { RetentionEngine } from './retention.engine';
import { RetentionController } from './retention.controller';
import { RETENTION_QUEUE, RetentionProcessor, RetentionScheduler, redisConnection } from './retention.queue';

@Module({
  imports: [
    BullModule.forRoot({ connection: redisConnection() }),
    BullModule.registerQueue({ name: RETENTION_QUEUE }),
  ],
  controllers: [RetentionController],
  providers: [ReorderService, RetentionEngine, RetentionProcessor, RetentionScheduler],
  exports: [ReorderService, RetentionEngine],
})
export class RetentionModule {}
