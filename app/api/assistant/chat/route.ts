import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assistantState } from '@/lib/assistant/config';
import { runAssistantTurn } from '@/lib/assistant/engine';
import { assistantUser, localeOf, owner } from '@/lib/assistant/http';
import { attachmentView, claimAttachments, getAttachments, MAX_ATTACHMENTS_PER_MESSAGE } from '@/lib/assistant/files';
import { addMessage, createConversation, getConversation } from '@/lib/assistant/store';
import { rateLimit } from '@/lib/rate-limit';
import { AiError, assertAiMonthlyQuota } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const bodySchema = z.object({
  conversationId: z.string().max(64).nullish(),
  message: z.string().trim().max(4000),
  /** Adjuntos ya subidos con POST /api/assistant/files. */
  attachments: z.array(z.string().max(64)).max(MAX_ATTACHMENTS_PER_MESSAGE).optional(),
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
  // Cuota del mes antes de crear nada: sin tokens no queda una charla vacía.
  try {
    await assertAiMonthlyQuota(who.workspaceId);
  } catch (err) {
    if (err instanceof AiError) return NextResponse.json({ error: err.code }, { status: 429 });
    throw err;
  }
  const { page, locale: rawLocale } = parsed.data;
  const atts = parsed.data.attachments?.length ? await getAttachments(who, parsed.data.attachments) : [];
  if (atts.length !== (parsed.data.attachments?.length ?? 0)) return NextResponse.json({ error: 'attachment_not_found' }, { status: 400 });
  if (!parsed.data.message && !atts.length) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  // Solo un adjunto: el pedido es "esto". El texto que guarda la charla lo dice.
  const message = parsed.data.message || (atts.length === 1 ? `(${atts[0].name})` : `(${atts.length} files)`);
  let conversation = parsed.data.conversationId ? await getConversation(who, parsed.data.conversationId) : null;
  if (parsed.data.conversationId && !conversation) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const created = !conversation;
  conversation ??= await createConversation(who, message);
  await addMessage(conversation.id, 'user', parsed.data.message, atts.map((a) => ({ type: 'attachment' as const, ...attachmentView(a) })));
  if (atts.length) await claimAttachments(who, conversation.id, atts.map((a) => a.id));
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
