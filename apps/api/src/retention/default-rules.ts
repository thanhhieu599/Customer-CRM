import { AutomationTrigger } from '../generated/prisma/client';

export interface RuleDefinition {
  key: string;
  name: string;
  trigger: AutomationTrigger;
  config: Record<string, unknown>;
}

/**
 * Default rules – created on first start, then editable in the database / API.
 * All rules create TASKS for people (no automatic messages to customers in V1).
 * maxTasksPerRun protects against a flood of tasks right after the first import.
 */
export const DEFAULT_RULES: RuleDefinition[] = [
  {
    key: 'no-order-for-cycle',
    name: 'Khách quá chu kỳ mua chưa quay lại',
    trigger: 'NO_ORDER_FOR_CYCLE',
    config: { cycleMultiplier: 1.3, fallbackCycleDays: 45, minDays: 21, maxDays: 365, dueInDays: 1, maxTasksPerRun: 30 },
  },
  {
    key: 'reorder-due',
    name: 'Sắp đến hạn đặt hàng lại (theo mã hàng)',
    trigger: 'REORDER_DUE',
    config: { dueSoonDays: 7, minConfidence: 'medium', dueInDays: 0, maxTasksPerRun: 50 },
  },
  {
    key: 'post-delivery',
    name: 'Hỏi thăm sau giao hàng',
    trigger: 'POST_DELIVERY',
    config: { daysAfterDelivery: 3, lookbackDays: 7, minOrderAmount: 20_000_000, maxTasksPerRun: 30 },
  },
  {
    key: 'vip-no-contact',
    name: 'Khách VIP lâu chưa được chăm sóc',
    trigger: 'VIP_NO_CONTACT',
    config: { days: 30, dueInDays: 2, maxTasksPerRun: 20 },
  },
  {
    key: 'health-at-risk',
    name: 'Khách rơi vào nhóm nguy cơ rời bỏ',
    trigger: 'HEALTH_AT_RISK',
    config: { dueInDays: 2, maxTasksPerRun: 20 },
  },
  {
    key: 'ticket-sla-breach',
    name: 'Ticket quá hạn phản hồi (SLA)',
    trigger: 'TICKET_SLA_BREACH',
    config: { notifyManagers: true },
  },
];
