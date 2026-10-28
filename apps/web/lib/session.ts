'use client';
import useSWR from 'swr';
import { fetcher } from './api';

export interface Me {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'MANAGER' | 'AGENT';
}

export function useMe() {
  const { data, isLoading } = useSWR<{ user: Me }>('/auth/me', fetcher);
  const me = data?.user;
  return { me, isLoading, isManager: me?.role === 'ADMIN' || me?.role === 'MANAGER', isAdmin: me?.role === 'ADMIN' };
}

export interface UserLite {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
}

export function useUsers() {
  return useSWR<UserLite[]>('/users', fetcher).data ?? [];
}
