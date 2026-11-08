/**
 * Citas del chat de Voice: el modelo cita la transcripción como [14:05] (una
 * reunión) o [M2 14:05] / [M2] (varias reuniones). Esto separa el texto de
 * las citas para mostrarlas como links. Sin dependencias: corre en el
 * navegador y en los tests.
 */

export interface VoiceCite {
  /** Etiqueta de la reunión (M1, M2...) cuando la respuesta usa varias. */
  meeting: string | null;
  /** Milisegundos desde el inicio, o null si cita la reunión entera. */
  ms: number | null;
  /** mm:ss tal cual vino. */
  time: string | null;
}

export type CitePart = { kind: 'text'; text: string } | { kind: 'cite'; cites: VoiceCite[]; raw: string };

const BRACKET = /\[([^\]\n]{1,80})\]/g;
const TOKEN = /^(?:(M\d{1,2})(?:\s*[ ,·@-]\s*|\s+))?(\d{1,3}):([0-5]\d)$|^(M\d{1,2})$/;

export function timeToMs(min: string, sec: string): number {
  return (Number(min) * 60 + Number(sec)) * 1000;
}

function parseBracket(inner: string): VoiceCite[] | null {
  const tokens = inner.split(/\s*[,;]\s*/).map((s) => s.trim()).filter(Boolean);
  if (!tokens.length) return null;
  const out: VoiceCite[] = [];
  let lastMeeting: string | null = null;
  for (const tok of tokens) {
    const m = tok.match(TOKEN);
    if (!m) return null;
    if (m[4]) {
      lastMeeting = m[4];
      out.push({ meeting: m[4], ms: null, time: null });
      continue;
    }
    // "[M1 03:10, 04:20]": el segundo tiempo es de la misma reunión.
    const meeting = m[1] ?? lastMeeting;
    lastMeeting = meeting;
    // "[M1, 03:10]": la reunión y su tiempo son una sola cita.
    const prev = out[out.length - 1];
    if (!m[1] && prev && prev.ms === null && prev.meeting === meeting) out.pop();
    out.push({ meeting, ms: timeToMs(m[2], m[3]), time: `${m[2]}:${m[3]}` });
  }
  return out;
}

export function splitCitations(text: string): CitePart[] {
  const parts: CitePart[] = [];
  let last = 0;
  for (const match of text.matchAll(BRACKET)) {
    const cites = parseBracket(match[1]);
    if (!cites) continue;
    const at = match.index ?? 0;
    if (at > last) parts.push({ kind: 'text', text: text.slice(last, at) });
    parts.push({ kind: 'cite', cites, raw: match[0] });
    last = at + match[0].length;
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) });
  return parts;
}

/** ?t= de un link a una reunión (segundos) → milisegundos. */
export function seekParam(raw: string | null): number | null {
  if (!raw || !/^\d{1,6}$/.test(raw)) return null;
  return Number(raw) * 1000;
}
