import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { routing } from './i18n/routing';
import { isAppHost } from './lib/hosts';
import { surfaceForHost, surfaceRewritePath } from './lib/host-rewrite';
import { requestLocale } from './lib/request-locale';
import { RETURN_PATH_HEADER } from './lib/return-path';
import { quickCreateRedirect } from './lib/quick-create-redirect';
import { DOCS_SITE_HEADER } from './lib/docs-site-header';
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
    // Nadie de afuera puede forzar el tema ni marcar el pedido como de un sitio de Docs.
    if (!req.headers.has(BRAND_HEADER) && !req.headers.has(DOCS_SITE_HEADER)) return req;
    const headers = new Headers(req.headers);
    headers.delete(BRAND_HEADER);
    headers.delete(DOCS_SITE_HEADER);
    return new NextRequest(req, { headers });
  }
  const headers = new Headers(req.headers);
  headers.set(BRAND_HEADER, forced);
  headers.delete(DOCS_SITE_HEADER);
  return new NextRequest(req, { headers });
}

/**
 * Dominio propio del sitio publicado de Docs (lib/docs-site.ts): el
 * middleware no tiene DB, así que pregunta a /api/docs/site/host (sin
 * middleware) por cada host que no es de la app. Solo pasa en dominios
 * propios (los de Link y los de Docs), nunca en zerosoft.ai.
 *
 * Cache por instancia: respuesta con sitio o sin sitio (dominio de Link),
 * 60 s; si el lookup falla o tarda más de 1 s, 10 s como dominio de Link
 * (lo de siempre). Medido en local con next start (2026-10-27, mediana):
 * /api/docs/site/host 3,7 ms; primer pedido a un dominio propio 59 ms (con
 * el lookup), los siguientes 4,9 ms (cacheado, igual que un pedido a la app:
 * 5,7 ms). En Vercel el lookup es otra invocación de función: se paga una vez
 * por host, instancia y minuto. Ver docs/routes-budget.md.
 */
const SITE_TTL_MS = 60_000;
const SITE_FAIL_TTL_MS = 10_000;
const SITE_LOOKUP_TIMEOUT_MS = 1_000;
type SiteHit = { handle: string; locale: string | null } | null;
const siteCache = new Map<string, { until: number; site: SiteHit }>();

async function docsSiteFor(req: NextRequest, host: string): Promise<SiteHit> {
  const now = Date.now();
  const hit = siteCache.get(host);
  if (hit && now < hit.until) return hit.site;
  let site: SiteHit = null;
  let ttl = SITE_TTL_MS;
  try {
    // DOCS_SITE_LOOKUP_ORIGIN: tests y self-host detrás de un proxy (el dominio propio no resuelve a localhost).
    const url = new URL('/api/docs/site/host', process.env.DOCS_SITE_LOOKUP_ORIGIN || req.nextUrl.origin);
    url.searchParams.set('host', host);
    const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(SITE_LOOKUP_TIMEOUT_MS) });
    if (res.ok) site = ((await res.json()) as { site: SiteHit }).site;
    else if (res.status !== 404) ttl = SITE_FAIL_TTL_MS;
  } catch {
    // Sin respuesta a tiempo: se trata como dominio de Link (lo de siempre), por poco tiempo.
    ttl = SITE_FAIL_TTL_MS;
  }
  if (siteCache.size > 500) siteCache.clear();
  siteCache.set(host, { until: now + ttl, site });
  return site;
}

/** docs.empresa.com/<slug> → /<locale>/h/<handle>/<slug> (la raíz es la portada del sitio). */
function docsSiteRewrite(req: NextRequest, site: { handle: string; locale: string | null }): NextResponse | null {
  const { pathname } = req.nextUrl;
  const m = /^\/(?:(en|es|pt)(?:\/|$))?(.*)$/.exec(pathname);
  const rest = (m?.[2] ?? '').replace(/\/+$/, '');
  if (rest.includes('/') || (rest && !/^[A-Za-z0-9_-]{1,200}$/.test(rest))) return null;
  const locale = m?.[1] ?? site.locale ?? requestLocale(req.cookies.get('NEXT_LOCALE')?.value, req.headers.get('accept-language'));
  const url = req.nextUrl.clone();
  url.pathname = `/${locale}/h/${site.handle}${rest ? `/${rest}` : ''}`;
  const headers = new Headers(req.headers);
  headers.set('X-NEXT-INTL-LOCALE', locale);
  headers.set(DOCS_SITE_HEADER, site.handle.toLowerCase());
  return NextResponse.rewrite(url, { request: { headers } });
}

export default async function middleware(incoming: NextRequest) {
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
    const host = (req.headers.get('host') ?? '').toLowerCase().replace(/:\d+$/, '');
    const site = host && !CUSTOM_DOMAIN_PAGES.test(pathname) ? await docsSiteFor(req, host) : null;
    if (site) {
      return docsSiteRewrite(req, site) ?? new NextResponse('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
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
