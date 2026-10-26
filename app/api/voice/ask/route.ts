import { NextRequest, NextResponse } from 'next/server';
import { voiceAuth, readBody } from '@/lib/voice-route';
import { meetingLabels, voiceErrorResponse, voiceJsonError } from '@/lib/voice-http';
import { askAcross } from '@/lib/voice-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Pregunta sobre todas tus reuniones. Body: { question, locale? }. */
export async function POST(req: NextRequest) {
  const auth = await voiceAuth({ bucket: 'ai', limit: 20 });
  if (auth.res) return auth.res;
  const body = await readBody(req);
  const question = typeof body.question === 'string' ? body.question.trim().slice(0, 2000) : '';
  if (!question) return voiceJsonError(400, 'invalid_input');
  const locale = typeof body.locale === 'string' ? body.locale : 'en';
  try {
    return NextResponse.json(await askAcross({ owner: auth.owner, question, locale, labels: meetingLabels(locale) }));
  } catch (err) {
    return voiceErrorResponse(err);
  }
}
