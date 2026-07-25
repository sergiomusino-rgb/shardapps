import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// ============================================================================
// Proxy - No access control for /admin (handled by client-side layout)
// ============================================================================

export async function proxy(request: NextRequest) {
  const response = NextResponse.next();
  const pathname = request.nextUrl.pathname;

  // Disabilita la cache per dashboard
  if (request.nextUrl.pathname.startsWith('/dashboard') ||
      request.nextUrl.pathname.startsWith('/admin') ||
      request.nextUrl.pathname.startsWith('/management')) {
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');
  }

  return response;
}

// ============================================================================
// Config
// ============================================================================

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/admin/:path*',
    '/management/:path*',
  ],
};
