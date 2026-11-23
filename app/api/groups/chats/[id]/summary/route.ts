import { NextResponse } from 'next/server';
import { summarizeChat } from '@/lib/groups-ai';
import { askLinesChat, linesChatInsights } from '@/lib/groups-ai-insights';
import { chatGuard, groupsSession, handleGroupsError, readJson } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * IA sobre el chat (solo uno que la persona ve; quien tiene los teléfonos
 * ocultos tampoco los manda al modelo). Con la AI apagada responde 503
 * ai_disabled.
 * - sin `action`: resumen de los últimos `days` días (el botón Resumen del hilo).
 * - { action: 'ask', question }: la pestaña IA, una pregunta sobre el chat.
 * - { action: 'insights' }: la pestaña IA, sentimiento y tareas propuestas
 *   (no crea nada: se aprueban con POST /api/groups/tasks o /api/groups/tickets).
 * Van en esta ruta (y no en una nueva) por el presupuesto de rutas de Vercel
 * (docs/routes-budget.md).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const id = (await ctx.params).id;
  const guard = await chatGuard(s, id);
  if (guard instanceof NextResponse) return guard;
  const b = await readJson(req);
  const locale = b.locale === 'es' || b.locale === 'pt' ? b.locale : 'en';
  const opts = { locale, maskPhones: guard.viewer.mask };
  try {
    if (b.action === 'ask') return NextResponse.json(await askLinesChat(s.ws, id, String(b.question ?? ''), opts));
    if (b.action === 'insights') return NextResponse.json(await linesChatInsights(s.ws, id, opts));
    const days = Math.min(90, Math.max(1, Number(b.days) || 7));
    return NextResponse.json(await summarizeChat(s.ws, id, { days, ...opts }));
  } catch (err) {
    return handleGroupsError(err);
  }
}
