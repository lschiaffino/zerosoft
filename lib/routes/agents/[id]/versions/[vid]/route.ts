import { NextRequest, NextResponse } from 'next/server';
import { agentError, agentRouteContext } from '@/lib/agents-http';
import { restoreVersion } from '@/lib/agents-versions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Vuelve a esta versión: queda en vivo como versión nueva. */
export async function POST(_req: NextRequest, props: { params: Promise<{ id: string; vid: string }> }) {
  const { id, vid } = await props.params;
  const ctx = await agentRouteContext(id, { edit: true });
  if ('res' in ctx) return ctx.res;
  const res = await restoreVersion(ctx.user.id, id, vid, ctx.personId);
  if (!res.ok) return agentError(res.error === 'not_found' ? 404 : res.error === 'conflict' ? 409 : 400, res.error);
  return NextResponse.json({ agent: res.agent, versioning: res.versioning });
}
