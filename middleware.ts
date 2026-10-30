import createMiddleware from 'next-intl/middleware';
import { getToken } from 'next-auth/jwt';
import { NextRequest, NextResponse } from 'next/server';
import { routing } from './i18n/routing';
import { isAppHost } from './lib/hosts';
import { surfaceForHost, surfaceRewritePath } from './lib/host-rewrite';
import { requestLocale } from './lib/request-locale';
import { API_PATH_HEADER, RETURN_PATH_HEADER } from './lib/return-path';
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
  'feedback-board', 'brand', 'nuevo-branding', 'download', 'store',
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
 * 60 s; si el lookup falla o tarda más de 1 s, un host que ya se sabía de
 * Docs sigue de Docs 5 min (último valor bueno) y uno desconocido va 10 s como
 * dominio de Link (lo de siempre). LRU de 500 hosts. Medido en local con next start (2026-10-27, mediana):
 * /api/docs/site/host 3,7 ms; primer pedido a un dominio propio 59 ms (con
 * el lookup), los siguientes 4,9 ms (cacheado, igual que un pedido a la app:
 * 5,7 ms). En Vercel el lookup es otra invocación de función: se paga una vez
 * por host, instancia y minuto. Ver docs/routes-budget.md.
 */
const SITE_TTL_MS = 60_000;
const SITE_FAIL_TTL_MS = 10_000;
const SITE_LOOKUP_TIMEOUT_MS = 1_000;
/** Último valor bueno de un host de Docs cuando el lookup falla. */
const SITE_STALE_TTL_MS = 5 * 60_000;
const SITE_CACHE_MAX = 500;
type SiteHit = { handle: string; locale: string | null } | null;
const siteCache = new Map<string, { until: number; site: SiteHit }>();

async function docsSiteFor(req: NextRequest, host: string): Promise<SiteHit> {
  const now = Date.now();
  const hit = siteCache.get(host);
  if (hit && now < hit.until) {
    // LRU: lo usado recién pasa al final (se descarta lo más viejo).
    siteCache.delete(host);
    siteCache.set(host, hit);
    return hit.site;
  }
  let site: SiteHit = null;
  let ttl = SITE_TTL_MS;
  let failed = false;
  try {
    // DOCS_SITE_LOOKUP_ORIGIN: tests y self-host detrás de un proxy (el dominio propio no resuelve a localhost).
    const url = new URL('/api/docs/site/host', process.env.DOCS_SITE_LOOKUP_ORIGIN || req.nextUrl.origin);
    url.searchParams.set('host', host);
    const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(SITE_LOOKUP_TIMEOUT_MS) });
    if (res.ok) site = ((await res.json()) as { site: SiteHit }).site;
    else if (res.status !== 404) failed = true;
  } catch {
    failed = true;
  }
  if (failed) {
    // Si el lookup falla, un host que se sabía de Docs sigue siendo de Docs
    // (último valor bueno, por más tiempo); uno desconocido va como Link, por poco.
    if (hit?.site) {
      site = hit.site;
      ttl = SITE_STALE_TTL_MS;
    } else ttl = SITE_FAIL_TTL_MS;
  }
  siteCache.delete(host);
  siteCache.set(host, { until: now + ttl, site });
  // LRU simple: el Map guarda el orden de inserción; fuera lo más viejo.
  while (siteCache.size > SITE_CACHE_MAX) {
    const oldest = siteCache.keys().next().value;
    if (oldest === undefined) break;
    siteCache.delete(oldest);
  }
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
  // APIs de las apps: solo el path en un header interno (siempre pisado), para
  // el acceso por app de un workspace ajeno (lib/session.ts).
  if (incoming.nextUrl.pathname.startsWith('/api/')) {
    const headers = new Headers(incoming.headers);
    headers.set(API_PATH_HEADER, incoming.nextUrl.pathname);
    return NextResponse.next({ request: { headers } });
  }
  // Tiendas de Shop (/store/<handle>/…): sin locale en la URL (el idioma es el
  // de la tienda) y solo en el dominio de la app; un dominio propio de Link o
  // de Docs no sirve la tienda de nadie.
  if (incoming.nextUrl.pathname.startsWith('/store/')) {
    if (isAppHost(incoming.headers.get('host'))) return NextResponse.next();
    return new NextResponse('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
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

  return withWhoCookie(req, await intlMiddleware(withReturnPath(req)));
}

/**
 * Cookie zs_who (no httpOnly) en las páginas de la app: un hash de la persona
 * de la sesión, que se va con ella. El service worker (public/sw.js) solo
 * sirve vistas guardadas si zs_who es la de quien las guardó: una sesión
 * vencida, cerrada o de otra persona no ve lo de nadie sin conexión.
 */
async function withWhoCookie(req: NextRequest, res: NextResponse): Promise<NextResponse> {
  if (!/^\/(en|es|pt)\/app(\/|$)/.test(req.nextUrl.pathname)) return res;
  // Modo demo (lib/session.ts DEMO_MODE): todos son el usuario demo, sin JWT.
  const demo = process.env.DEMO_MODE === 'true' && (process.env.NODE_ENV !== 'production' || process.env.DEMO_MODE_ALLOW_PRODUCTION === 'true');
  const token = demo ? { sub: 'demo-mode' } : await getToken({ req, secret: process.env.NEXTAUTH_SECRET }).catch(() => null);
  const current = req.cookies.get(WHO_COOKIE)?.value;
  if (!token?.sub) {
    if (current) res.cookies.delete(WHO_COOKIE);
    return res;
  }
  const data = new TextEncoder().encode(`${process.env.NEXTAUTH_SECRET ?? ''}|zs_who|${token.sub}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  const who = Array.from(digest.slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
  // Siempre: así vence con la sesión (30 días desde la última visita, como el JWT).
  res.cookies.set(WHO_COOKIE, who, { path: '/', maxAge: 30 * 24 * 60 * 60, sameSite: 'lax', secure: req.nextUrl.protocol === 'https:' });
  return res;
}

const WHO_COOKIE = 'zs_who';

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
  // Las APIs de las apps entran solo para el header de acceso por app (arriba).
  matcher: [
    '/((?!api/|r/|s/|_next/|_vercel/|apple-icon|.*\\..*).*)',
    '/api/:family(crm|track|docs|notes|board|boards|links|calendar|chat|groups|agents|flow|robots|voice|rec|talk|design|shop)/:path*',
  ],
};
