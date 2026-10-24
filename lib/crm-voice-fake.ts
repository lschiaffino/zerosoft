/**
 * Llamadas simuladas para tests y demo (CRM_VOICE_FAKE=1 con NODE_ENV=test o
 * DEMO_MODE=true): el dispositivo falso del navegador avisa conectar, atender
 * y cortar, y acá se corren los mismos pasos que harían los webhooks de
 * Twilio (TwiML, grabación, transcripción de las dos pistas, cierre).
 */
import { randomBytes } from 'crypto';
import { bindOutboundCall, finishCall, getCall, handleTranscriptionEvent, markAnswered, saveRecording } from './crm-voice';
import { voiceIdentity } from './twilio-voice';
import type { CrmCallRow } from './db';

/** WAV PCM mono 8 kHz de silencio (para el reproductor de la grabación falsa). */
export function silentWav(seconds: number): Buffer {
  const rate = 8000;
  const samples = Math.max(1, Math.round(rate * seconds));
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples * 2, 40);
  return buf;
}

const FAKE_LINES: Array<[string, string]> = [
  ['inbound_track', 'Hi, this is a quick call about the proposal we sent.'],
  ['outbound_track', 'Thanks for calling. The price works, but we need to start in March.'],
  ['inbound_track', 'March works. I will send the updated contract tomorrow.'],
];

export type FakeVoiceAction = 'connect' | 'answer' | 'hangup';

export async function runFakeVoiceAction(
  userId: string,
  personId: string,
  callId: string,
  action: FakeVoiceAction,
  durationSec = 0,
): Promise<CrmCallRow | null> {
  const call = await getCall(userId, callId);
  if (!call || call.person_id !== personId) return null;
  if (action === 'connect') {
    const sid = call.call_sid ?? `CA${randomBytes(16).toString('hex')}`;
    return bindOutboundCall(call.id, `client:${voiceIdentity(userId, personId)}`, sid);
  }
  if (action === 'answer') {
    await markAnswered(call.id);
    return getCall(userId, callId);
  }
  // Cortar: si atendieron hubo conversación, transcripción y grabación.
  const answered = Boolean(call.answered_at);
  if (answered) {
    await handleTranscriptionEvent(call.id, { TranscriptionEvent: 'transcription-started' });
    for (const [track, transcript] of FAKE_LINES) {
      await handleTranscriptionEvent(call.id, {
        TranscriptionEvent: 'transcription-content',
        Track: track,
        Final: 'true',
        TranscriptionData: JSON.stringify({ transcript, confidence: 0.95 }),
      });
    }
    await handleTranscriptionEvent(call.id, { TranscriptionEvent: 'transcription-stopped' });
    if (call.recorded) await saveRecording(call.id, `REfake${randomBytes(13).toString('hex')}`, durationSec);
  }
  return finishCall(call.id, { status: answered ? 'completed' : 'no-answer', durationSec: answered ? durationSec : 0 });
}
