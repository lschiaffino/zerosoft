import { NextResponse } from 'next/server';
import { z } from 'zod';
import { limitByIp } from '@/lib/rate-limit';
import { getHelpWorkspace } from '@/lib/docs-help';
import { recordSiteView, verifiedSiteHost } from '@/lib/docs-site';
import { requestIp } from '@/lib/docs-audit';
import { appHosts } from '@/lib/hosts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  handle: z.string().trim().min(1).max(64),
  pageId: z.string().trim().max(64).optional(),
  referrer: z.string().max(2048).optional(),
});

/**
 * Visita al sitio publicado (beacon del navegador, sin cookies). Cuenta una
 * por visitante, página y día; los bots no cuentan.
 */
export async function POST(req: Request) {
  const limited = await limitByIp(req, 'help-view', 120, 60);
  if (limited) return limited;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const ws = await getHelpWorkspace(parsed.data.handle);
  if (!ws) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const own = [...appHosts()];
  const domain = await verifiedSiteHost(ws.id);
  if (domain) own.push(domain);
  const ok = await recordSiteView({
    workspaceId: ws.id,
    pageId: parsed.data.pageId ?? '',
    headers: req.headers,
    ip: requestIp(req.headers),
    referrer: parsed.data.referrer ?? null,
    ownHosts: own,
  });
  return NextResponse.json({ ok }, { status: ok ? 201 : 202 });
}
