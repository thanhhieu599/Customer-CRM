import { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from './badge';
import { HEALTH } from '@/lib/labels';

export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-8 text-center text-sm text-muted-foreground">{children}</div>;
}

export function Loading() {
  return <div className="py-8 text-center text-sm text-muted-foreground">Đang tải…</div>;
}

export function ErrorBox({ error }: { error: unknown }) {
  return <div className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{(error as Error)?.message ?? 'Có lỗi xảy ra'}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Health score pill: number + level colour. */
export function HealthPill({ score, level, className }: { score: number | null; level: string | null; className?: string }) {
  if (score === null || score === undefined) return <span className="text-xs text-muted-foreground">—</span>;
  const h = HEALTH[level ?? ''] ?? { label: '', tone: 'slate' as const };
  return (
    <Badge tone={h.tone} className={cn('tabular-nums', className)} title={h.label}>
      {score}
    </Badge>
  );
}
