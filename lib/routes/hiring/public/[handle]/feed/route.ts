import type { NextRequest } from 'next/server';
import { careersFeed } from '@/lib/hiring/careers';
import { descriptionHtml } from '@/lib/hiring/markdown';
import { hiringLimit } from '@/lib/hiring/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ handle: string }> };

/** GET: feed XML con los avisos publicados (público, como la página de empleos). */
export async function GET(req: NextRequest, { params }: Ctx) {
  const limited = await hiringLimit(req, 'feed', 60, 3600);
  if (limited) return limited;
  const xml = await careersFeed((await params).handle.toLowerCase(), descriptionHtml);
  if (!xml) return new Response('Not found', { status: 404 });
  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=900' } });
}
