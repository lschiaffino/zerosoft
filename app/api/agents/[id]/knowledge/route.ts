import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getAgentRow, listKnowledgeUrls, refreshKnowledgeUrls, syncAgentKnowledgeSources } from '@/lib/agents';
import { sitemapStatus } from '@/lib/agents-knowledge';
import { canEditAgents, forbidden, notFound, unauthorized } from '@/lib/agents-http';
import { rateLimit } from '@/lib/rate-limit';
import { agentError } from '@/lib/agents-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await getAgentRow(user.id, id))) return notFound();
  return NextResponse.json({ urls: await listKnowledgeUrls(id), sitemaps: await sitemapStatus(id) });
}

/** Vuelve a descargar las URLs de conocimiento del agente (safeFetch). */
export async function POST(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditAgents(user)) return forbidden();
  const row = await getAgentRow(user.id, id);
  if (!row) return notFound();
  if (process.env.RATE_LIMIT_DISABLED !== 'true') {
    const limited = await rateLimit(`agent-refresh:${id}`, 6, 600);
    if (!limited.ok) return agentError(429, 'rate_limited');
  }
  // Vuelve a leer los sitemaps (páginas nuevas o que ya no están) y baja las URLs.
  await syncAgentKnowledgeSources(user.id, row);
  return NextResponse.json({ urls: await refreshKnowledgeUrls(user.id, id), sitemaps: await sitemapStatus(id) });
}
