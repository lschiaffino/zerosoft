import { NextResponse } from 'next/server';
import { summarizeChat } from '@/lib/groups-ai';
import { chatGuard, groupsSession, handleGroupsError, readJson } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Resumen AI de los últimos días. Con la AI apagada responde 503 ai_disabled. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const guard = await chatGuard(s, (await ctx.params).id);
  if (guard instanceof NextResponse) return guard;
  const b = await readJson(req);
  const days = Math.min(90, Math.max(1, Number(b.days) || 7));
  const locale = b.locale === 'es' || b.locale === 'pt' ? b.locale : 'en';
  try {
    return NextResponse.json(await summarizeChat(s.ws, (await ctx.params).id, { days, locale }));
  } catch (err) {
    return handleGroupsError(err);
  }
}
