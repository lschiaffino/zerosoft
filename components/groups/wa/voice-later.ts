/**
 * "Enviar más tarde" desde la grabadora de notas de voz (Lines e Inbox): lo
 * que comparten las dos grabadoras para programar lo grabado sin perderlo.
 */

/** Una nota de voz dura al menos esto (segundos); más corta no se programa (como lib/inbox/schedule y lib/groups-broadcasts). */
export const MIN_VOICE_SECONDS = 1;

/** ¿Lo grabado alcanza para programarlo? */
export function longEnough(seconds: number): boolean {
  return Number.isFinite(seconds) && seconds >= MIN_VOICE_SECONDS;
}

/** Tipo del audio grabado, sin los códecs ("audio/webm;codecs=opus" → "audio/webm"). */
export function recordedType(rec: Pick<MediaRecorder, 'mimeType'>, fallback: string): string {
  return (rec.mimeType || fallback || 'audio/webm').split(';')[0];
}

/** Nombre del archivo de una nota de voz según su tipo (extensiones que el almacenamiento acepta como audio). */
export function voiceFileName(type: string): string {
  return `voice-note.${type === 'audio/mp4' ? 'm4a' : type === 'audio/ogg' ? 'ogg' : 'weba'}`;
}

/**
 * Lo grabado hasta ahora, como archivo, SIN cortar la grabación: le pide al
 * grabador lo que tenga en el aire y arma el audio con todas las partes. Así
 * la grabación sigue en pausa mientras se sube y se programa, y si algo falla
 * no se perdió. Si el navegador no entrega esa última parte, sale con lo que
 * ya había (se graba de a 250 ms). null si no hay nada grabado.
 */
export async function recordedSoFar(rec: MediaRecorder, chunks: Blob[], type: string): Promise<File | null> {
  if (rec.state !== 'inactive') {
    await new Promise<void>((resolve) => {
      const done = () => {
        window.clearTimeout(timer);
        rec.removeEventListener('dataavailable', done);
        resolve();
      };
      const timer = window.setTimeout(done, 800);
      // El `ondataavailable` de la grabadora (que guarda la parte) corre antes que este aviso.
      rec.addEventListener('dataavailable', done);
      try {
        rec.requestData();
      } catch {
        done();
      }
    });
  }
  if (!chunks.length) return null;
  const file = new File(chunks, voiceFileName(type), { type });
  return file.size > 0 ? file : null;
}

/** El pedido que programa una nota de voz en Inbox (POST /api/inbox/scheduled): un mensaje, sin texto, con el audio como nota de voz. */
export function inboxVoicePayload(input: { threadId: string; sendAt: string; media: { url: string; name: string; type: string }; seconds: number; replyTo?: string | null; key: string }) {
  return {
    threadId: input.threadId,
    sendAt: input.sendAt,
    key: input.key,
    parts: [
      {
        body: '',
        media: { url: input.media.url, name: input.media.name, type: input.media.type, voice: true, duration: Math.max(MIN_VOICE_SECONDS, Math.round(input.seconds)) },
        ...(input.replyTo ? { replyTo: input.replyTo } : {}),
      },
    ],
  };
}

/** El pedido que programa una nota de voz en Lines (POST /api/groups/broadcasts): a un chat, sin texto, con el audio como nota de voz. */
export function linesVoicePayload(input: { chatId: string; scheduledAt: string; media: { url: string; mimetype: string; filename: string }; seconds: number; replyToId?: string | null }) {
  return {
    chatIds: [input.chatId],
    body: '',
    media: { url: input.media.url, mimetype: input.media.mimetype, filename: input.media.filename, kind: 'voice' as const, duration: Math.max(MIN_VOICE_SECONDS, Math.round(input.seconds)) },
    scheduledAt: input.scheduledAt,
    kind: 'scheduled' as const,
    replyToId: input.replyToId ?? null,
  };
}
