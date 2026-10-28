import { NextRequest, NextResponse } from 'next/server';
import { voiceAuth, readBody } from '@/lib/voice-route';
import { builtinPrompts, meetingLabels, voiceErrorResponse, voiceJsonError } from '@/lib/voice-http';
import { askAcross } from '@/lib/voice-service';
import { recipePrompt, runRecipeAcross } from '@/lib/voice-prep';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Pregunta sobre todas tus reuniones. Body: { question, locale? }, o
 * { recipeId, question? } para correr un recipe sobre varias reuniones
 * (question es el tema para elegirlas; sin tema, las últimas).
 */
export async function POST(req: NextRequest) {
  const auth = await voiceAuth({ bucket: 'ai', limit: 20 });
  if (auth.res) return auth.res;
  const body = await readBody(req);
  const question = typeof body.question === 'string' ? body.question.trim().slice(0, 2000) : '';
  const recipeId = typeof body.recipeId === 'string' ? body.recipeId.slice(0, 80) : '';
  if (!question && !recipeId) return voiceJsonError(400, 'invalid_input');
  const locale = typeof body.locale === 'string' ? body.locale : 'en';
  try {
    if (recipeId) {
      const recipe = await recipePrompt(auth.owner, recipeId, builtinPrompts(locale, 'recipe'));
      if (!recipe) return voiceJsonError(404, 'recipe_not_found');
      return NextResponse.json(await runRecipeAcross({ owner: auth.owner, recipe, topic: question, locale, labels: meetingLabels(locale) }));
    }
    return NextResponse.json(await askAcross({ owner: auth.owner, question, locale, labels: meetingLabels(locale) }));
  } catch (err) {
    return voiceErrorResponse(err);
  }
}
