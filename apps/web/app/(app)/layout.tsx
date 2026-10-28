'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { Bell, ClipboardList, LayoutDashboard, LifeBuoy, LogOut, Settings, Upload, Users } from 'lucide-react';
import { api, fetcher } from '@/lib/api';
import { useMe } from '@/lib/session';
import { ROLE } from '@/lib/labels';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/dashboard', label: 'Tổng quan', icon: LayoutDashboard },
  { href: '/tasks', label: 'Việc cần làm', icon: ClipboardList },
  { href: '/customers', label: 'Khách hàng', icon: Users },
  { href: '/tickets', label: 'Ticket / Khiếu nại', icon: LifeBuoy },
  { href: '/imports', label: 'Nhập dữ liệu', icon: Upload, manager: true },
  { href: '/settings', label: 'Cấu hình', icon: Settings, manager: true },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { me, isManager } = useMe();
  const { data: notes } = useSWR<{ unread: number }>('/notifications', fetcher, { refreshInterval: 60_000 });

  async function logout() {
    await api('/auth/logout', 'POST');
    router.replace('/login');
  }

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r bg-card md:flex">
        <div className="px-4 py-4">
          <div className="text-sm font-semibold">Customer Care CRM</div>
          <div className="text-xs text-muted-foreground">Giữ chân khách hàng chủ động</div>
        </div>
        <nav className="flex-1 space-y-0.5 px-2">
          {NAV.filter((n) => !n.manager || isManager).map((n) => {
            const active = pathname === n.href || pathname.startsWith(`${n.href}/`);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm',
                  active ? 'bg-primary/10 font-medium text-primary' : 'text-foreground/80 hover:bg-muted',
                )}
              >
                <n.icon className="h-4 w-4" />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t p-3 text-xs">
          <div className="font-medium">{me?.name ?? '…'}</div>
          <div className="text-muted-foreground">{me ? ROLE[me.role] : ''}</div>
          <button onClick={logout} className="mt-2 inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
            <LogOut className="h-3.5 w-3.5" /> Đăng xuất
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-12 items-center justify-between gap-3 border-b bg-card/90 px-4 backdrop-blur">
          <nav className="flex gap-3 overflow-x-auto text-sm md:hidden">
            {NAV.filter((n) => !n.manager || isManager).map((n) => (
              <Link key={n.href} href={n.href} className={cn('whitespace-nowrap', pathname.startsWith(n.href) && 'font-semibold text-primary')}>
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/tasks?view=overdue" className="relative rounded-md p-2 hover:bg-muted" aria-label="Thông báo">
              <Bell className="h-4 w-4" />
              {!!notes?.unread && (
                <span className="absolute -right-0.5 -top-0.5 rounded-full bg-rose-600 px-1.5 text-[10px] font-semibold text-white">{notes.unread}</span>
              )}
            </Link>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
