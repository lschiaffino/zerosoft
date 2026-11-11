import { NextResponse } from 'next/server';
import { draftReply, parseDraftBody } from '@/lib/groups-ai';
import { chatGuard, groupsSession, handleGroupsError, readJson } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Borrador AI para el composer ("Ayudame a escribir"). No manda nada: el
 * texto vuelve para revisarlo.
 * - { mode: 'draft', instruction? }: el próximo mensaje. Con `instruction`
 *   escribe lo que la persona describe; sin ella, responde al último mensaje.
 * - { mode: 'rewrite', text, change, instruction? }: cambia un texto. `change`
 *   es shorter, longer, formal, casual, fix o custom (con `instruction`).
 * - { mode: 'polish', text }: corrige y aclara lo escrito.
 * Solo sobre un chat que la persona ve; quien tiene los teléfonos ocultos
 * tampoco los manda al modelo.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const id = (await ctx.params).id;
  const guard = await chatGuard(s, id);
  if (guard instanceof NextResponse) return guard;
  const b = await readJson(req);
  try {
    return NextResponse.json(await draftReply(s.ws, id, parseDraftBody(b), { maskPhones: guard.viewer.mask }));
  } catch (err) {
    return handleGroupsError(err);
  }
}
