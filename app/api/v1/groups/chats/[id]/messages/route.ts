import { NextResponse } from 'next/server';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { GroupsError, getChatRow, listMessages, sendMessage } from '@/lib/groups';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/v1/groups/chats/:id/messages?after=<iso> */
export async function GET(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req, 'groups:read');
  if ('res' in auth) return auth.res;
  const id = (await ctx.params).id;
  if (!(await getChatRow(auth.user.id, id))) return apiError(404, 'not_found', 'Chat not found.');
  const after = new URL(req.url).searchParams.get('after') || undefined;
  return NextResponse.json({ data: await listMessages(auth.user.id, id, { after }) });
}

/** POST /api/v1/groups/chats/:id/messages { body, note? } */
export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req, 'groups:write');
  if ('res' in auth) return auth.res;
  const b = (await req.json().catch(() => ({}))) as { body?: unknown; note?: unknown };
  if (typeof b.body !== 'string' || !b.body.trim()) return apiError(400, 'invalid_input', 'body is required.');
  try {
    const msg = await sendMessage(auth.user.id, auth.personId, (await ctx.params).id, {
      body: b.body.slice(0, 4096),
      note: b.note === true,
      authorKind: 'api',
    });
    return NextResponse.json({ data: msg }, { status: 201 });
  } catch (err) {
    if (err instanceof GroupsError) return apiError(err.status, err.code, err.code === 'not_found' ? 'Chat not found.' : 'Could not send the message.');
    throw err;
  }
}
