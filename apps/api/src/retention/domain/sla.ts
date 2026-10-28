export type PriorityLevel = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

/** Response deadline (calendar hours) by ticket priority. */
export const SLA_HOURS: Record<PriorityLevel, number> = {
  URGENT: 4,
  HIGH: 8,
  NORMAL: 24,
  LOW: 72,
};

export function slaDueAt(openedAt: Date, priority: PriorityLevel = 'NORMAL'): Date {
  return new Date(openedAt.getTime() + SLA_HOURS[priority] * 3_600_000);
}
