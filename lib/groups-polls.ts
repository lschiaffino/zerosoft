/**
 * Groups: encuestas de WhatsApp (puro: lo usan el servidor, la interfaz y los
 * tests). Una encuesta es una pregunta con 2 a 12 opciones y, si se quiere,
 * varias respuestas por persona. WAHA y Evolution las mandan; la Cloud API de
 * Meta no tiene encuestas. Los votos llegan por el webhook del número.
 */

export interface PollInput {
  question: string;
  options: string[];
  multi: boolean;
}

export interface PollResult {
  option: string;
  votes: number;
}

export interface PollDto extends PollInput {
  results: PollResult[];
  /** Personas que votaron. */
  voters: number;
}

export const POLL_MAX_OPTIONS = 12;

/** Valida y limpia una encuesta. Lanza el código de error si no sirve. */
export function normalizePoll(raw: unknown): PollInput {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const question = String(r.question ?? '').trim().slice(0, 255);
  if (!question) throw new Error('poll_question');
  const seen = new Set<string>();
  const options: string[] = [];
  for (const o of Array.isArray(r.options) ? r.options : []) {
    const v = String(o ?? '').trim().slice(0, 100);
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    options.push(v);
  }
  if (options.length < 2) throw new Error('poll_options');
  if (options.length > POLL_MAX_OPTIONS) throw new Error('poll_too_many_options');
  return { question, options, multi: r.multi === true };
}

export function parsePoll(raw: string | null | undefined): PollInput | null {
  if (!raw) return null;
  try {
    return normalizePoll(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Votos por persona → resultado por opción. Las opciones que no son de la
 * encuesta se ignoran; sin multi, cuenta solo la primera de cada persona.
 */
export function tallyPoll(poll: PollInput, votes: string[][]): PollDto {
  const counts = new Map(poll.options.map((o) => [o, 0]));
  let voters = 0;
  for (const v of votes) {
    const picked = [...new Set(v.filter((o) => counts.has(o)))];
    const used = poll.multi ? picked : picked.slice(0, 1);
    if (used.length === 0) continue;
    voters++;
    for (const o of used) counts.set(o, (counts.get(o) ?? 0) + 1);
  }
  return { ...poll, results: poll.options.map((o) => ({ option: o, votes: counts.get(o) ?? 0 })), voters };
}

/** Opciones elegidas de un voto, por nombre o por índice (algunos gateways mandan el índice). */
export function voteOptions(poll: PollInput, raw: unknown[]): string[] {
  const out: string[] = [];
  for (const x of raw) {
    let name = '';
    if (typeof x === 'number' && poll.options[x] !== undefined) name = poll.options[x];
    else if (typeof x === 'string') name = x;
    else if (x && typeof x === 'object') name = String((x as Record<string, unknown>).name ?? (x as Record<string, unknown>).optionName ?? '');
    const hit = poll.options.find((o) => o === name.trim()) ?? poll.options.find((o) => o.toLowerCase() === name.trim().toLowerCase());
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return poll.multi ? out : out.slice(0, 1);
}

/** Texto para la vista previa y para proveedores sin encuestas: "📊 Pregunta". */
export function pollPreview(poll: PollInput): string {
  return `📊 ${poll.question}`;
}
