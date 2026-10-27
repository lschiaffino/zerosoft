import { NextRequest, NextResponse } from 'next/server';
import { agentRouteContext, notFound } from '@/lib/agents-http';
import { deleteKnowledgeFile } from '@/lib/agents-knowledge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string; fid: string }> }) {
  const { id, fid } = await props.params;
  const ctx = await agentRouteContext(id, { edit: true });
  if ('res' in ctx) return ctx.res;
  if (!(await deleteKnowledgeFile(ctx.user.id, id, fid, ctx.personId))) return notFound();
  return NextResponse.json({ ok: true });
}
