/**
 * Calls: transcripción con nombres y métricas de la conversación. Puro (sin
 * base ni red): lo prueban los tests unitarios.
 *
 * - El proveedor de transcripción devuelve tramos con tiempos (y a veces una
 *   etiqueta de hablante "0", "1"). El bot manda quién hablaba cuándo (el
 *   indicador de Meet y los subtítulos). Cada tramo se queda con el nombre que
 *   más se solapa con él; sin línea de tiempo, con la etiqueta del proveedor.
 * - Sin transcripción (falló el proveedor) se usan los subtítulos de Meet.
 */
import type { Caption, CallMetrics, Speaker, SpeakerSide, TimelineEntry, Utterance } from './types';

export interface RawPiece {
  text: string;
  startMs: number;
  endMs: number;
  /** Etiqueta del proveedor ('' si no separa hablantes). */
  speaker: string;
}

const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/** Junta tramos seguidos del mismo nombre en la línea de tiempo (huecos de menos de `gapMs`). */
export function coalesceTimeline(entries: TimelineEntry[], gapMs = 800): TimelineEntry[] {
  const sorted = entries
    .filter((e) => e.name && Number.isFinite(e.startMs) && Number.isFinite(e.endMs) && e.endMs >= e.startMs)
    .map((e) => ({ name: e.name.trim().slice(0, 120), startMs: Math.max(0, e.startMs), endMs: e.endMs }))
    .sort((a, b) => a.startMs - b.startMs);
  const out: TimelineEntry[] = [];
  for (const e of sorted) {
    const last = out[out.length - 1];
    if (last && norm(last.name) === norm(e.name) && e.startMs - last.endMs <= gapMs) last.endMs = Math.max(last.endMs, e.endMs);
    else out.push({ ...e });
  }
  return out;
}

export interface SpeakerResolveOptions {
  /** Nombres de personas del workspace (se marcan como "propios"). */
  internalNames: string[];
  /** Nombre del bot: nunca es un hablante. */
  botName: string;
  /** Nombre para tramos sin dueño ("Speaker"). */
  unknownLabel: string;
}

function sideOf(name: string, internal: Set<string>, internalFirst: Set<string>): SpeakerSide {
  const n = norm(name);
  if (internal.has(n)) return 'internal';
  // Meet muestra a veces solo el nombre de pila, o "Ana (vos)".
  const first = n.replace(/\(.*\)/, '').trim().split(/\s+/)[0];
  return first && internalFirst.has(first) && !n.includes('@') ? 'internal' : 'external';
}

/**
 * Transcripción final con hablantes. Devuelve los tramos (ordenados, sin
 * vacíos, los seguidos del mismo hablante unidos si casi no hay pausa) y la
 * lista de hablantes con su lado.
 */
