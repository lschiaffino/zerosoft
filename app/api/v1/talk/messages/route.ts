import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { z } from 'zod';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { afterPost, listChannelMessages, postMessage, TalkError } from '@/lib/talk';
import { ensureCanPost, messageV1, v1Actor, v1Channel } from '@/lib/talk-v1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/talk/messages?channel=<id o nombre>&before=&after=&limit= */
export async function GET(req: Request) {
  const auth = await requireApiUser(req, 'talk:read');
  if ('res' in auth) return auth.res;
  const actor = v1Actor(auth);
  const p = new URL(req.url).searchParams;
  const channelId = await v1Channel(actor, p.get('channel') ?? '');
  if (!channelId) return apiError(404, 'channel_not_found', 'Channel not found.');
  const res = await listChannelMessages(actor, channelId, { before: p.get('before'), after: p.get('after'), limit: Math.min(200, Number(p.get('limit')) || 50) });
  return NextResponse.json({ data: res.messages.map(messageV1), has_more: res.hasMoreBefore });
}

const postSchema = z.object({ channel: z.string().min(1).max(100), text: z.string().min(1).max(12_000), thread_id: z.string().max(64).optional(), also_in_channel: z.boolean().optional() });

/** POST /api/v1/talk/messages { channel, text, thread_id?, also_in_channel? } */
export async function POST(req: Request) {
  const auth = await requireApiUser(req, 'talk:write');
  if ('res' in auth) return auth.res;
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, 'invalid_input', 'Expected { channel, text }.');
  const actor = v1Actor(auth);
  const channelId = await v1Channel(actor, parsed.data.channel);
  if (!channelId) return apiError(404, 'channel_not_found', 'Channel not found.');
  try {
    await ensureCanPost(actor, channelId);
    const result = await postMessage(actor, { channelId, body: parsed.data.text, parentId: parsed.data.thread_id ?? null, alsoInChannel: parsed.data.also_in_channel });
    const job = () => afterPost(actor, result).catch(() => undefined);
    try {
      after(job);
    } catch {
      await job();
    }
    return NextResponse.json({ data: messageV1(result.message) }, { status: 201 });
  } catch (err) {
    if (err instanceof TalkError) return apiError(err.status, err.code, err.code);
    throw err;
  }
}
