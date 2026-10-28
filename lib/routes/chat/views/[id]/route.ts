import { NextResponse } from 'next/server';
import { deleteChatView, getChatView, updateChatView } from '@/lib/chat-collab';
import { chatError, chatSession, collabError, readBody } from '@/lib/chat-http';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, props: Ctx) {
  const { id } = await props.params;
  const s = await chatSession();
  if (s instanceof NextResponse) return s;
  const view = await getChatView(s.ws, s.me, id);
  return view ? NextResponse.json(view) : chatError(404, 'not_found');
}

/** { name?, filters?, shared? } */
export async function PATCH(req: Request, props: Ctx) {
  const { id } = await props.params;
  const s = await chatSession({ write: true });
  if (s instanceof NextResponse) return s;
  const body = await readBody(req);
  if (!body) return chatError(400, 'invalid_input');
  try {
    const view = await updateChatView(s.ws, s.me, id, { name: body.name, filters: body.filters, shared: body.shared });
    return view ? NextResponse.json(view) : chatError(404, 'not_found');
  } catch (err) {
    return collabError(err);
  }
}

export async function DELETE(_req: Request, props: Ctx) {
  const { id } = await props.params;
  const s = await chatSession({ write: true });
  if (s instanceof NextResponse) return s;
  return (await deleteChatView(s.ws, s.me, id)) ? NextResponse.json({ ok: true }) : chatError(404, 'not_found');
}
