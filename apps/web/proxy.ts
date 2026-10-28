import { NextResponse, type NextRequest } from 'next/server';

/** Optimistic auth check: no cookie → login page. The API still verifies every request. */
export function proxy(request: NextRequest) {
  if (!request.cookies.has('crm_token')) {
    const url = new URL('/login', request.url);
    url.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|login|_next/static|_next/image|favicon.ico).*)'],
};
