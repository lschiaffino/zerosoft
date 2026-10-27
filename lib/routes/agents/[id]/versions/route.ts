import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { agentError, agentRouteContext } from '@/lib/agents-http';
import { discardDraft, listChanges, listVersions, publishAgent, versioningMeta } from '@/lib/agents-versions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Versiones publicadas, registro de cambios y estado del borrador. */
export async function GET(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const ctx = await agentRouteContext(id);
  if ('res' in ctx) return ctx.res;
  const [versions, changes, versioning] = await Promise.all([
    listVersions(ctx.user.id, id),
    listChanges(ctx.user.id, id),
    versioningMeta(ctx.row),
  ]);
  return NextResponse.json({ versions, changes, versioning });
}

const publishSchema = z.object({ note: z.string().trim().max(300).optional() });

/** Publica el borrador (la primera vez, activa las versiones). */
export async function POST(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const ctx = await agentRouteContext(id, { edit: true });
  if ('res' in ctx) return ctx.res;
  const parsed = publishSchema.safeParse((await req.json().catch(() => ({}))) ?? {});
  if (!parsed.success) return agentError(400, 'invalid_input');
  const res = await publishAgent(ctx.user.id, id, ctx.personId, parsed.data.note ?? '');
  if (!res.ok) return agentError(res.error === 'not_found' ? 404 : res.error === 'conflict' ? 409 : 400, res.error);
  return NextResponse.json({ agent: res.agent, versioning: res.versioning });
}

/** Descarta el borrador: el editor vuelve a lo publicado. */
export async function DELETE(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const ctx = await agentRouteContext(id, { edit: true });
  if ('res' in ctx) return ctx.res;
  const res = await discardDraft(ctx.user.id, id, ctx.personId);
  if (!res.ok) return agentError(res.error === 'not_found' ? 404 : 400, res.error);
  return NextResponse.json({ agent: res.agent, versioning: res.versioning });
}
