import { NextResponse } from 'next/server';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { GroupsError, listMessages, sendMessage } from '@/lib/groups';
import { maskMessage } from '@/lib/groups-access';
import { normalizePoll } from '@/lib/groups-polls';
import { mediaFromBody } from '@/lib/groups-media-input';
import { v1Chat, v1Error, v1Json } from '@/lib/groups-v1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/v1/groups/chats/:id/messages?after=<iso>&limit= */
export async function GET(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req, 'groups:read');
  if ('res' in auth) return auth.res;
  const id = (await ctx.params).id;
  const g = await v1Chat(auth, id);
  if ('res' in g) return g.res;
  const p = new URL(req.url).searchParams;
  const msgs = await listMessages(auth.user.id, id, { after: p.get('after') || undefined, limit: Number(p.get('limit')) || undefined });
  return NextResponse.json({ data: msgs.map((m) => maskMessage(g.viewer, m)) });
}

/**
 * POST /api/v1/groups/chats/:id/messages
 * { body, note?, replyToId?, media?: { url, mimetype, filename }, poll?: { question, options, multi } }
 */
export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req, 'groups:write');
  if ('res' in auth) return auth.res;
  const id = (await ctx.params).id;
  const g = await v1Chat(auth, id);
  if ('res' in g) return g.res;
  const b = await v1Json(req);
  const media = mediaFromBody(b.media, req);
  let poll = null;
  if (b.poll != null) {
    try {
      poll = normalizePoll(b.poll);
    } catch (err) {
      return apiError(400, (err as Error).message, 'poll needs a question and 2 to 12 different options.');
    }
  }
  if (!poll && !media && (typeof b.body !== 'string' || !b.body.trim())) return apiError(400, 'invalid_input', 'body is required.');
  try {
    const msg = await sendMessage(auth.user.id, auth.personId, id, {
      body: typeof b.body === 'string' ? b.body.slice(0, 4096) : '',
      note: b.note === true,
      replyToId: typeof b.replyToId === 'string' ? b.replyToId.slice(0, 100) : null,
      media,
      poll,
      authorKind: 'api',
    });
    return NextResponse.json({ data: maskMessage(g.viewer, msg) }, { status: 201 });
  } catch (err) {
    if (err instanceof GroupsError && err.code === 'not_found') return apiError(404, 'not_found', 'Chat not found.');
    return v1Error(err);
  }
}
