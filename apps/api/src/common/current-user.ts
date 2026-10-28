import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserRole } from '../generated/prisma/client';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

/** Managers and admins see all customers; agents only their own. */
export function seesAll(user: AuthUser): boolean {
  return user.role === 'ADMIN' || user.role === 'MANAGER';
}
