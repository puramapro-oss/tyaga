import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { marketplaceLoginReturn } from '@/lib/marketplace-filters';

const PUBLIC_PATHS = [
  '/',
  '/login',
  '/signup',
  '/forgot-password',
  '/privacy',
  '/terms',
  '/legal',
  '/offline',
];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/legal/') ||
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico' ||
    pathname === '/robots.txt' ||
    // Routes metadata générées (icon.tsx / apple-icon.tsx / opengraph-image.tsx)
    // — publiques : favicon + aperçu OG visités sans session.
    pathname === '/icon' ||
    pathname === '/apple-icon' ||
    pathname === '/opengraph-image'
  );
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema: process.env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA || 'tyaga' },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Rafraîchit la session (obligatoire @supabase/ssr) + récupère l'utilisateur.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!isPublic(pathname) && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    const returnPath = pathname === '/marketplace' ? marketplaceLoginReturn(request.nextUrl.searchParams) : pathname;
    url.searchParams.set('next', returnPath);
    return NextResponse.redirect(url);
  }

  if (user && (pathname === '/login' || pathname === '/signup')) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)',
  ],
};