export function resolveSpeakers(
  pieces: RawPiece[],
  timeline: TimelineEntry[],
  captions: Caption[],
  opts: SpeakerResolveOptions,
): { utterances: Utterance[]; speakers: Speaker[] } {
  const bot = norm(opts.botName);
  const tl = coalesceTimeline(timeline).filter((e) => norm(e.name) !== bot);
  const usable = pieces.filter((p) => p.text.trim());
  let named: Array<{ name: string; text: string; a: number; b: number }>;
  if (usable.length) {
    named = usable.map((p) => {
      let best = '';
      let bestMs = 0;
      for (const e of tl) {
        const o = overlap(p.startMs, p.endMs, e.startMs, e.endMs);
        if (o > bestMs) {
          bestMs = o;
          best = e.name;
        }
      }
      if (!best && tl.length) {
        // Sin solape (tramo cortito): el más cercano en el tiempo.
        const mid = (p.startMs + p.endMs) / 2;
        let d = Infinity;
        for (const e of tl) {
          const dist = mid < e.startMs ? e.startMs - mid : mid > e.endMs ? mid - e.endMs : 0;
          if (dist < d) {
            d = dist;
            best = e.name;
          }
        }
        if (d > 5000) best = '';
      }
      if (!best) best = p.speaker !== '' ? `${opts.unknownLabel} ${Number(p.speaker) + 1 || p.speaker}` : opts.unknownLabel;
      return { name: best, text: p.text.trim(), a: Math.max(0, Math.round(p.startMs)), b: Math.max(0, Math.round(p.endMs)) };
    });
  } else {
    const caps = captions.filter((c) => c.text.trim() && norm(c.speaker) !== bot).sort((x, y) => x.startMs - y.startMs);
    named = caps.map((c, i) => {
      const next = caps[i + 1];
      const end = next ? Math.max(c.startMs, next.startMs - 100) : c.startMs + Math.max(1500, c.text.length * 60);
      return { name: c.speaker.trim() || opts.unknownLabel, text: c.text.trim(), a: Math.max(0, c.startMs), b: end };
    });
  }
  named.sort((x, y) => x.a - y.a);

  const internal = new Set(opts.internalNames.map(norm).filter(Boolean));
  const internalFirst = new Set([...internal].map((n) => n.split(/\s+/)[0]).filter((n) => n.length > 2));
  const ids = new Map<string, Speaker>();
  const speakerFor = (name: string): Speaker => {
    const k = norm(name);
    let s = ids.get(k);
    if (!s) {
      s = { id: `s${ids.size + 1}`, name, side: sideOf(name, internal, internalFirst) };
      ids.set(k, s);
    }
    return s;
  };

  const utterances: Utterance[] = [];
  for (const n of named) {
    const s = speakerFor(n.name);
    const last = utterances[utterances.length - 1];
    if (last && last.s === s.id && n.a - last.b < 1200 && last.t.length + n.text.length < 1200) {
      last.t = `${last.t} ${n.text}`;
      last.b = Math.max(last.b, n.b);
    } else {
      utterances.push({ s: s.id, t: n.text, a: n.a, b: Math.max(n.a, n.b) });
    }
  }
  return { utterances, speakers: [...ids.values()] };
}

/** Desplaza los tramos de un segmento de audio a su lugar en la llamada. */
export function offsetPieces(pieces: RawPiece[], offsetMs: number): RawPiece[] {
  return pieces.map((p) => ({ ...p, startMs: p.startMs + offsetMs, endMs: p.endMs + offsetMs }));
}

const isQuestion = (t: string) => /[?¿]/.test(t);

