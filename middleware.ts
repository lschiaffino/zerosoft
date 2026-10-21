import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { routing } from './i18n/routing';
import { isAppHost } from './lib/hosts';
import { surfaceForHost, surfaceRewritePath } from './lib/host-rewrite';
import { requestLocale } from './lib/request-locale';
import { RETURN_PATH_HEADER } from './lib/return-path';
import { quickCreateRedirect } from './lib/quick-create-redirect';
import { BRAND_COOKIE, BRAND_HEADER, BRAND_PARAM, DEFAULT_BRAND, forcedBrandForPath, isBrandTheme } from './lib/brand-theme';

const intlMiddleware = createMiddleware(routing);

// Palabras que nunca pueden tratarse como slug corto en la raíz.
// Mantener sincronizada con lib/reserved.ts
const RESERVED = new Set([
  'en', 'es', 'pt',
  'app', 'api', 'auth', 'r', 's', 'n', 'b', 'q', 'f', 'h',
  'blog', 'products', 'docs', 'terms', 'privacy', 'security', 'status',
  'admin', 'www', 'mail', 'support', 'help', 'about', 'new',
  'login', 'signin', 'demo', 'manifesto', 'changelog', 'feedback', 'videos', 'roadmap', 'tools',
  'feedback-board', 'brand', 'nuevo-branding',
]);

/** Páginas de la app que un dominio propio sí sirve: la puerta de contraseña y /gone. */
const CUSTOM_DOMAIN_PAGES = /^\/(en|es|pt)\/(gate\/[A-Za-z0-9_-]{1,64}|gone)\/?$/;

/**
 * ?brand=<tema> guarda el tema de marca en la cookie zs_brand (?brand=default
 * la borra) y redirige a la misma URL sin el parámetro: el layout lee la
 * cookie en el request siguiente. Un valor desconocido se ignora.
 */
