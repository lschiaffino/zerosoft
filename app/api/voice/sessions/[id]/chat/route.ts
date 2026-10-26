import { NextRequest, NextResponse } from 'next/server';
import { voiceAuth, readBody } from '@/lib/voice-route';
import { meetingLabels, voiceErrorResponse, voiceJsonError } from '@/lib/voice-http';
import { chat } from '@/lib/voice-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Pregunta sobre la reunión. Body: { question, locale? }. Devuelve el chat completo. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await voiceAuth({ bucket: 'ai', limit: 30 });
  if (auth.res) return auth.res;
  const body = await readBody(req);
  const question = typeof body.question === 'string' ? body.question.trim().slice(0, 2000) : '';
  if (!question) return voiceJsonError(400, 'invalid_input');
  const locale = typeof body.locale === 'string' ? body.locale : 'en';
  try {
    const messages = await chat({ owner: auth.owner, sessionId: id, question, locale, labels: meetingLabels(locale) });
    return NextResponse.json({ chat: messages });
  } catch (err) {
    return voiceErrorResponse(err);
  }
}