/** Métricas de la conversación (Gong: talk ratio, monólogo más largo, interactividad, paciencia). */
export function computeMetrics(utterances: Utterance[], speakers: Speaker[]): CallMetrics {
  const side = new Map(speakers.map((s) => [s.id, s.side]));
  const by = new Map<string, number>();
  for (const u of utterances) by.set(u.s, (by.get(u.s) ?? 0) + Math.max(0, u.b - u.a));
  const talkMs = [...by.values()].reduce((a, b) => a + b, 0);
  let internalMs = 0;
  let externalMs = 0;
  for (const [id, ms] of by) {
    if (side.get(id) === 'internal') internalMs += ms;
    else externalMs += ms;
  }
  const talkRatio = internalMs > 0 && externalMs > 0 ? internalMs / (internalMs + externalMs) : internalMs > 0 ? 1 : externalMs > 0 ? 0 : null;

  // Monólogos: tramos seguidos del mismo hablante con pausas de menos de 2 s.
  type Run = { speakerId: string; ms: number; startMs: number };
  const runs: Run[] = [];
  let cur: (Run & { endMs: number }) | null = null;
  for (const u of utterances) {
    if (cur && cur.speakerId === u.s && u.a - cur.endMs < 2000) {
      cur.endMs = Math.max(cur.endMs, u.b);
      cur.ms = cur.endMs - cur.startMs;
    } else {
      if (cur) runs.push({ speakerId: cur.speakerId, ms: cur.ms, startMs: cur.startMs });
      cur = { speakerId: u.s, ms: u.b - u.a, startMs: u.a, endMs: u.b };
    }
  }
  if (cur) runs.push({ speakerId: cur.speakerId, ms: cur.ms, startMs: cur.startMs });
  const longest = (pred: (r: Run) => boolean) => runs.filter(pred).reduce<Run | null>((best, r) => (!best || r.ms > best.ms ? r : best), null);

  let switches = 0;
  const pauses: number[] = [];
  for (let i = 1; i < utterances.length; i++) {
    const prev = utterances[i - 1];
    const u = utterances[i];
    if (prev.s === u.s) continue;
    switches++;
    if (side.get(u.s) === 'internal' && side.get(prev.s) === 'external') pauses.push(Math.max(0, u.a - prev.b));
  }
  const spanMs = utterances.length ? utterances[utterances.length - 1].b - utterances[0].a : 0;
  const minutes = spanMs / 60_000;

  return {
    talkMs,
    talkRatio,
    bySpeaker: [...by.entries()].map(([id, ms]) => ({ id, ms, share: talkMs ? ms / talkMs : 0 })).sort((a, b) => b.ms - a.ms),
    longestMonologue: longest((r) => side.get(r.speakerId) === 'internal') ?? longest(() => true),
    longestCustomerStory: longest((r) => side.get(r.speakerId) === 'external'),
    interactivity: minutes > 0 ? Math.round((switches / minutes) * 10) / 10 : 0,
    patienceMs: pauses.length ? Math.round(pauses.reduce((a, b) => a + b, 0) / pauses.length) : null,
    questionsInternal: utterances.filter((u) => side.get(u.s) === 'internal' && isQuestion(u.t)).length,
    questionsExternal: utterances.filter((u) => side.get(u.s) !== 'internal' && isQuestion(u.t)).length,
  };
}

/** Menciones de palabras (competidores) con su momento: sin IA, siempre igual. */
export function findMentions(utterances: Utterance[], words: string[]): Array<{ name: string; atMs: number; quote: string }> {
  const out: Array<{ name: string; atMs: number; quote: string }> = [];
  for (const w of words.map((x) => x.trim()).filter((x) => x.length >= 2)) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`, 'iu');
    for (const u of utterances) if (re.test(u.t)) out.push({ name: w, atMs: u.a, quote: u.t.slice(0, 240) });
  }
  return out.sort((a, b) => a.atMs - b.atMs).slice(0, 200);
}

/** Texto de la transcripción para el modelo y el export: "[m:ss] Nombre: texto". */
export function transcriptLines(utterances: Utterance[], speakers: Speaker[], opts: { sideLabels?: { internal: string; external: string } } = {}): string[] {
  const byId = new Map(speakers.map((s) => [s.id, s]));
  return utterances.map((u) => {
    const s = byId.get(u.s);
    const side = s && opts.sideLabels ? ` (${opts.sideLabels[s.side]})` : '';
    return `[${clockOf(u.a)}] ${s?.name ?? u.s}${side}: ${u.t}`;
  });
}

function clockOf(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(t % 60).padStart(2, '0')}`;
}

/** WebVTT de la transcripción (subtítulos del video). */
export function toVtt(utterances: Utterance[], speakers: Speaker[]): string {
  const byId = new Map(speakers.map((s) => [s.id, s.name]));
  const ts = (ms: number) => {
    const t = Math.max(0, ms);
    const h = Math.floor(t / 3_600_000);
    const m = Math.floor((t % 3_600_000) / 60_000);
    const s = Math.floor((t % 60_000) / 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(t % 1000).padStart(3, '0')}`;
  };
  const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return ['WEBVTT', '', ...utterances.flatMap((u, i) => [String(i + 1), `${ts(u.a)} --> ${ts(Math.max(u.b, u.a + 500))}`, `<v ${esc(byId.get(u.s) ?? u.s)}>${esc(u.t)}`, ''])].join('\n');
}
