import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError } from '@/lib/api-auth';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { getLinkForHost, isExpired, isLimitReached, linkShortUrl, type LinkWithDomain } from '@/lib/links';
import { matchDeferredClick } from '@/lib/link-deferred';
import { parseTargeting } from '@/lib/link-targeting';
import { workspaceOfPublishableKey } from '@/lib/link-publishable';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  /** Plataforma del dispositivo que abre la app. */
  platform: z.enum(['ios', 'android']),
  /** Dominio de tus links (go.empresa.com, o el de zerosoft): limita la coincidencia a ese dominio. */
  domain: z.string().max(253).optional(),
  /** Si la app se abrió con un link (universal/app link), ese link: se resuelve directo. */
  deepLink: z.string().max(2000).optional(),
});

/**
 * Lo que puede ver la app del link: las mismas puertas que el redirect.
 * Archivado, bloqueado, vencido o sin clicks: no hay nada (null). Con
 * contraseña: solo el link corto, sin destino ni deep link.
 */
function payload(link: LinkWithDomain, platform: 'ios' | 'android', clickId: string | null, matched: 'deep_link' | 'deferred') {
  if (link.archived === 1 || link.safety === 'blocked' || isExpired(link) || isLimitReached(link)) return null;
  const protectedLink = Boolean(link.password_hash);
  const t = parseTargeting(link.targeting);
  const app = platform === 'ios' ? t?.ios : t?.android;
  return {
    matched,
    clickId,
    link: {
      id: link.id,
      shortLink: linkShortUrl(link),
      url: protectedLink ? null : link.url,
      deepLink: protectedLink ? null : (app?.app ?? null),
      protected: protectedLink,
    },
  };
}

const noMatch = () => NextResponse.json({ matched: null, link: null }, { status: 404 });

/**
 * Deep linking diferido. Lo llama la app desde el teléfono con la
 * publishable key del workspace (Authorization: Bearer zs_pk_…), nunca con
 * una API key. Con `deepLink`, resuelve ese link corto si es del workspace;
 * sin él, la visita de la última hora desde esta IP y plataforma en un link
 * del workspace (hash, de un solo uso).
 */
export async function POST(req: NextRequest) {
  const raw = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() || req.headers.get('x-publishable-key');
  const ip = clientIp(req);
  const ws = await workspaceOfPublishableKey(raw);
  if (!ws) {
    // Keys inválidas: tope por IP para que no se puedan probar a fuerza bruta.
    if (process.env.RATE_LIMIT_DISABLED !== 'true' && !(await rateLimit(`links-open-invalid:${ip}`, 20, 60)).ok) {
      return apiError(429, 'rate_limited', 'Too many invalid keys.');
    }
    return apiError(401, 'invalid_key', 'Send the workspace publishable key: Authorization: Bearer zs_pk_…');
  }
  // Por key (todas las instalaciones de la app) y por key + IP.
  if (process.env.RATE_LIMIT_DISABLED !== 'true') {
    const [perKey, perIp] = await Promise.all([
      rateLimit(`links-open:${ws}`, 600, 60),
      rateLimit(`links-open:${ws}:${ip}`, 20, 60),
    ]);
    if (!perKey.ok || !perIp.ok) return apiError(429, 'rate_limited', 'Too many requests.');
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, 'invalid_input', 'platform must be "ios" or "android".');
  const { platform, domain, deepLink } = parsed.data;

  if (deepLink) {
    let u: URL;
    try {
      u = new URL(deepLink);
    } catch {
      return apiError(400, 'invalid_input', 'deepLink must be a short link URL.');
    }
    let slug = '';
    try {
      slug = decodeURIComponent(u.pathname.replace(/^\/(r\/)?/, '').replace(/\/$/, ''));
    } catch {
      return noMatch();
    }
    const link = slug ? await getLinkForHost(u.host, slug) : undefined;
    if (!link || link.user_id !== ws) return noMatch();
    const body = payload(link, platform, null, 'deep_link');
    return body ? NextResponse.json(body) : noMatch();
  }

  const match = await matchDeferredClick({ ws, ip, platform, domain: domain ?? null });
  if (!match) return noMatch();
  const link = (await getDb()
    .prepare('SELECT l.*, d.hostname AS domain_hostname FROM links l LEFT JOIN link_domains d ON d.id = l.domain_id WHERE l.id = ? AND l.user_id = ?')
    .get(match.linkId, ws)) as LinkWithDomain | undefined;
  const body = link ? payload(link, platform, match.clickId, 'deferred') : null;
  return body ? NextResponse.json(body) : noMatch();
}
