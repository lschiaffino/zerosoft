/**
 * Limpieza de un dictado por reglas (puro). Corre siempre después de la IA
 * (reemplazos del diccionario y snippets tienen que quedar exactos) y sola
 * cuando la IA está apagada o sin cuota: saca muletillas, aplica las
 * autocorrecciones dichas ("el lunes, no, quise decir el martes"), arma
 * listas dictadas ("primero… segundo…"), "nueva línea", mayúscula inicial y
 * punto final.
 */
import type { VoiceDictionaryEntry } from './voice-types';

const FILLERS = [
  // en
  'um+', 'uh+', 'erm+', 'hmm+', 'mm+', 'you know', 'like,',
  // es
  'eh+', 'em+', 'este\\.\\.\\.', 'o sea,', 'mmm+',
  // pt
  'tipo,', 'né', 'ahn+', 'éh+',
];

const FILLER_RE = new RegExp(`(^|[\\s,])(?:${FILLERS.join('|')})(?=[\\s,.!?]|$)`, 'giu');

/** Marcadores de autocorrección: lo que viene después reemplaza lo de antes. */
const BACKTRACK_RE =
  /,?\s*\b(?:no|nah|o sea|perdón|sorry|não|ou melhor)\b,?\s+(?:I mean|I meant|quise decir|quiero decir|mejor|digo|eu quis dizer|quer dizer|melhor)\b,?\s+/iu;
const SCRATCH_RE = /\b(?:scratch that|borrá eso|borra eso|apaga isso)\b[.,!]?\s*/iu;

const ORDINALS: Array<RegExp> = [
  /\b(?:first|firstly|primero|en primer lugar|primeiro)\b,?\s*/iu,
  /\b(?:second|secondly|segundo|en segundo lugar)\b,?\s*/iu,
  /\b(?:third|thirdly|tercero|en tercer lugar|terceiro)\b,?\s*/iu,
  /\b(?:fourth|cuarto|quarto)\b,?\s*/iu,
  /\b(?:fifth|quinto)\b,?\s*/iu,
];

