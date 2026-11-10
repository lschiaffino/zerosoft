import { NextResponse } from 'next/server';
import { translateMessages } from '@/lib/groups-ai';
import { chatGuard, groupsSession, handleGroupsError, readJson, str, strArr } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Traduce mensajes del chat al idioma de quien mira: { messageIds, to }.
 * Lo ya traducido sale del caché sin llamar al modelo. Sin AI: 503 ai_disabled.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const id = (await ctx.params).id;
  const guard = await chatGuard(s, id);
  if (guard instanceof NextResponse) return guard;
  const b = await readJson(req);
  try {
    const translations = await translateMessages(s.ws, id, strArr(b.messageIds, 40), str(b.to, 10) ?? 'en');
    return NextResponse.json({ translations });
  } catch (err) {
    return handleGroupsError(err);
  }
}
