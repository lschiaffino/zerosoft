/**
 * Voice: renombrar a quien habla también actualiza la nota con IA ya armada
 * (dueños de los próximos pasos y menciones en el texto). Server-only.
 */
import { speakerName } from './voice';
import { meetingLabels } from './voice-http';
import type { VoiceEnhanced, VoiceSource } from './voice-types';

function parseKey(key: string): { source: VoiceSource; speaker: string } {
  const [source, speaker = ''] = key.split(':');
  return { source: (source === 'me' || source === 'them' ? source : 'mixed') as VoiceSource, speaker };
}

/** Nombres con los que pudo aparecer un hablante antes: el propio y los de fábrica en los tres idiomas. */
function previousNames(key: string, prev: Record<string, string>): string[] {
  const seg = parseKey(key);
  const names = new Set<string>();
  if (prev[key]) names.add(prev[key]);
  for (const loc of ['en', 'es', 'pt']) names.add(speakerName(seg, {}, meetingLabels(loc)));
  return [...names].filter(Boolean);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Devuelve la nota con los nombres cambiados, o null si no cambió nada. */
export function renameSpeakersInNote(
  enhanced: VoiceEnhanced | null,
  prev: Record<string, string>,
  next: Record<string, string>,
  locale: string,
): VoiceEnhanced | null {
  if (!enhanced) return null;
  const pairs: Array<{ from: string[]; to: string }> = [];
  for (const key of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    if ((prev[key] ?? '') === (next[key] ?? '')) continue;
    const to = next[key] || speakerName(parseKey(key), {}, meetingLabels(locale));
    pairs.push({ from: previousNames(key, prev).filter((n) => n !== to), to });
  }
  if (!pairs.length) return null;
  let json = JSON.stringify(enhanced);
  const before = json;
  for (const { from, to } of pairs) {
    for (const name of from.sort((a, b) => b.length - a.length)) {
      const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(name)}(?=$|[^\\p{L}\\p{N}])`, 'gu');
      json = json.replace(re, (_m, lead: string) => `${lead}${JSON.stringify(to).slice(1, -1)}`);
    }
  }
  return json === before ? null : (JSON.parse(json) as VoiceEnhanced);
}
