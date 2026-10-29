import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { deleteAgent, getAgentDraft, getAgentRow, listKnowledgeUrls, refreshKnowledgeUrls, updateAgent } from '@/lib/agents';
import { versioningMeta } from '@/lib/agents-versions';
import { sitemapStatus } from '@/lib/agents-knowledge';
import { agentUpdateSchema } from '@/lib/agents-config';
import { agentError, canEditAgent, canEditAgents, forbidden, notFound, unauthorized, visibleAgentRow } from '@/lib/agents-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const row = await visibleAgentRow(user, id);
  const agent = row ? await getAgentDraft(user.id, id) : null;
  if (!agent || !row) return notFound();
  return NextResponse.json({ agent, urls: await listKnowledgeUrls(id), canEdit: canEditAgent(user, row), versioning: await versioningMeta(row) });
}

export async function PATCH(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const current = await visibleAgentRow(user, id);
  if (!current) return notFound();
  if (!canEditAgent(user, current)) return forbidden();
  const parsed = agentUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path?.[0] ?? '');
    return agentError(400, 'invalid_input', { field });
  }
  const res = await updateAgent(user.id, id, parsed.data, user.actingUser?.id ?? user.id);
  if (!res.ok) return res.error === 'not_found' ? notFound() : agentError(res.error === 'handle_taken' ? 409 : 400, res.error);
  // URLs nuevas: se descargan al guardar (el agente las usa sin esperar al refresh).
  const urls = parsed.data.knowledge ? await refreshKnowledgeUrls(user.id, id, { onlyPending: true }) : await listKnowledgeUrls(id);
  const row = await getAgentRow(user.id, id);
  return NextResponse.json({ agent: res.agent, urls, versioning: row ? await versioningMeta(row) : null, sitemaps: await sitemapStatus(id) });
}

export async function DELETE(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditAgents(user)) return forbidden();
  if (!(await deleteAgent(user.id, id))) return notFound();
  return NextResponse.json({ ok: true });
}
