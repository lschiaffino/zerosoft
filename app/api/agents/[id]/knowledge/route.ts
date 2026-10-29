import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { listKnowledgeUrls, refreshKnowledgeUrls, syncAgentKnowledgeSources, toAgentDto } from '@/lib/agents';
import { withDraft } from '@/lib/agents-draft';
import { sitemapStatus } from '@/lib/agents-knowledge';
import { canEditAgent, forbidden, notFound, unauthorized, visibleAgentRow } from '@/lib/agents-http';
import { rateLimit } from '@/lib/rate-limit';
import { agentError } from '@/lib/agents-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const row = await visibleAgentRow(user, id);
  if (!row) return notFound();
  // ?semantic=1: cuántos pasajes del borrador ya tienen embedding (búsqueda semántica).
  if (req.nextUrl.searchParams.get('semantic') === '1') {
    const { collectAgentKnowledgeDocs } = await import('@/lib/agent-tools');
    const { semanticStatus } = await import('@/lib/agents-semantic');
    const { agentsAiFakeActive } = await import('@/lib/agents-ai');
    const docs = await collectAgentKnowledgeDocs(toAgentDto(withDraft(row)), user.id);
    return NextResponse.json({ semantic: await semanticStatus(user.id, docs, { fake: await agentsAiFakeActive() }) });
  }
  return NextResponse.json({ urls: await listKnowledgeUrls(id), sitemaps: await sitemapStatus(id) });
}

/** Vuelve a descargar las URLs de conocimiento del agente (safeFetch). */
export async function POST(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const accessRow = await visibleAgentRow(user, id);
  if (!accessRow) return notFound();
  if (!canEditAgent(user, accessRow)) return forbidden();
  const row = await visibleAgentRow(user, id);
  if (!row) return notFound();
  if (process.env.RATE_LIMIT_DISABLED !== 'true') {
    const limited = await rateLimit(`agent-refresh:${id}`, 6, 600);
    if (!limited.ok) return agentError(429, 'rate_limited');
  }
  // Encola releer los sitemaps (los lee el cron de cada minuto) y baja las URLs a mano.
  await syncAgentKnowledgeSources(user.id, row, { force: true });
  return NextResponse.json({ urls: await refreshKnowledgeUrls(user.id, id), sitemaps: await sitemapStatus(id) });
}
