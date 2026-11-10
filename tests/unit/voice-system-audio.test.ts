import { afterEach, describe, expect, it } from 'vitest';
import { AiError, recordAiUsage } from '@/lib/ai';
import { assertTranscribeQuota, transcribeFreeMinutes, TOKENS_PER_AUDIO_SECOND } from '@/lib/voice-transcribe';
import { pcm16Base64ToFloat } from '@/components/voice/audio';
import { makeUser } from './helpers';

afterEach(() => {
  delete process.env.VOICE_TRANSCRIBE_FREE_MINUTES;
});

describe('cuota de la transcripción', () => {
  it('por defecto son 600 minutos y se puede subir o sacar el tope', () => {
    expect(transcribeFreeMinutes()).toBe(600);
    process.env.VOICE_TRANSCRIBE_FREE_MINUTES = '30';
    expect(transcribeFreeMinutes()).toBe(30);
    process.env.VOICE_TRANSCRIBE_FREE_MINUTES = 'unlimited';
    expect(transcribeFreeMinutes()).toBeNull();
  });

  it('cuenta solo el audio transcrito: el chat y las notas gastados no la frenan', async () => {
    const { id } = await makeUser('tq');
    process.env.VOICE_TRANSCRIBE_FREE_MINUTES = '2';
    // El workspace ya gastó muchísimo en otras funciones de IA: no cuenta.
    await recordAiUsage({ workspaceId: id, feature: 'chat_bot', model: 'x', inputTokens: 900_000, outputTokens: 900_000 });
    await expect(assertTranscribeQuota(id)).resolves.toBeUndefined();
    // 1 minuto de audio: todavía entra.
    await recordAiUsage({ workspaceId: id, feature: 'voice_transcribe', model: 'x', inputTokens: 60 * TOKENS_PER_AUDIO_SECOND, outputTokens: 0 });
    await expect(assertTranscribeQuota(id)).resolves.toBeUndefined();
    // Con 2 minutos se llega al tope.
    await recordAiUsage({ workspaceId: id, feature: 'voice_transcribe', model: 'x', inputTokens: 60 * TOKENS_PER_AUDIO_SECOND, outputTokens: 0 });
    await expect(assertTranscribeQuota(id)).rejects.toMatchObject({ code: 'quota_exceeded' } satisfies Partial<AiError>);
  });
});

describe('audio del sistema de la app de escritorio', () => {
  it('pasa PCM de 16 bits en base64 a muestras float', () => {
    const pcm = new Int16Array([0, 16384, -16384, 32767, -32768]);
    const b64 = Buffer.from(pcm.buffer).toString('base64');
    const out = pcm16Base64ToFloat(b64);
    expect(out.length).toBe(5);
    expect(out[0]).toBe(0);
    expect(out[1]).toBeCloseTo(0.5, 3);
    expect(out[2]).toBeCloseTo(-0.5, 3);
    expect(out[4]).toBe(-1);
  });

  it('una lectura vacía o con un byte suelto no rompe', () => {
    expect(pcm16Base64ToFloat('').length).toBe(0);
    expect(pcm16Base64ToFloat(Buffer.from([1]).toString('base64')).length).toBe(0);
  });
});
