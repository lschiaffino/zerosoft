import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { hookByToken } from '@/lib/talk-extras';
import { postAsBot } from '@/lib/talk-bot';
import { TalkError } from '@/lib/talk';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ text: z.string().min(1).max(12_000), username: z.string().max(60).optional(), thread_id: z.string().max(64).optional() });

/**
 * Webhook entrante (como los de Slack): POST con { text } publica en el
 * canal del webhook. El token va en la URL; sin sesión.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const hook = await hookByToken(token);
  if (!hook) return NextResponse.json({ ok: false, error: 'invalid_token' }, { status: 404 });
  const limited = await rateLimit(`talk-hook:${hook.id}`, 60, 60);
  if (!limited.ok) return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'invalid_payload' }, { status: 400 });
  try {
    const msg = await postAsBot(hook.workspace_id, {
      channel: hook.channel_id,
      body: parsed.data.text,
      threadId: parsed.data.thread_id ?? null,
      botName: parsed.data.username?.trim() || hook.name,
    });
    return NextResponse.json({ ok: true, id: msg.id });
  } catch (err) {
    if (err instanceof TalkError) return NextResponse.json({ ok: false, error: err.code }, { status: err.status });
    throw err;
  }
}
