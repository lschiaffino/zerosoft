import { NextResponse } from 'next/server';
import { countChatConversations } from '@/lib/chat-data';
import { createChatView, listChatViews } from '@/lib/chat-collab';
import { viewListOptions } from '@/lib/chat-views';
import { chatError, chatSession, collabError, readBody } from '@/lib/chat-http';

export const dynamic = 'force-dynamic';

/** Vistas propias y compartidas; con ?counts=1, cuántas conversaciones cumple cada una. */
export async function GET(req: Request) {
  const s = await chatSession();
  if (s instanceof NextResponse) return s;
  const views = await listChatViews(s.ws, s.me);
  if (new URL(req.url).searchParams.get('counts') === '1') {
    const ids = s.widgets.map((w) => w.id);
    for (const v of views) v.count = ids.length ? await countChatConversations(ids, viewListOptions(v.filters, s.me)) : 0;
  }
  return NextResponse.json({ views });
}

/** { name, filters, shared? } */
export async function POST(req: Request) {
  const s = await chatSession({ write: true });
  if (s instanceof NextResponse) return s;
  const body = await readBody(req);
  if (!body) return chatError(400, 'invalid_input');
  try {
    const view = await createChatView(s.ws, s.me, { name: body.name, filters: body.filters, shared: body.shared });
    return NextResponse.json(view, { status: 201 });
  } catch (err) {
    return collabError(err);
  }
}
