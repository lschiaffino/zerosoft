/**
 * Calls: bot simulado para los tests (CALLS_BOT_FAKE=1, nunca en producción).
 * Recorre las mismas funciones que el bot real (eventos, partes, fin) con una
 * grabación corta generada acá (WAV con un tono), una línea de tiempo de
 * hablantes que coincide con la transcripción falsa de Voice y subtítulos.
 * Después procesa la llamada en el momento.
 */
import { getCallById } from './core';
import { completeBotJob, handleBotEvent, storeBotPart } from './bot';
import { CALLS_FAKE_TEXT, fakeSentences } from './fake-text';

export const FAKE_DURATION_MS = 12_000;
export const FAKE_SPEAKERS = ['Demo User', 'Ana Prospect'];

/** WAV PCM mono de 8 kHz con un tono suave: suena y el reproductor lo abre. */
export function fakeWav(durationMs = FAKE_DURATION_MS): Buffer {
  const rate = 8000;
  const samples = Math.round((rate * durationMs) / 1000);
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF', 0, 'latin1');
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write('WAVE', 8, 'latin1');
  buf.write('fmt ', 12, 'latin1');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'latin1');
  buf.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * 330 * i) / rate) * 1200 * (0.6 + 0.4 * Math.sin((2 * Math.PI * i) / rate)));
    buf.writeInt16LE(v, 44 + i * 2);
  }
  return buf;
}

export async function runFakeBot(callId: string, _token: string): Promise<void> {
  const fresh = async () => (await getCallById(callId))!;
  await handleBotEvent(await fresh(), { type: 'joining' });
  await handleBotEvent(await fresh(), { type: 'waiting_room' });
  await handleBotEvent(await fresh(), { type: 'in_call', participants: FAKE_SPEAKERS.map((name) => ({ name })) });
  await handleBotEvent(await fresh(), { type: 'recording', at: new Date().toISOString() });
  const wav = fakeWav();
  await storeBotPart(await fresh(), 'video', 0, wav, 'audio/wav', 0);
  await storeBotPart(await fresh(), 'audio', 0, wav, 'audio/wav', 0);
  await handleBotEvent(await fresh(), { type: 'left', detail: { reason: 'meeting_ended' } });
  // Misma partición que la transcripción falsa de Voice: una oración por tramo, alternando.
  const sentences = fakeSentences(CALLS_FAKE_TEXT);
  const step = Math.floor(FAKE_DURATION_MS / sentences.length);
  await completeBotJob(await fresh(), {
    endReason: 'meeting_ended',
    durationMs: FAKE_DURATION_MS,
    video: { parts: 1, bytes: wav.length, mime: 'audio/wav' },
    audio: { segments: 1, mime: 'audio/wav' },
    speakers: sentences.map((_, i) => ({ name: FAKE_SPEAKERS[i % 2], startMs: i * step, endMs: (i + 1) * step - 50 })),
    captions: sentences.map((t, i) => ({ speaker: FAKE_SPEAKERS[i % 2], text: t, startMs: i * step })),
    participants: FAKE_SPEAKERS.map((name) => ({ name })),
  });
  const { processCall } = await import('./process');
  await processCall(callId);
}
