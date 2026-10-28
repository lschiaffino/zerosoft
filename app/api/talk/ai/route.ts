import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withTalk, readBody } from '@/lib/talk-http';
import { jsonError } from '@/lib/write-limit';
import { askTalk, dailyRecap, lastSummary, summarizeChannel, summarizeThread, translateMessage } from '@/lib/talk-ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** El último resumen guardado (?kind=channel|thread|recap&ref=), sin llamar a la IA. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const kind = sp.get('kind');
  if (kind !== 'channel' && kind !== 'thread' && kind !== 'recap') return jsonError(400, 'invalid_input');
  return withTalk(async ({ actor }) => NextResponse.json({ summary: await lastSummary(actor, kind, kind === 'recap' ? 'daily' : (sp.get('ref') ?? '')) }));
}

const id = z.string().max(64);
const schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('channel'), channelId: id, range: z.enum(['unread', 'day', 'week']).optional() }),
  z.object({ kind: z.literal('thread'), rootId: id }),
  z.object({ kind: z.literal('recap') }),
  z.object({ kind: z.literal('ask'), question: z.string().min(1).max(500) }),
  z.object({ kind: z.literal('translate'), messageId: id, lang: z.string().max(5) }),
]);

/** Resúmenes, recap, preguntas con fuentes y traducción (siempre sobre lo que la persona puede leer). */
export async function POST(req: NextRequest) {
  return withTalk(
    async ({ actor }) => {
      const b = await readBody(req, schema);
      if (!b) return jsonError(400, 'invalid_input');
      if (b.kind === 'channel') return NextResponse.json({ summary: await summarizeChannel(actor, b.channelId, b.range ?? 'unread') });
      if (b.kind === 'thread') return NextResponse.json({ summary: await summarizeThread(actor, b.rootId) });
      if (b.kind === 'recap') return NextResponse.json({ summary: await dailyRecap(actor) });
      if (b.kind === 'ask') return NextResponse.json({ answer: await askTalk(actor, b.question) });
      return NextResponse.json(await translateMessage(actor, b.messageId, b.lang));
    },
    { write: 'ai', limit: 30 },
  );
}
