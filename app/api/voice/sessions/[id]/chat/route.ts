import { NextRequest, NextResponse } from 'next/server';
import { voiceAuth, readBody } from '@/lib/voice-route';
import { builtinPrompts, meetingLabels, voiceErrorResponse, voiceJsonError } from '@/lib/voice-http';
import { chat } from '@/lib/voice-service';
import { recipePrompt, runRecipeOnMeeting } from '@/lib/voice-prep';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Pregunta sobre la reunión. Body: { question, locale? } o { recipeId, locale? }
 * (un recipe propio, del equipo o de fábrica "builtin:<clave>", que queda en
 * el chat como "/Nombre"). Devuelve el chat completo.
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
  try {
    if (recipeId) {
      const recipe = await recipePrompt(auth.owner, recipeId, builtinPrompts(locale, 'recipe'));
      if (!recipe) return voiceJsonError(404, 'recipe_not_found');
      return NextResponse.json({ chat: await runRecipeOnMeeting({ owner: auth.owner, sessionId: id, recipe, locale, labels: meetingLabels(locale) }) });
    }
    const messages = await chat({ owner: auth.owner, sessionId: id, question, locale, labels: meetingLabels(locale) });
    return NextResponse.json({ chat: messages });
  } catch (err) {
    return voiceErrorResponse(err);
  }
}