function brandSwitch(req: NextRequest): NextResponse | null {
  const value = req.nextUrl.searchParams.get(BRAND_PARAM);
  if (value == null || !isAppHost(req.headers.get('host'))) return null;
  const url = req.nextUrl.clone();
  url.searchParams.delete(BRAND_PARAM);
  const res = NextResponse.redirect(url, 307);
  const brand = value.trim().toLowerCase();
  if (!isBrandTheme(brand)) return res;
  if (brand === DEFAULT_BRAND) {
    res.cookies.delete(BRAND_COOKIE);
  } else {
    res.cookies.set(BRAND_COOKIE, brand, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  }
  return res;
}

/** Rutas que fuerzan un tema (p. ej. /brand): lo pasan al layout por header. */
function withForcedBrand(req: NextRequest): NextRequest {
  const forced = forcedBrandForPath(req.nextUrl.pathname);
  if (!forced) {
    // Nadie de afuera puede forzar el tema con el header interno.
    if (!req.headers.has(BRAND_HEADER)) return req;
    const headers = new Headers(req.headers);
    headers.delete(BRAND_HEADER);
    return new NextRequest(req, { headers });
  }
  const headers = new Headers(req.headers);
  headers.set(BRAND_HEADER, forced);
  return new NextRequest(req, { headers });
}

export default function middleware(incoming: NextRequest) {
  const switched = brandSwitch(incoming);
  if (switched) return switched;
  const req = withForcedBrand(incoming);
  const { pathname } = req.nextUrl;

  // Subdominios de superficie (feedback.zerosoft.ai → board público,
  // branding.zerosoft.ai → /brand): todo path se reescribe bajo el prefijo con
  // el locale del path, o el de la cookie NEXT_LOCALE / Accept-Language. Va
  // antes de las reglas de dominios propios y de short links: acá no aplican.
  const surface = surfaceForHost(req.headers.get('host'));
  if (surface) {
    const fallback = requestLocale(req.cookies.get('NEXT_LOCALE')?.value, req.headers.get('accept-language'));
    const target = surfaceRewritePath(surface, pathname, fallback);
    const url = req.nextUrl.clone();
    url.pathname = target.path;
    const headers = new Headers(req.headers);
    // next-intl lee el locale de este header (lo pone su propio middleware).
    headers.set('X-NEXT-INTL-LOCALE', target.locale);
    // El tema se resuelve con el path final (branding.zerosoft.ai → /brand: default).
    const forced = forcedBrandForPath(target.path);
    if (forced) headers.set(BRAND_HEADER, forced);
    return NextResponse.rewrite(url, { request: { headers } });
  }

  // Dominio propio de Link (go.empresa.com): todo /<algo> es un link corto,
  // sin palabras reservadas. La raíz se resuelve en /r/__root (redirect
  // configurado del dominio). Además solo se sirven la puerta y /gone: el
  // resto de la app (bio, booking, formularios, el sitio) no puede salir
  // bajo el dominio de un cliente.
  if (!isAppHost(req.headers.get('host'))) {
    if (pathname === '/' || pathname === '') {
      return NextResponse.rewrite(new URL('/r/__root', req.url));
    }
    if (/^\/[A-Za-z0-9_-]{1,64}\/?$/.test(pathname) && !/^\/(en|es|pt)\/?$/.test(pathname)) {
      return NextResponse.rewrite(new URL(`/r/${pathname.replace(/\//g, '')}${req.nextUrl.search}`, req.url));
    }
    if (!CUSTOM_DOMAIN_PAGES.test(pathname)) {
      return new NextResponse('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
  }

  // Link-in-bio: /@handle → /<locale>/bio/<handle> (Next no admite "@" al
  // inicio de un segmento dinámico: es la sintaxis de parallel routes).
  const bio = /^\/@([a-z0-9][a-z0-9-]{1,30}[a-z0-9])\/?$/i.exec(pathname);
  if (bio && isAppHost(req.headers.get('host'))) {
    const cookie = req.cookies.get('NEXT_LOCALE')?.value;
    const locale = cookie && ['en', 'es', 'pt'].includes(cookie) ? cookie : 'en';
    return NextResponse.rewrite(new URL(`/${locale}/bio/${bio[1].toLowerCase()}`, req.url));
  }

  // Short links en la raíz: un solo segmento (ej. /xK9f2aQ) → rewrite a /r/<slug>
  if (/^\/[A-Za-z0-9_-]{2,32}\/?$/.test(pathname)) {
    const slug = pathname.replace(/\//g, '');
    if (!RESERVED.has(slug.toLowerCase())) {
      return NextResponse.rewrite(new URL(`/r/${slug}${req.nextUrl.search}`, req.url));
    }
  }

  // /new de las altas que son un modal: 307 a la lista con ?new=1 (ver lib/quick-create-redirect.ts).
  const quick = quickCreateRedirect(pathname, req.nextUrl.search);
  if (quick) return NextResponse.redirect(new URL(quick, req.url), 307);

  return intlMiddleware(withReturnPath(req));
}

/**
 * Path + query de la request en un header interno: si la página pide login,
 * requireUser lo usa como ?callbackUrl= (también desde los layouts, que no
 * reciben el path). Siempre se pisa: nadie de afuera puede fijarlo.
 */
function withReturnPath(req: NextRequest): NextRequest {
  const headers = new Headers(req.headers);
  headers.delete(RETURN_PATH_HEADER);
  if (/^\/(en|es|pt)\/app(\/|$)/.test(req.nextUrl.pathname)) {
    headers.set(RETURN_PATH_HEADER, `${req.nextUrl.pathname}${req.nextUrl.search}`);
  } else if (!req.headers.has(RETURN_PATH_HEADER)) {
    return req;
  }
  return new NextRequest(req, { headers });
}

export const config = {
  // Todo excepto: api/, r/ (handler de redirects), s/ (social preview), internos de Next y archivos estáticos.
  matcher: ['/((?!api/|r/|s/|_next/|_vercel/|apple-icon|.*\\..*).*)'],
};