const NEW_LINE_RE = /\s*\b(?:new line|nueva línea|nova linha)\b[.,]?\s*/giu;
const NEW_PARAGRAPH_RE = /\s*\b(?:new paragraph|nuevo párrafo|novo parágrafo)\b[.,]?\s*/giu;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function removeFillers(text: string): string {
  return text
    .replace(FILLER_RE, (_m, lead: string) => (lead === ',' ? ',' : lead))
    .replace(/\s+,/g, ',')
    .replace(/,\s*,/g, ',')
    .replace(/^\s*,\s*/, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** "on Monday, no, I mean Tuesday" → "on Tuesday"; "…, scratch that" borra la frase anterior. */
export function applyBacktrack(text: string): string {
  let out = text;
  for (let guard = 0; guard < 10; guard++) {
    const m = BACKTRACK_RE.exec(out);
    if (!m) break;
    const before = out.slice(0, m.index);
    const afterAll = out.slice(m.index + m[0].length);
    // La corrección llega hasta un signo o un conector ("y", "and", "pero"…), y como mucho 4 palabras.
    const endIdx = afterAll.search(/[.!?;,\n]|\s(?:and|but|so|then|y|pero|e|mas|después|luego)\s|$/iu);
    const correction = afterAll.slice(0, endIdx).trim();
    const rest = afterAll.slice(endIdx);
    const n = Math.min(4, Math.max(1, correction.split(/\s+/).filter(Boolean).length));
    const words = before.trimEnd().split(/(\s+)/);
    // Si la corrección repite una palabra de lo anterior ("de la tienda, no, quise decir de la web"),
    // se corta desde esa palabra; si no, se sacan las últimas n palabras (sin cruzar un punto).
    const first = correction.split(/\s+/)[0]?.toLowerCase() ?? '';
    const tail = words.filter((w) => w.trim());
    let cutAt = -1;
    for (let i = tail.length - 1; i >= Math.max(0, tail.length - 6); i--) {
      if (/[.!?]$/.test(tail[i])) break;
      if (tail[i].toLowerCase().replace(/[,;:]$/, '') === first) {
        cutAt = tail.length - i;
        break;
      }
    }
    const target = cutAt > 0 ? cutAt : n;
    let removed = 0;
    while (words.length && removed < target) {
      const w = words[words.length - 1];
      if (/[.!?]$/.test(w)) break;
      words.pop();
      if (w.trim()) removed += 1;
    }
    const head = words.join('').trimEnd();
    out = `${head}${head ? ' ' : ''}${correction}${rest}`;
  }
  for (let guard = 0; guard < 10; guard++) {
    const m = SCRATCH_RE.exec(out);
    if (!m) break;
    const before = out.slice(0, m.index).trimEnd();
    const cut = Math.max(before.lastIndexOf('. ', before.length - 2), before.lastIndexOf('? '), before.lastIndexOf('! '));
    const head = cut >= 0 ? before.slice(0, cut + 1) : '';
    out = `${head}${head ? ' ' : ''}${out.slice(m.index + m[0].length)}`.trim();
  }
  return out;
}

/** "primero X, segundo Y y tercero Z" → lista numerada (desde dos puntos). */
export function formatSpokenList(text: string): string {
  const first = ORDINALS[0].exec(text);
  const second = ORDINALS[1].exec(text);
  if (!first || !second || second.index < first.index) return text;
  const intro = text.slice(0, first.index).trim().replace(/[,:]$/, '');
  const items: string[] = [];
  let rest = text.slice(first.index + first[0].length);
  for (let i = 1; i < ORDINALS.length; i++) {
    const m = ORDINALS[i].exec(rest);
    if (!m) break;
    items.push(rest.slice(0, m.index));
    rest = rest.slice(m.index + m[0].length);
  }
  items.push(rest);
  const clean = items
    .map((s) => s.trim().replace(/^[,;:]\s*/, '').replace(/[,;]?\s*\b(?:and|y|e)$/iu, '').replace(/[,;.]+$/, '').trim())
    .filter(Boolean);
  if (clean.length < 2) return text;
  const list = clean.map((s, i) => `${i + 1}. ${capitalize(s)}`).join('\n');
  return intro ? `${capitalize(intro)}:\n${list}` : list;
}

export function applySpokenBreaks(text: string): string {
  return text.replace(NEW_PARAGRAPH_RE, '\n\n').replace(NEW_LINE_RE, '\n');
}

function capitalize(s: string): string {
  return s.charAt(0).toLocaleUpperCase() + s.slice(1);
}

/** Reemplazos y snippets del diccionario (sin distinguir mayúsculas, palabra entera). */
export function applyDictionary(text: string, entries: Pick<VoiceDictionaryEntry, 'kind' | 'phrase' | 'replacement'>[]): string {
  let out = text;
  const subs = entries
    .filter((e) => (e.kind === 'replace' || e.kind === 'snippet') && e.phrase.trim())
    .sort((a, b) => b.phrase.length - a.phrase.length);
  for (const e of subs) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(e.phrase.trim())}(?=$|[^\\p{L}\\p{N}])`, 'giu');
    out = out.replace(re, (_m, lead: string) => `${lead}${e.replacement}`);
  }
  // Palabras del diccionario: si se transcribió con otra capitalización, queda la guardada.
  for (const e of entries) {
    if (e.kind !== 'word' || !e.phrase.trim()) continue;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(e.phrase.trim())}(?=$|[^\\p{L}\\p{N}])`, 'giu');
    out = out.replace(re, (_m, lead: string) => `${lead}${e.phrase.trim()}`);
  }
  return out;
}

/** Mayúscula al principio de cada oración y punto final si falta. */
export function finishSentences(text: string): string {
  let out = text.trim();
  if (!out) return out;
  out = out.replace(/(^|[.!?]\s+|\n\s*)(\p{Ll})/gu, (_m, lead: string, ch: string) => `${lead}${ch.toLocaleUpperCase()}`);
  const lastLine = out.split('\n').pop() ?? '';
  if (!/^\d+\.\s/.test(lastLine) && !/[.!?…:;)"'»]$/.test(out)) out += '.';
  return out;
}

/** Limpieza completa por reglas. */
export function ruleCleanup(raw: string, entries: Pick<VoiceDictionaryEntry, 'kind' | 'phrase' | 'replacement'>[] = []): string {
  let t = raw.replace(/\s+/g, ' ').trim();
  if (!t) return '';
  t = removeFillers(t);
  t = applyBacktrack(t);
  t = applySpokenBreaks(t);
  t = formatSpokenList(t);
  t = applyDictionary(t, entries);
  return finishSentences(t);
}
