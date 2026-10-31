/**
 * Talk: topes y formatos de los clips de audio y video. Puro: lo usa el
 * grabador del navegador y lo prueban los unitarios.
 *
 * Vercel corta los pedidos en 4,5 MB: a estos bitrates, un clip de video de
 * 90 s ronda los 3,9 MB y uno de audio de 5 min los 1,8 MB. El grabador además
 * corta al llegar a CLIP_MAX_BYTES por si el navegador se pasa del bitrate.
 */
export type ClipKind = 'audio' | 'video';

export const CLIP_AUDIO_BPS = 48_000;
export const CLIP_VIDEO_BPS = 300_000;
export const CLIP_MAX_BYTES = 4_000_000;

export function clipMaxSeconds(kind: ClipKind): number {
  return kind === 'video' ? 90 : 300;
}

const CANDIDATES: Record<ClipKind, string[]> = {
  audio: ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'],
  video: ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'],
};

export function pickClipMime(kind: ClipKind, isSupported: (mime: string) => boolean): string | null {
  return CANDIDATES[kind].find(isSupported) ?? null;
}

const EXT: Record<string, string> = { 'audio/webm': 'weba', 'audio/mp4': 'm4a', 'video/webm': 'webm', 'video/mp4': 'mp4' };

export function clipFileName(mime: string, now = new Date()): string {
  const base = mime.split(';')[0];
  const stamp = now.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
  return `clip-${stamp}.${EXT[base] ?? 'webm'}`;
}
