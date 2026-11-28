import { NextResponse } from 'next/server';
import { summarizeChat } from '@/lib/groups-ai';
import { chatGuard, groupsError, groupsSession, handleGroupsError, readJson } from '@/lib/groups-http';
import { parseInsightRange } from '@/lib/wa-insights';
import { linesChatInsights } from '@/lib/groups-insights';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Resumen AI de los últimos días. Con la AI apagada responde 503 ai_disabled.
 * { kind: 'insights', range: { kind: 'unread', unread } | { kind: 'days', days: 1 | 7 | 30 }, locale }: la pestaña AI
 * (resumen, preguntas sin responder, compromisos, respuestas sugeridas y ánimo), solo con lo que quien mira ve y sin
 * guardar nada (lib/groups-insights.ts).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const id = (await ctx.params).id;
  const guard = await chatGuard(s, id);
  if (guard instanceof NextResponse) return guard;
  const b = await readJson(req);
  const locale = b.locale === 'es' || b.locale === 'pt' ? b.locale : 'en';
  if (b.kind === 'insights') {
    const range = parseInsightRange(b.range);
    if (!range) return groupsError(400, 'invalid_input');
    try {
      return NextResponse.json({ insights: await linesChatInsights(guard.viewer, id, range, locale) });
    } catch (err) {
      return handleGroupsError(err);
    }
  }
  const days = Math.min(90, Math.max(1, Number(b.days) || 7));
  try {
    return NextResponse.json(await summarizeChat(s.ws, id, { days, locale, maskPhones: guard.viewer.mask }));
  } catch (err) {
    return handleGroupsError(err);
  }
}
