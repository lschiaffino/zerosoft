import { NextRequest, NextResponse } from 'next/server';
import { voiceAuth, readBody } from '@/lib/voice-route';
import { builtinPrompts, meetingLabels, voiceErrorResponse, voiceJsonError, voiceNdjson } from '@/lib/voice-http';
import { askAcross, askAcrossStream } from '@/lib/voice-service';
import { recipePrompt, runRecipeAcross } from '@/lib/voice-prep';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Charla previa del cliente (preguntas de seguimiento): solo texto, acotada. */
function historyOf(raw: unknown): Array<{ role: 'user' | 'assistant'; text: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m): m is { role: 'user' | 'assistant'; text: string } => !!m && typeof m === 'object' && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
    .slice(-8)
    .map((m) => ({ role: m.role, text: m.text.slice(0, 4000) }));
}

/**
 * Pregunta sobre todas tus reuniones (y las que te compartieron). Body:
 * { question, locale?, history?, stream? }, o { recipeId, question? } para
 * correr un recipe sobre varias reuniones (question es el tema para elegirlas;
 * sin tema, las últimas).
 *
 * Con { stream: true } responde NDJSON: { type: 'meetings', meetings }, después
 * { type: 'text', delta } por pedazo y { type: 'done' }, o { type: 'error', code }.
 */
export async function POST(req: NextRequest) {
  const auth = await voiceAuth({ bucket: 'ai', limit: 20 });
  if (auth.res) return auth.res;
  const body = await readBody(req);
  const question = typeof body.question === 'string' ? body.question.trim().slice(0, 2000) : '';
  const recipeId = typeof body.recipeId === 'string' ? body.recipeId.slice(0, 80) : '';
  if (!question && !recipeId) return voiceJsonError(400, 'invalid_input');
  const locale = typeof body.locale === 'string' ? body.locale : 'en';
  const history = historyOf(body.history);
  try {
    if (recipeId) {
      const recipe = await recipePrompt(auth.owner, recipeId, builtinPrompts(locale, 'recipe'));
      if (!recipe) return voiceJsonError(404, 'recipe_not_found');
      return NextResponse.json(await runRecipeAcross({ owner: auth.owner, recipe, topic: question, locale, labels: meetingLabels(locale) }));
    }
    const args = { owner: auth.owner, question, locale, labels: meetingLabels(locale), history, includeShared: true };
    if (body.stream === true) {
      const { meetings, deltas } = await askAcrossStream({ ...args, abortSignal: req.signal });
      return voiceNdjson(async (send) => {
        send({ type: 'meetings', meetings });
        let text = '';
        if (deltas) {
          for await (const delta of deltas) {
            text += delta;
            send({ type: 'text', delta });
          }
          if (!text.trim()) throw new Error('empty_answer');
        }
        send({ type: 'done' });
      });
    }
    return NextResponse.json(await askAcross(args));
  } catch (err) {
    return voiceErrorResponse(err);
  }
}
