import { NextRequest, NextResponse } from 'next/server';
import { voiceAuth, readBody } from '@/lib/voice-route';
import { builtinPrompts, meetingLabels, voiceErrorResponse, voiceJsonError, voiceNdjson } from '@/lib/voice-http';
import { chat, chatStream } from '@/lib/voice-service';
import { recipePrompt, runRecipeOnMeeting } from '@/lib/voice-prep';
import { VOICE_ATTACHMENT_MAX_CHARS } from '@/lib/voice-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Pregunta sobre la reunión. Body: { question, locale? } o { recipeId, locale? },
 * más { thread?, model?: 'fast' | 'deep', attachment?: { name, text } }
 * (un recipe propio, del equipo o de fábrica "builtin:<clave>", que queda en
 * el chat como "/Nombre"). Devuelve el chat completo.
 *
 * Con { stream: true } (y una pregunta) responde NDJSON: { type: 'text', delta }
 * por pedazo y al final { type: 'done', chat }, o { type: 'error', code }.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await voiceAuth({ bucket: 'ai', limit: 30 });
  if (auth.res) return auth.res;
  const body = await readBody(req);
  const question = typeof body.question === 'string' ? body.question.trim().slice(0, 2000) : '';
  const recipeId = typeof body.recipeId === 'string' ? body.recipeId.slice(0, 80) : '';
  if (!question && !recipeId) return voiceJsonError(400, 'invalid_input');
  const locale = typeof body.locale === 'string' ? body.locale : 'en';
  // Conversación dentro de la reunión ("Nuevo chat"), modelo elegido y un archivo de texto adjunto.
  const thread = typeof body.thread === 'string' && /^[a-z0-9-]{1,40}$/i.test(body.thread) ? body.thread : undefined;
  const model = body.model === 'fast' || body.model === 'deep' ? body.model : undefined;
  const att = body.attachment as { name?: unknown; text?: unknown } | undefined;
  const attachment =
    att && typeof att === 'object' && typeof att.text === 'string' && att.text.trim()
      ? { name: typeof att.name === 'string' ? att.name.slice(0, 120) : 'file', text: att.text.slice(0, VOICE_ATTACHMENT_MAX_CHARS) }
      : undefined;
  const extra = { thread, model, attachment };
  try {
    if (recipeId) {
      const recipe = await recipePrompt(auth.owner, recipeId, builtinPrompts(locale, 'recipe'));
      if (!recipe) return voiceJsonError(404, 'recipe_not_found');
      return NextResponse.json({ chat: await runRecipeOnMeeting({ owner: auth.owner, sessionId: id, recipe, locale, labels: meetingLabels(locale), ...extra }) });
    }
    if (body.stream === true) {
      // La reunión y la cuota se miran antes de abrir el stream: esos errores salen con su status.
      const { deltas, finish } = await chatStream({ owner: auth.owner, sessionId: id, question, locale, labels: meetingLabels(locale), abortSignal: req.signal, ...extra });
      return voiceNdjson(async (send) => {
        let text = '';
        for await (const delta of deltas) {
          text += delta;
          send({ type: 'text', delta });
        }
        if (!text.trim()) throw new Error('empty_answer');
        send({ type: 'done', chat: await finish(text) });
      });
    }
    const messages = await chat({ owner: auth.owner, sessionId: id, question, locale, labels: meetingLabels(locale), ...extra });
    return NextResponse.json({ chat: messages });
  } catch (err) {
    return voiceErrorResponse(err);
  }
}
