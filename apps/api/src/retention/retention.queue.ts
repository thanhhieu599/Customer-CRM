import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { BUSINESS_TZ } from '../common/business-time';
import { RetentionEngine } from './retention.engine';

export const RETENTION_QUEUE = 'retention';

/** Parses REDIS_URL (redis://user:pass@host:port/db) into BullMQ connection options. */
export function redisConnection(url = process.env.REDIS_URL ?? 'redis://localhost:6379') {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname && u.pathname !== '/' ? Number(u.pathname.slice(1)) : 0,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

@Processor(RETENTION_QUEUE, { concurrency: 1 })
export class RetentionProcessor extends WorkerHost {
  private readonly logger = new Logger(RetentionProcessor.name);

  constructor(private readonly engine: RetentionEngine) {
    super();
  }

  async process(job: Job) {
    switch (job.name) {
      case 'daily':
        return this.engine.runDaily();
      case 'sla-check':
        return this.engine.runSlaCheck();
      default:
        this.logger.warn(`unknown job ${job.name}`);
    }
  }
}

/** Registers the repeatable jobs (idempotent: upsert by scheduler id). */
@Injectable()
export class RetentionScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(RetentionScheduler.name);

  constructor(@InjectQueue(RETENTION_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap() {
    if (process.env.SCHEDULER_ENABLED === 'false') return;
    const opts = { attempts: 3, backoff: { type: 'exponential', delay: 60_000 }, removeOnComplete: 100, removeOnFail: 500 };
    await this.queue.upsertJobScheduler('retention-daily', { pattern: '0 1 * * *', tz: BUSINESS_TZ }, { name: 'daily', opts });
    await this.queue.upsertJobScheduler('ticket-sla', { every: 15 * 60_000 }, { name: 'sla-check', opts });
    this.logger.log(`scheduled: daily 01:00 ${BUSINESS_TZ}, SLA check every 15 min`);
  }
}
