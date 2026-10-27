import { NextRequest } from 'next/server';
import { agentRouteContext } from '@/lib/agents-http';
import { exportConversationsCsv } from '@/lib/agents-export';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Conversaciones del agente en CSV (una fila por mensaje), de los últimos `days` días. */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const ctx = await agentRouteContext(id);
  if ('res' in ctx) return ctx.res;
  const days = Number(req.nextUrl.searchParams.get('days') ?? 30);
  const csv = await exportConversationsCsv(ctx.user.id, id, { days: Number.isFinite(days) ? days : 30 });
  const slug = ctx.row.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agent';
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${slug}-conversations.csv"`,
      'cache-control': 'no-store',
    },
  });
}
