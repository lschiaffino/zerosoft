import { after, NextRequest, NextResponse } from 'next/server';
import { voiceAuth } from '@/lib/voice-route';
import { fakeTextFromRequest, readAudio, voiceErrorResponse } from '@/lib/voice-http';
import { dictate, prepareDictation } from '@/lib/voice-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Dictado: multipart con audio, context (email|chat|note|other), sourceApp
 * durationMs y capture (mic | desktop, la app de escritorio). Transcribe, limpia con IA (o por reglas si no hay IA) y lo
 * guarda en el historial. Devuelve { text, raw, ai, aiError, session, timings }.
 * fast=1 (la app de escritorio, que pega el texto apenas llega): frases cortas
 * por reglas, la IA con tope de tiempo y el historial y el consumo guardados
 * después de contestar. El audio se lee mientras se mira la sesión, y los
 * ajustes, el diccionario y las cuotas se piden mientras termina de llegar.
 * Server-Timing dice dónde se fue el tiempo.
 */
export async function POST(req: NextRequest) {
  const t0 = Date.now();
  const upload = readAudio(req).then(
    (audio) => ({ audio }),
    (err: unknown) => ({ err }),
  );
  const auth = await voiceAuth({ bucket: 'dictate', limit: 60 });
  if (auth.res) return auth.res;
  const tAuth = Date.now();
  const prepared = prepareDictation(auth.owner);
  try {
    const up = await upload;
    if ('err' in up) throw up.err;
    const { bytes, type, fields } = up.audio;
    const tUpload = Date.now();
    const res = await dictate({
      owner: auth.owner,
      audio: bytes,
      type,
      context: String(fields.get('context') ?? 'other'),
      sourceApp: String(fields.get('sourceApp') ?? '').slice(0, 200),
      durationMs: Number(fields.get('durationMs')) || 0,
      capture: fields.get('capture') === 'desktop' ? 'desktop' : 'mic',
      fakeText: await fakeTextFromRequest(),
      fast: fields.get('fast') === '1',
      later: (job) => after(() => job().then(() => undefined).catch((err) => console.error('[voice] save dictation failed', err instanceof Error ? err.message : 'error'))),
      prepared,
    });
    const t = res.timings;
    // auth: sesión y rate limit; upload: lo que el audio tardó en terminar de llegar después de eso.
    const timing = [
      `auth;dur=${tAuth - t0}`,
      `upload;dur=${tUpload - tAuth}`,
      `setup;dur=${t.setupMs}`,
      `transcribe;dur=${t.transcribeMs}`,
      `cleanup;dur=${t.cleanupMs}`,
      `save;dur=${t.saveMs}`,
      `total;dur=${Date.now() - t0}`,
    ].join(', ');
    return NextResponse.json(res, { status: 201, headers: { 'server-timing': timing } });
  } catch (err) {
    return voiceErrorResponse(err);
  }
}
