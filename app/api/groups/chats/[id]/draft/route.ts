import { NextResponse } from 'next/server';
import { draftReply } from '@/lib/groups-ai';
import { groupsSession, handleGroupsError, readJson, str } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Borrador AI para el composer: { mode: 'draft' } sugiere la respuesta;
 * { mode: 'polish', text } mejora lo escrito. No manda nada.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  try {
    return NextResponse.json(
      await draftReply(s.ws, (await ctx.params).id, { mode: b.mode === 'polish' ? 'polish' : 'draft', text: str(b.text, 4000) }),
    );
  } catch (err) {
    return handleGroupsError(err);
  }
}
