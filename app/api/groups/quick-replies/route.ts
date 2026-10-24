import { NextResponse } from 'next/server';
import { createQuickReply, deleteQuickReply, listQuickReplies, updateQuickReply } from '@/lib/groups';
import { groupsError, groupsSession, handleGroupsError, readJson, str } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Respuestas rápidas: se insertan escribiendo /atajo en el editor. */
export async function GET() {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  return NextResponse.json({ quickReplies: await listQuickReplies(s.ws) });
}

/** Crear, o editar con { id }. */
export async function POST(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  try {
    const input = { shortcut: str(b.shortcut, 30), body: str(b.body, 4000) };
    const id = str(b.id, 100);
    return id
      ? NextResponse.json(await updateQuickReply(s.ws, id, input))
      : NextResponse.json(await createQuickReply(s.ws, input), { status: 201 });
  } catch (err) {
    return handleGroupsError(err);
  }
}

/** ?id=<id> */
export async function DELETE(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const id = new URL(req.url).searchParams.get('id') ?? '';
  return (await deleteQuickReply(s.ws, id)) ? NextResponse.json({ ok: true }) : groupsError(404, 'not_found');
}
