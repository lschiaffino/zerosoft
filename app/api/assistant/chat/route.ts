import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assistantState } from '@/lib/assistant/config';
import { runAssistantTurn } from '@/lib/assistant/engine';
import { assistantUser, localeOf, owner } from '@/lib/assistant/http';
import { addMessage, createConversation, getConversation } from '@/lib/assistant/store';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const bodySchema = z.object({
  conversationId: z.string().max(64).nullish(),
  message: z.string().trim().min(1).max(4000),
  page: z
    .object({ path: z.string().max(300).optional(), title: z.string().max(200).optional(), selection: z.string().max(4000).optional() })
    .nullish(),
  locale: z.string().max(5).optional(),
});

/**
 * Un turno del asistente. Responde NDJSON (un evento por línea): texto,
 * herramientas, acciones a confirmar, done o error. Sin key de OpenRouter
 * responde 503 not_configured (la UI muestra el estado, nada se rompe).
 */
export async function POST(req: NextRequest) {
  const user = await assistantUser();
  if (user instanceof NextResponse) return user;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const state = assistantState();
  if (state !== 'ready') return NextResponse.json({ error: state === 'disabled' ? 'ai_disabled' : 'not_configured' }, { status: 503 });
  const who = owner(user);
  if (process.env.RATE_LIMIT_DISABLED !== 'true') {
    const limited = await rateLimit(`assistant:${who.personId}`, 120, 3600);
    if (!limited.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const { message, page, locale: rawLocale } = parsed.data;
  let conversation = parsed.data.conversationId ? await getConversation(who, parsed.data.conversationId) : null;
  if (parsed.data.conversationId && !conversation) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const created = !conversation;
  conversation ??= await createConversation(who, message);
  await addMessage(conversation.id, 'user', message);
  const conv = conversation;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
      if (created) send({ type: 'conversation', id: conv.id, title: conv.title });
      try {
        for await (const e of runAssistantTurn({ user, conversationId: conv.id, message, page: page ?? null, locale: localeOf(rawLocale), abortSignal: req.signal })) {
          send(e);
        }
      } catch (err) {
        console.error('[assistant] turn', err);
        send({ type: 'error', code: 'provider_error' });
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' } });
}
