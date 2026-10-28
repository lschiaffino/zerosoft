import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError } from '@/lib/api-auth';
import { clientIp, limitByIp } from '@/lib/rate-limit';
import { getLinkForHost, linkShortUrl, type LinkWithDomain } from '@/lib/links';
import { matchDeferredClick } from '@/lib/link-deferred';
import { parseTargeting } from '@/lib/link-targeting';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  /** Plataforma del dispositivo que abre la app. */
  platform: z.enum(['ios', 'android']),
  /** Dominio propio de tus links (go.empresa.com): limita la coincidencia a ese dominio. */
  domain: z.string().max(253).optional(),
  /** Si la app se abrió con un link (universal/app link), ese link: se resuelve directo. */
  deepLink: z.string().max(2000).optional(),
});

function payload(link: LinkWithDomain, platform: 'ios' | 'android', clickId: string | null, matched: 'deep_link' | 'deferred') {
  const t = parseTargeting(link.targeting);
  const app = platform === 'ios' ? t?.ios : t?.android;
  return {
    matched,
    clickId,
    link: {
      id: link.id,
      shortLink: linkShortUrl(link),
      url: link.url,
      deepLink: app?.app ?? null,
    },
  };
}

/**
 * Deep linking diferido (sin API key: lo llama la app desde el teléfono).
 * Con `deepLink`, resuelve ese link corto; sin él, busca la visita de la
 * última hora desde esta IP y plataforma (hash, se usa una sola vez).
 */
export async function POST(req: NextRequest) {
  const limited = await limitByIp(req, 'links-track-open', 30, 60);
  if (limited) return limited;
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
    const slug = decodeURIComponent(u.pathname.replace(/^\/(r\/)?/, '').replace(/\/$/, ''));
    const link = slug ? await getLinkForHost(u.host, slug) : undefined;
    if (!link || link.archived === 1 || link.safety === 'blocked') return NextResponse.json({ matched: null, link: null }, { status: 404 });
    return NextResponse.json(payload(link, platform, null, 'deep_link'));
  }

  const match = await matchDeferredClick({ ip: clientIp(req), platform, domain: domain ?? null });
  if (!match) return NextResponse.json({ matched: null, link: null }, { status: 404 });
  const link = (await getDb()
    .prepare('SELECT l.*, d.hostname AS domain_hostname FROM links l LEFT JOIN link_domains d ON d.id = l.domain_id WHERE l.id = ?')
    .get(match.linkId)) as LinkWithDomain | undefined;
  if (!link || link.archived === 1 || link.safety === 'blocked') return NextResponse.json({ matched: null, link: null }, { status: 404 });
  return NextResponse.json(payload(link, platform, match.clickId, 'deferred'));
}
