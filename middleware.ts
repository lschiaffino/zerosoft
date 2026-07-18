import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { routing } from './i18n/routing';

const intlMiddleware = createMiddleware(routing);

// Palabras que nunca pueden tratarse como slug corto en la raíz.
// Mantener sincronizada con lib/reserved.ts
const RESERVED = new Set([
  'en', 'es', 'pt',
  'app', 'api', 'auth', 'r',
  'blog', 'products', 'docs', 'terms', 'privacy', 'security', 'status',
  'admin', 'www', 'mail', 'support', 'help', 'about', 'new',
  'login', 'signin', 'demo', 'manifesto',
]);

export default function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Short links en la raíz: un solo segmento (ej. /xK9f2aQ) → rewrite a /r/<slug>
  if (/^\/[A-Za-z0-9_-]{2,32}\/?$/.test(pathname)) {
    const slug = pathname.replace(/\//g, '');
    if (!RESERVED.has(slug.toLowerCase())) {
      return NextResponse.rewrite(new URL(`/r/${slug}`, req.url));
    }
  }

  return intlMiddleware(req);
}

export const config = {
  // Todo excepto: api/, r/ (handler de redirects), internos de Next y archivos estáticos.
  matcher: ['/((?!api/|r/|_next/|_vercel/|.*\\..*).*)'],
};
