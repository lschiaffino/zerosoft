import { NextRequest, NextResponse } from 'next/server';
import { actorProject, aError, analyticsActor, isResponse } from '@/lib/analytics/http';
import { urlSeen } from '@/lib/analytics/heatmaps';
import { framingAllowed } from '@/lib/analytics/replay-core';
import { rateLimit } from '@/lib/rate-limit';
import { safeFetch } from '@/lib/safe-fetch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * ¿La página se deja enmarcar? Solo URLs que salieron de los eventos del
 * proyecto, por safeFetch (nada de red interna) y sin leer el cuerpo: alcanza con
 * los headers. framable: null si no se pudo saber (el sitio no respondió bien).
 */
export async function GET(req: NextRequest) {
  const actor = await analyticsActor(req, 'read');
  if (isResponse(actor)) return actor;
  const sp = req.nextUrl.searchParams;
  const project = await actorProject(actor, sp.get('project'));
  if (isResponse(project)) return project;
  const url = sp.get('url') ?? '';
  if (!url || url.length > 2000) return aError(400, 'invalid_input');
  const limit = await rateLimit(`anheatframe:${actor.personId}`, 30, 60);
  if (!limit.ok) return aError(429, 'rate_limited');
  if (!(await urlSeen(project, url, Date.now() - 365 * 86_400_000))) return aError(404, 'not_found');
  try {
    const res = await safeFetch(url, { method: 'GET', headers: { accept: 'text/html' } }, 4000, { maxRedirects: 3 });
    await res.body?.cancel().catch(() => undefined);
    if (res.status >= 300) return NextResponse.json({ framable: null });
    return NextResponse.json({ framable: framingAllowed(res.headers, req.nextUrl.origin) });
  } catch {
    return NextResponse.json({ framable: null });
  }
}
